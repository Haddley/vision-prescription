# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Vision Prescription** — a WebXR prism-prescription finder: the sister app to **Vision Home**
(`~/code/vision-home`), which *simulates* a known prism prescription during Brock-string
training. This app *estimates* that prescription the way an eye doctor does: the patient looks
at a letter **H** with both eyes while the app alternates two candidate prism settings —
"one… two…" — and the patient picks whichever looks more single and comfortable. A bracketing
staircase (halve the step on every preference reversal) converges to quarter-diopter precision,
horizontal axis first, then vertical with the found horizontal correction left in place, then a
dissociated two-line cyclotorsion screen (double-Maddox-rod analog) with the full prism in place.

The result is reported in exactly the per-eye convention Vision Home's start-page prism fields
accept (horizontal: Δ base out each eye; vertical: Δ right eye base down / left base up), so a
positive result can be typed straight into Vision Home. Negative results (base in / opposite
vertical) are recorded and displayed but flagged — Vision Home's fields don't accept them.
This is a screening estimate for a professional to review, not a diagnosis.

## Architecture

Static site, **no build step, no framework, no dependencies to install** (same doctrine as
Vision Home):

- `index.html` — landing page: patient name, latest suggestion, past-measurements table, JSON
  download. Settings persist in `localStorage` (`visionPrescriptionSettings`).
- `main.js` — everything else: records, audio, the WebXR session, the forced-choice exam. One
  file on purpose.
- `audio/*.m4a` — pre-generated speech clips (see the TTS trap below).
- `lib/three.module.js` — vendored three.js r160, copied from Vision Home. No CDN at runtime.

## Hard-won rules (inherited from Vision Home — violating these re-breaks fixed bugs)

- **Never use `speechSynthesis`.** Meta's Quest Browser doesn't implement it — utterances
  neither speak nor fire `onend`. Voice = pre-generated clips:
  `say -o /tmp/x.aiff "phrase"` then `afconvert -f m4af -d aac -b 64000 /tmp/x.aiff audio/x.m4a`,
  register the id in `speechClips` in `main.js`. Playback must stay stall-proof (the `speak()`
  promise resolves on a duration cap even if the clip never plays).
- **The patient's only control is the WebXR `select` event** (trigger / hand pinch / Vision Pro
  look-and-pinch). A two-alternative choice is therefore expressed by **timing**: the patient
  selects *while their preferred option is on screen*. Never add other input; that one rule is
  what makes the app work unmodified on Vision Pro. Selects during speech are ignored.
- **Prism** is a per-eye translation premultiplied onto each eye camera's projection matrix
  **every frame** (`applyPrism`), after the XR view update and before `renderer.render` —
  identical math and sign convention to Vision Home's `applyPrism`, except the values here are
  signed staircase candidates rather than a fixed prescription. Keep the two implementations
  in lockstep or the number this app finds stops being the number that works in Vision Home.
- **Timeouts / no-selection are findings, never errors** — "no preference" means the two
  options look alike (so the staircase halves its step); it is recorded and moved past.
- **Privacy invariant**: settings and records live in `localStorage` only; the JSON download is
  the sole way data leaves the browser. Never add network calls carrying patient data.

## Rules specific to this app

- **Head-level gating**: prism axes are only meaningful with a level head. The render loop
  computes head roll from the XR camera pose every frame; beyond `ROLL_LIMIT_DEG` the
  camera-fixed bubble level turns red, selects are ignored, and the routine waits (with a
  spoken nudge) before presenting anything. Tilted time must never advance the exam.
- **Both eyes see the H** during the prism stages — a binocular singleness/comfort comparison.
  The **cyclotorsion stage is the one deliberately dissociated activity**: each eye sees its
  own line via three.js layers (WebXRManager renders layer 1 to the left eye only, layer 2 to
  the right eye only); the staircase rotates the right eye's line (positive = right eye
  excyclo). The roll gate tightens to `CYCLO_ROLL_LIMIT_DEG` for this stage and must be
  restored afterwards (including in the `finally`). Torsion is **report-only**: no prism
  corrects rotation and Vision Home has no field for it.
- **Never rush the patient**: the answer window grows (never shrinks) when a pass gets no
  selection or an answer lands late, and reassurance clips play before re-showing a pair and
  after no-preference trials. Pauses (head tilt) are announced out loud, not just shown.
- **`interpretFindings` is educational, never diagnostic.** Pattern notes combine the measured
  numbers ("consistent with a superior oblique weakness…") and must keep hedged wording plus
  the see-a-professional framing; never assert a diagnosis.
- Letters ("H", "1", "2") are drawn with `CanvasTexture` — no font assets; keep it that way.

## Workflow

- **Local on-headset testing**: `python3 -m http.server` here, then
  `adb reverse tcp:8000 tcp:8000`, open `http://localhost:8000` in the Quest browser. There is
  no remote console: debugging is by observable behavior + the record, so prefer changes whose
  success is visible in-headset.
- `node --check main.js` for a quick syntax gate before pushing.
- Records append to `localStorage.visionPrescriptionRecords`; shape mirrors Vision Home's
  (`results[]` of `{ activityId, summary, measurements }`, plus `prescription` and `notes`).
