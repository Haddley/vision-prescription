// Vision Prescription - WebXR prism-prescription finder, sister app to Vision Home.
// Vision Home *simulates* a known prism prescription during Brock-string training; this app
// *estimates* that prescription in the first place, the way an eye doctor does with a
// phoropter: subjective forced choice. The patient looks at a letter H with both eyes while
// the app presents two candidate prism settings in alternation - "one... two..." - and the
// patient picks whichever makes the letter more single and comfortable. A bracketing
// staircase moves toward the preferred side and halves its step on every reversal of
// direction, converging to quarter-diopter precision exactly like a doctor's "better with
// one, or two?" refinement with a Risley prism.
//
// Collecting a two-alternative answer with WebXR's ONE input: the patient's only control is
// the "select" action (controller trigger or bare-hand pinch - same rule as Vision Home; it
// is what makes this work unmodified on Vision Pro). So the choice is expressed by TIMING:
// the app shows option 1 (labelled "1", voice says "one"), waits a beat, shows option 2, and
// the patient selects while their preferred view is on screen. No selection after two full
// rounds = "no preference", which is a finding (the options look the same, so the staircase
// halves its step), never an error.
//
// Head-level invariant: horizontal and vertical prism are only meaningful relative to a level
// head (tilt your head and a purely horizontal deviation acquires a vertical component). The
// render loop measures head roll every frame from the XR camera pose; whenever |roll| exceeds
// the threshold a camera-fixed bubble level turns red, selects are ignored, the routine waits
// before presenting the next option, and a voice nudge asks the patient to level their head.

import * as THREE from './lib/three.module.js';

// ---------- records (localStorage; downloadable JSON, same record shape family as Vision Home)

const RECORDS_KEY = 'visionPrescriptionRecords';

function loadRecords() {
  try { return JSON.parse(localStorage.getItem(RECORDS_KEY)) ?? []; }
  catch { return []; }
}

function saveRecord(record) {
  const records = loadRecords();
  records.push(record);
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  renderRecordsTable();
  renderLatest();
}

// A prescription axis value is per-eye prism diopters, signed. Positive values are directly
// enterable in Vision Home (horizontal: base out each eye; vertical: right eye base down /
// left eye base up). Negative values are the opposite base direction, which Vision Home's
// fields don't accept - we still record and display them faithfully.
function describeHorizontal(d) {
  if (d === null) return 'not determined';
  if (Math.abs(d) < 0.25) return 'none needed';
  return `${Math.abs(d).toFixed(2)}Δ base ${d > 0 ? 'out' : 'in'} (each eye)`;
}
function describeVertical(d) {
  if (d === null) return 'not determined';
  if (Math.abs(d) < 0.25) return 'none needed';
  return d > 0
    ? `${d.toFixed(2)}Δ right eye base down / left base up`
    : `${(-d).toFixed(2)}Δ right eye base up / left base down`;
}

function renderRecordsTable() {
  const tbody = document.querySelector('#recordsTable tbody');
  tbody.innerHTML = '';
  for (const record of loadRecords().slice().reverse()) {
    const row = document.createElement('tr');
    const date = new Date(record.startedUtc);
    const p = record.prescription;
    row.innerHTML = `<td>${date.toLocaleDateString()} ${date.toLocaleTimeString([], { timeStyle: 'short' })}</td>` +
      `<td>${describeHorizontal(p.horizontalDiopters)}</td>` +
      `<td>${describeVertical(p.verticalDiopters)}</td>` +
      `<td>${record.notes.join('; ') || ''}</td>`;
    tbody.appendChild(row);
  }
}

function renderLatest() {
  const latest = loadRecords().at(-1);
  const el = document.getElementById('latest');
  const hint = document.getElementById('latestHint');
  if (!latest) { el.textContent = 'No measurement yet.'; hint.style.display = 'none'; return; }
  const p = latest.prescription;
  el.classList.remove('muted');
  el.innerHTML = `Horizontal: <b>${describeHorizontal(p.horizontalDiopters)}</b><br>` +
    `Vertical: <b>${describeVertical(p.verticalDiopters)}</b>`;
  hint.style.display = '';
}

document.getElementById('downloadBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(loadRecords(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vision-prescription-records-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

renderRecordsTable();
renderLatest();

// ---------- settings ---------------------------------------------------------------------------

const SETTINGS_KEY = 'visionPrescriptionSettings';

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
    if (saved.patientName) document.getElementById('patientName').value = saved.patientName;
  } catch { }
}
document.getElementById('patientName').addEventListener('change', () => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ patientName: document.getElementById('patientName').value }));
});
loadSettings();

// ---------- speech: pre-generated audio clips, NOT speechSynthesis ---------------------------
// Same hard-won rule as Vision Home: Meta's Quest Browser doesn't implement speechSynthesis
// (utterances neither speak nor fire onend). Clips are generated offline with macOS `say` and
// shipped with the app; playback is stall-proof - whatever goes wrong, the promise resolves
// after the clip's duration plus a small grace (or 8s if even metadata never loads).

const speechClips = {};
for (const id of ['welcome', 'horizontal_intro', 'vertical_intro', 'one', 'two',
                  'level_head', 'all_done']) {
  speechClips[id] = new Audio(`./audio/${id}.m4a`);
  speechClips[id].preload = 'auto';
}

function speak(clipId) {
  return new Promise(resolve => {
    const clip = speechClips[clipId];
    if (!clip) { resolve(); return; }
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    clip.onended = finish;
    clip.onerror = finish;
    const cap = Number.isFinite(clip.duration) && clip.duration > 0 ? (clip.duration + 1.5) * 1000 : 8000;
    setTimeout(finish, cap);
    clip.currentTime = 0;
    clip.play().catch(finish);
  });
}

// ---------- XR session & scene ---------------------------------------------------------------

const startBtn = document.getElementById('startBtn');

if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then(supported => {
    if (!supported) {
      document.getElementById('unsupported').style.display = 'block';
      startBtn.disabled = true;
    }
  });
} else {
  document.getElementById('unsupported').style.display = 'block';
  startBtn.disabled = true;
}

startBtn.addEventListener('click', runSession);

const ROLL_LIMIT_DEG = 3;      // head roll beyond this pauses the measurement
const TARGET_DISTANCE = 2.0;   // metres; comfortably near the headset's optical focal distance
const ANSWER_WINDOW_MS = 2200; // silent time after "one"/"two" during which a select chooses it

// State shared between the routine (async), the render loop, and the select handler.
const state = {
  selected: false,   // set by the select handler, consumed by waitForSelect
  speaking: false,   // selects during speech are ignored (don't race the prompt)
  level: true,       // maintained by the render loop from head roll; gates selects + trials
  prism: { h: 0, v: 0 },  // signed per-eye diopters currently applied (the candidate prism)
};

function onSelect() {
  if (!state.speaking && state.level) {
    state.selected = true;
  }
}

// Crisp text on a transparent plane via CanvasTexture - no font assets, works everywhere.
function textPlane(text, sizeMeters) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 190px -apple-system, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 138);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(sizeMeters, sizeMeters),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
}

async function runSession() {
  const patientName = document.getElementById('patientName').value.trim() || 'patient';

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.xr.enabled = true;
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);

  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
  scene.add(camera);

  // A dim floor grid so the patient has a stable world reference (comfort), nothing more.
  const grid = new THREE.GridHelper(10, 20, 0x223044, 0x18202e);
  grid.position.y = -1.4;
  scene.add(grid);

  // --- the chart: a letter H seen by BOTH eyes (this is a binocular comfort/singleness
  // comparison, not a dissociated test), parented to the camera so it stays centred. Below it,
  // "1" / "2" labels that show which option is currently presented.
  const chart = new THREE.Group();
  chart.position.z = -TARGET_DISTANCE;
  camera.add(chart);

  const letter = textPlane('H', 0.28);
  chart.add(letter);

  const label1 = textPlane('1', 0.09);
  const label2 = textPlane('2', 0.09);
  label1.position.y = label2.position.y = -0.26;
  chart.add(label1, label2);

  chart.visible = false;
  function setChoiceLabel(which) {
    label1.visible = which === 1;
    label2.visible = which === 2;
  }
  setChoiceLabel(null);

  // --- bubble level, camera-fixed at the bottom of the view. The bubble slides along the
  // track proportionally to head roll and everything turns red past the limit - the patient's
  // ground truth for why the session stopped advancing.
  const levelGroup = new THREE.Group();
  levelGroup.position.set(0, -0.42, -1.0);
  camera.add(levelGroup);
  const trackMaterial = new THREE.MeshBasicMaterial({ color: 0x334155 });
  const track = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.004, 0.001), trackMaterial);
  levelGroup.add(track);
  const bubbleMaterial = new THREE.MeshBasicMaterial({ color: 0x2fa84f });
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), bubbleMaterial);
  levelGroup.add(bubble);

  // --- candidate prism: identical optics and sign convention to Vision Home's applyPrism, but
  // with signed values the staircase steps through. 1 prism diopter = a 1% tangent deviation;
  // NDC x for a direction with tangent t is t * m00, so the image shift in NDC is
  // (diopters/100) * m00 (and m11 vertically). Positive h = base out each eye (right eye image
  // shifts -x, left +x); positive v = right eye base down / left base up (right +y, left -y).
  // Reapplied every frame because WebXR refreshes the matrices every frame; must run after the
  // XR view update (this animation-loop callback) and before renderer.render.
  const shiftMatrix = new THREE.Matrix4();
  function applyPrism() {
    if (state.prism.h === 0 && state.prism.v === 0) return;
    const xrCamera = renderer.xr.getCamera();
    if (!xrCamera.isArrayCamera || xrCamera.cameras.length !== 2) return;
    xrCamera.cameras.forEach((eyeCamera, i) => {
      const isRight = i === 1;
      const m00 = eyeCamera.projectionMatrix.elements[0];
      const m11 = eyeCamera.projectionMatrix.elements[5];
      const x = (state.prism.h / 100) * m00 * (isRight ? -1 : 1);
      const y = (state.prism.v / 100) * m11 * (isRight ? 1 : -1);
      shiftMatrix.makeTranslation(x, y, 0);
      eyeCamera.projectionMatrix.premultiply(shiftMatrix);
      eyeCamera.projectionMatrixInverse.copy(eyeCamera.projectionMatrix).invert();
    });
  }

  // --- head roll from the XR camera pose (fresh by the time the animation-loop callback runs).
  // Roll is how far the head's X axis is lifted out of the world-horizontal plane.
  const headX = new THREE.Vector3();
  function headRollDegrees() {
    const xrCamera = renderer.xr.getCamera();
    headX.set(1, 0, 0).applyQuaternion(xrCamera.quaternion);
    return THREE.MathUtils.radToDeg(Math.atan2(headX.y, Math.hypot(headX.x, headX.z)));
  }

  // --- render loop: maintains the level state and bubble, applies the candidate prism.
  renderer.setAnimationLoop(() => {
    const roll = headRollDegrees();
    state.level = Math.abs(roll) <= ROLL_LIMIT_DEG;
    bubble.position.x = THREE.MathUtils.clamp(roll / 10, -1, 1) * 0.11;
    bubbleMaterial.color.setHex(state.level ? 0x2fa84f : 0xd93025);
    trackMaterial.color.setHex(state.level ? 0x334155 : 0x7a2030);
    applyPrism();
    renderer.render(scene, camera);
  });

  // --- session start.
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['hand-tracking', 'local-floor'] });
  } catch (e) {
    alert('Could not start the VR session: ' + e.message);
    return;
  }
  await renderer.xr.setSession(session);
  session.addEventListener('select', onSelect);

  const record = {
    app: 'vision-prescription',
    patientName,
    targetDistanceMeters: TARGET_DISTANCE,
    startedUtc: new Date().toISOString(),
    durationSeconds: 0,
    prescription: { horizontalDiopters: null, verticalDiopters: null },
    results: [],
    notes: [],
    events: [],
  };
  const startedAt = performance.now();
  const logEvent = message => record.events.push(`${new Date().toISOString()} ${message}`);

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function say(clipId) {
    state.speaking = true;
    await speak(clipId);
    state.speaking = false;
    state.selected = false; // presses made during speech don't count
  }

  function waitForSelect(timeoutMs) {
    state.selected = false;
    const started = performance.now();
    return new Promise(resolve => {
      const poll = () => {
        if (state.selected) { state.selected = false; resolve({ confirmed: true, ms: performance.now() - started }); }
        else if (performance.now() - started > timeoutMs) { resolve({ confirmed: false, ms: timeoutMs }); }
        else { setTimeout(poll, 16); }
      };
      poll();
    });
  }

  // Tilted-head time simply doesn't count: nothing is presented until the head is level again.
  async function waitUntilLevel() {
    let lastNudge = 0;
    while (!state.level) {
      if (performance.now() - lastNudge > 8000) {
        lastNudge = performance.now();
        speak('level_head'); // fire-and-forget; selects are already ignored while tilted
      }
      await sleep(100);
    }
  }

  // One doctor's question: "better with one... or two?" Option 1 then option 2 are presented
  // (candidate prism applied + label + voice), each followed by a silent answer window; the
  // patient selects while their preferred view is showing. Two full rounds with no selection
  // = "no preference" - a finding meaning the options look alike, never an error.
  async function betterWithOneOrTwo(axis, option1, option2) {
    for (let round = 0; round < 2; round++) {
      for (const [which, value, clip] of [[1, option1, 'one'], [2, option2, 'two']]) {
        await waitUntilLevel();
        setChoiceLabel(which);
        state.prism[axis] = value;
        await say(clip);
        const response = await waitForSelect(ANSWER_WINDOW_MS);
        if (response.confirmed) { setChoiceLabel(null); return which; }
      }
    }
    setChoiceLabel(null);
    return null;
  }

  // Bracketing staircase on one axis, the phoropter way: compare value-step vs value+step,
  // move to whichever the patient prefers, halve the step whenever the preferred direction
  // reverses (or when they can't tell the options apart), finish at quarter-diopter precision.
  // The other axis's already-found value stays applied throughout, like a doctor leaving the
  // horizontal Risley prism in place while refining vertical.
  async function measureAxis(axis, label, startStep, maxDiopters, introClip) {
    const result = { activityId: `${label}_forced_choice`, summary: '', measurements: [] };
    await say(introClip);

    let value = 0;
    let step = startStep;
    let lastDirection = 0;
    let trials = 0;
    let answered = 0;

    while (step >= 0.25 && trials < 14) {
      trials++;
      const option1 = THREE.MathUtils.clamp(value - step, -maxDiopters, maxDiopters);
      const option2 = THREE.MathUtils.clamp(value + step, -maxDiopters, maxDiopters);
      const choice = await betterWithOneOrTwo(axis, option1, option2);

      if (choice === null) {
        result.measurements.push(`trial ${trials}: no preference between ${option1.toFixed(2)}Δ and ${option2.toFixed(2)}Δ`);
        step /= 2;
        continue;
      }

      answered++;
      const chosen = choice === 1 ? option1 : option2;
      result.measurements.push(`trial ${trials}: preferred ${choice} (${chosen.toFixed(2)}Δ over ${(choice === 1 ? option2 : option1).toFixed(2)}Δ)`);
      const direction = Math.sign(chosen - value);
      if (lastDirection !== 0 && direction !== 0 && direction !== lastDirection) {
        step /= 2; // reversal: we've bracketed the answer, refine
      }
      if (direction !== 0) lastDirection = direction;
      value = chosen;
    }

    state.prism[axis] = value; // leave the found correction in place for the next axis
    if (trials >= 14) record.notes.push(`${label}: stopped at trial cap`);
    result.summary = answered > 0
      ? `${label}: ${value.toFixed(2)}Δ after ${trials} comparisons`
      : `${label}: no preference at any step - none needed`;
    record.results.push(result);
    logEvent(result.summary);
    return answered > 0 ? value : 0;
  }

  // --- the exam.
  try {
    await say('welcome');
    chart.visible = true;

    record.prescription.horizontalDiopters =
      await measureAxis('h', 'horizontal', 4, 10, 'horizontal_intro');
    record.prescription.verticalDiopters =
      await measureAxis('v', 'vertical', 2, 6, 'vertical_intro');

    chart.visible = false;
    await say('all_done');
  } catch (e) {
    logEvent(`session ended early: ${e.message}`);
  } finally {
    record.durationSeconds = (performance.now() - startedAt) / 1000;
    saveRecord(record);
    state.prism.h = 0;
    state.prism.v = 0;
    session.removeEventListener('select', onSelect);
    try { await session.end(); } catch { /* already ended */ }
    renderer.setAnimationLoop(null);
    renderer.dispose();
  }
}
