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
// Cyclotorsion (degrees, positive = right eye excyclodeviation) is a screening finding only:
// no prism corrects rotation and Vision Home has no field for it, so it is never "enterable" -
// it exists to be shown to a professional. Old records predate the field (undefined).
function describeCyclo(d) {
  if (d === null || d === undefined) return 'not measured';
  if (Math.abs(d) < 0.5) return 'none detected';
  return `${Math.abs(d).toFixed(1)}° ${d > 0 ? 'excyclo' : 'incyclo'} (right eye) — prism cannot correct this`;
}

// ---------- interpretation: educational pattern notes, NOT a diagnosis -----------------------
// Combines the measured numbers into the kind of context a doctor would mention out loud:
// which way the eyes tend to drift, and which combinations (vertical deviation plus same-side
// torsion - the fourth-nerve signature) deserve prompt review. Sign conventions: h > 0 base
// out = inward drift (esophoria); v > 0 right eye base down = right eye higher; c > 0 right
// eye excyclotorsion. Wording must stay at "pattern consistent with / discuss with your
// professional" - never assert a diagnosis.
function interpretFindings(p) {
  const notes = [];
  const h = p.horizontalDiopters, v = p.verticalDiopters;
  const c = p.cycloDegrees ?? null;
  const vSig = v !== null && Math.abs(v) >= 0.25;
  const cSig = c !== null && Math.abs(c) >= 0.5;

  if (h !== null && h >= 0.25) {
    notes.push('Needing base-out prism suggests the eyes tend to drift inward (an esophoria). ' +
      'Small amounts are common; in adults it can go along with uncorrected farsightedness or sustained near work.');
  } else if (h !== null && h <= -0.25) {
    notes.push('Needing base-in prism suggests the eyes tend to drift outward (an exophoria). ' +
      'The most common cause is convergence insufficiency, which often improves with exercises such as Brock-string training.');
  }

  if (vSig && cSig && Math.sign(v) === Math.sign(c)) {
    const side = v > 0 ? 'right' : 'left';
    notes.push(`A higher ${side} eye together with torsion in the matching direction is the classic pattern of a ` +
      `superior oblique (fourth cranial nerve) weakness on the ${side} side. Long-standing cases are often congenital ` +
      'and benign - a lifelong head tilt in old photos is a common clue - but if this is new, seek evaluation promptly.');
  } else {
    if (vSig) {
      notes.push(`A vertical misalignment with the ${v > 0 ? 'right' : 'left'} eye higher. Even small vertical ` +
        'deviations strain fusion; the most common single cause is a fourth-nerve (superior oblique) weakness.');
    }
    if (cSig) {
      notes.push('Torsion without a matching vertical deviation is an unusual pattern - worth professional review.');
    }
  }

  if ((v !== null && Math.abs(v) >= 2) || (c !== null && Math.abs(c) >= 5)) {
    notes.push('If this misalignment is new (weeks rather than years) or arrived with other symptoms, ' +
      'see an eye-care professional promptly - sudden-onset deviations can have neurological causes.');
  }

  if (!notes.length && (h !== null || v !== null)) {
    notes.push('No significant misalignment pattern - nothing here suggests more than everyday variation.');
  }
  return notes;
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
      `<td>${describeCyclo(p.cycloDegrees)}</td>` +
      `<td>${record.notes.join('; ') || ''}</td>`;
    tbody.appendChild(row);
  }
}

function renderLatest() {
  const latest = loadRecords().at(-1);
  const el = document.getElementById('latest');
  const hint = document.getElementById('latestHint');
  const interp = document.getElementById('interpretation');
  if (!latest) { el.textContent = 'No measurement yet.'; hint.style.display = 'none'; interp.innerHTML = ''; return; }
  const p = latest.prescription;
  el.classList.remove('muted');
  el.innerHTML = `Horizontal: <b>${describeHorizontal(p.horizontalDiopters)}</b><br>` +
    `Vertical: <b>${describeVertical(p.verticalDiopters)}</b><br>` +
    `Cyclotorsion: <b>${describeCyclo(p.cycloDegrees)}</b>`;
  hint.style.display = '';
  const notes = interpretFindings(p);
  interp.innerHTML = notes.length
    ? '<b>What this can mean</b><ul>' + notes.map(n => `<li>${n}</li>`).join('') + '</ul>' +
      'These are educational pattern notes generated from the numbers above, not a diagnosis.'
    : '';
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
for (const id of ['welcome', 'horizontal_intro', 'vertical_intro', 'cyclo_intro', 'one', 'two',
                  'level_head_left', 'level_head_right', 'all_done', 'take_your_time',
                  'no_preference_ok', 'doing_great']) {
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

const ROLL_LIMIT_DEG = 3;        // head roll beyond this pauses the measurement (prism stages)
const CYCLO_ROLL_LIMIT_DEG = 1.5; // tighter gate while measuring torsion: the lines are
                                  // head-fixed, but ocular counter-rolling still bleeds a
                                  // fraction of any head roll into the measured angle
const TARGET_DISTANCE = 2.0;   // metres; comfortably near the headset's optical focal distance
const ANSWER_WINDOW_MS = 2200;     // starting silent time after "one"/"two" during which a select chooses it
const ANSWER_WINDOW_MAX_MS = 6000; // the window grows toward this when the patient needs longer looks

// State shared between the routine (async), the render loop, and the select handler.
const state = {
  selected: false,   // set by the select handler, consumed by waitForSelect
  speaking: false,   // selects during speech are ignored (don't race the prompt)
  level: true,       // maintained by the render loop from head roll; gates selects + trials
  rollDeg: 0,        // signed head roll, updated every frame; positive = right side raised
                     // = head tilted towards the LEFT shoulder (drives the directional nudge)
  rollLimitDeg: ROLL_LIMIT_DEG, // tightened during the cyclotorsion stage
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

  // --- cyclotorsion targets: the dissociated double-Maddox-rod analog. Each eye sees ONE
  // horizontal line (three.js's WebXRManager renders layer 1 to the left eye only and layer 2
  // to the right eye only), vertically separated so both are visible at once and there is
  // nothing to fuse. Dissociated, each line appears tilted by that eye's cyclodeviation; the
  // staircase rotates the right eye's line until the patient says the pair looks parallel.
  const cycloGroup = new THREE.Group();
  chart.add(cycloGroup);
  const lineLeft = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.012),
    new THREE.MeshBasicMaterial({ color: 0xff5252 }));
  lineLeft.position.y = 0.07;
  lineLeft.layers.set(1); // left eye only
  const lineRight = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.012),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  lineRight.position.y = -0.07;
  lineRight.layers.set(2); // right eye only
  cycloGroup.add(lineLeft, lineRight);
  cycloGroup.visible = false;

  // Candidate torsion, in degrees, positive = right eye excyclodeviation. To neutralize a
  // torsion the stimulus is rotated WITH the eye (same as turning a Maddox rod's axis); for
  // the right eye, excyclo is clockwise from the patient's viewpoint, i.e. negative
  // rotation.z. Rotation is about the line's own centre, like the rod in a trial frame.
  function applyCycloCandidate(degrees) {
    lineRight.rotation.z = -THREE.MathUtils.degToRad(degrees);
  }

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
    state.rollDeg = roll;
    state.level = Math.abs(roll) <= state.rollLimitDeg;
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
    prescription: { horizontalDiopters: null, verticalDiopters: null, cycloDegrees: null },
    results: [],
    notes: [],
    events: [],
    interpretation: [],
  };
  const startedAt = performance.now();
  const logEvent = message => record.events.push(`${new Date().toISOString()} ${message}`);

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Pacing: a patient who finds a comparison hard gets LONGER looks, never pressure. Fusion
  // can take a while to settle on each option, so the answer window grows whenever a full
  // pass gets no selection or an answer only lands at the very end of the window. It never
  // shrinks and carries across trials and axes - slow fusion early means slow fusion later.
  let answerWindowMs = ANSWER_WINDOW_MS;
  function extendAnswerWindow() {
    const extended = Math.min(answerWindowMs * 1.5, ANSWER_WINDOW_MAX_MS);
    if (extended > answerWindowMs) {
      answerWindowMs = extended;
      logEvent(`answer window extended to ${Math.round(answerWindowMs)}ms`);
    }
  }

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
  // The patient is TOLD why the exam paused - the red bubble alone is easy to miss. A short
  // grace period absorbs momentary wobbles, then a calm spoken reminder plays straight away
  // and repeats every 15 seconds (longer than the clip - speak() restarts the shared Audio
  // element, so a shorter interval would cut the sentence off) until the head is level.
  async function waitUntilLevel() {
    if (state.level) return;
    logEvent('paused: waiting for level head');
    await sleep(1500);
    let lastNudge = -Infinity;
    while (!state.level) {
      if (performance.now() - lastNudge > 15000) {
        lastNudge = performance.now();
        // Direction re-read on every repeat in case the patient overcorrected past level.
        // Positive roll = right side raised = tilted towards the left shoulder.
        speak(state.rollDeg > 0 ? 'level_head_left' : 'level_head_right'); // fire-and-forget; selects are already ignored while tilted
      }
      await sleep(100);
    }
  }

  // One doctor's question: "better with one... or two?" Option 1 then option 2 are presented
  // (candidate prism applied + label + voice), each followed by a silent answer window; the
  // patient selects while their preferred view is showing. Two full rounds with no selection
  // = "no preference" - a finding meaning the options look alike, never an error.
  async function betterWithOneOrTwo(applyCandidate, option1, option2) {
    for (let round = 0; round < 2; round++) {
      if (round === 1) {
        // No choice on the first pass usually means the view hasn't settled yet, not a
        // missed cue: reassure, and give both options a longer look the second time round.
        extendAnswerWindow();
        setChoiceLabel(null);
        await waitUntilLevel();
        await say('take_your_time');
      }
      for (const [which, value, clip] of [[1, option1, 'one'], [2, option2, 'two']]) {
        await waitUntilLevel();
        setChoiceLabel(which);
        applyCandidate(value);
        await say(clip);
        const response = await waitForSelect(answerWindowMs);
        if (response.confirmed) {
          if (response.ms > answerWindowMs * 0.75) extendAnswerWindow(); // answered, but only just in time
          setChoiceLabel(null);
          return which;
        }
      }
    }
    setChoiceLabel(null);
    return null;
  }

  // Bracketing staircase on one quantity, the phoropter way: compare value-step vs value+step,
  // move to whichever the patient prefers, halve the step whenever the preferred direction
  // reverses (or when they can't tell the options apart), finish at minStep precision.
  // applyCandidate maps a signed value onto the stimulus (prism diopters onto an eye-camera
  // shift, or torsion degrees onto the right eye's line); everything already found stays
  // applied throughout, like a doctor leaving the horizontal Risley prism in place while
  // refining vertical.
  async function measureStaircase({ label, introClip, applyCandidate, format, startStep, minStep, maxValue }) {
    const result = { activityId: `${label}_forced_choice`, summary: '', measurements: [] };
    await say(introClip);

    let value = 0;
    let step = startStep;
    let lastDirection = 0;
    let trials = 0;
    let answered = 0;

    while (step >= minStep && trials < 14) {
      trials++;
      const option1 = THREE.MathUtils.clamp(value - step, -maxValue, maxValue);
      const option2 = THREE.MathUtils.clamp(value + step, -maxValue, maxValue);
      const choice = await betterWithOneOrTwo(applyCandidate, option1, option2);

      if (choice === null) {
        result.measurements.push(`trial ${trials}: no preference between ${format(option1)} and ${format(option2)}`);
        step /= 2;
        await say('no_preference_ok'); // looking alike is a finding, not a failure - tell them so
        continue;
      }

      answered++;
      if (answered % 3 === 0) await say('doing_great');
      const chosen = choice === 1 ? option1 : option2;
      result.measurements.push(`trial ${trials}: preferred ${choice} (${format(chosen)} over ${format(choice === 1 ? option2 : option1)})`);
      const direction = Math.sign(chosen - value);
      if (lastDirection !== 0 && direction !== 0 && direction !== lastDirection) {
        step /= 2; // reversal: we've bracketed the answer, refine
      }
      if (direction !== 0) lastDirection = direction;
      value = chosen;
    }

    applyCandidate(value); // leave the found correction in place for the next stage
    if (trials >= 14) record.notes.push(`${label}: stopped at trial cap`);
    result.summary = answered > 0
      ? `${label}: ${format(value)} after ${trials} comparisons`
      : `${label}: no preference at any step - none needed`;
    record.results.push(result);
    logEvent(result.summary);
    return answered > 0 ? value : 0;
  }

  const prism = v => `${v.toFixed(2)}Δ`;
  const degrees = v => `${v.toFixed(2)}°`;

  // --- the exam.
  try {
    await say('welcome');
    chart.visible = true;

    record.prescription.horizontalDiopters = await measureStaircase({
      label: 'horizontal', introClip: 'horizontal_intro', format: prism,
      applyCandidate: v => { state.prism.h = v; }, startStep: 4, minStep: 0.25, maxValue: 10,
    });
    record.prescription.verticalDiopters = await measureStaircase({
      label: 'vertical', introClip: 'vertical_intro', format: prism,
      applyCandidate: v => { state.prism.v = v; }, startStep: 2, minStep: 0.25, maxValue: 6,
    });

    // Cyclotorsion runs last, with the found prism left in place - an uncorrected vertical
    // deviation would push the two lines apart and make the parallelism judgment harder.
    letter.visible = false;
    cycloGroup.visible = true;
    state.rollLimitDeg = CYCLO_ROLL_LIMIT_DEG;
    record.prescription.cycloDegrees = await measureStaircase({
      label: 'cyclotorsion', introClip: 'cyclo_intro', format: degrees,
      applyCandidate: applyCycloCandidate, startStep: 4, minStep: 0.5, maxValue: 10,
    });
    state.rollLimitDeg = ROLL_LIMIT_DEG;
    cycloGroup.visible = false;
    if (Math.abs(record.prescription.cycloDegrees) >= 0.5) {
      record.notes.push('cyclotorsion found - prism cannot correct rotation; needs professional review');
    }

    chart.visible = false;
    await say('all_done');
  } catch (e) {
    logEvent(`session ended early: ${e.message}`);
  } finally {
    record.durationSeconds = (performance.now() - startedAt) / 1000;
    record.interpretation = interpretFindings(record.prescription);
    saveRecord(record);
    state.prism.h = 0;
    state.prism.v = 0;
    state.rollLimitDeg = ROLL_LIMIT_DEG;
    session.removeEventListener('select', onSelect);
    try { await session.end(); } catch { /* already ended */ }
    renderer.setAnimationLoop(null);
    renderer.dispose();
  }
}
