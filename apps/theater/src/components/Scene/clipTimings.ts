// Measured clip durations for the two one-shot sit/stand animations (A1,
// PLAN.md "A1 -- convert the three sit clips (D1)" / ORCHESTRATE.md §1
// "Seat + clip data"). These are a MEASUREMENT OUTPUT of converting the
// staged FBX files, not eyeballed -- read directly off each GLB's
// `AnimationClip.duration` via the real three.js `GLTFLoader` (never the raw
// glTF JSON: the loader sanitizes node names, which is what makes the JSON
// misleading for anything bone-related, per Avatar.tsx's withMixamoPrefix
// comment). Both clips run at a clean 60fps: 267 frames (sitting-down) and
// 169 frames (stand-up).
//
// `sitting-idle.glb` (the seated loop) has no fixed "duration" that matters
// here -- confirmed to convert and bind correctly, but intentionally has no
// exported constant.

// Measured from public/animations/sitting-down.glb.
const MEASURED_SIT_DOWN_DURATION_S = 4.45

// Measured from public/animations/stand-up.glb.
const MEASURED_STAND_UP_DURATION_S = 2.816667

// How much faster than their authored (measured) speed the sit/stand
// ONE-SHOT clips actually play -- bugfix: at native speed (4.45s / 2.82s)
// both transitions read as "way too slow" for a camera-driven,
// no-visible-local-body seat flow, well outside an ordinary sit/stand
// cadence. Eyeballed as "reads naturally," same "no live browser to tune
// against" convention as this app's other unmeasurable-without-a-browser
// constants (e.g. Avatar.tsx's NATURAL_SPEED_MPS) -- a reasonable starting
// point, not a final tuned value.
//
// Applied to BOTH the one-shot clips' own `AnimationAction.timeScale`
// (Avatar.tsx) and the derived durations below, which SeatedCamera.tsx eases
// the local camera over -- the two must move at the same rate, or a remote
// viewer's avatar clip and the local sitter's own camera ease drift apart.
// Deriving `SIT_DOWN_DURATION_S`/`STAND_UP_DURATION_S` from this one
// constant (rather than hand-typing the scaled result) is what keeps them
// mechanically unable to drift apart from Avatar.tsx's own timeScale.
export const SIT_STAND_PLAYBACK_RATE = 3

// Consumers: F4's <SeatedCamera> eases the local camera position/look-clamp
// over these durations (there is no local <Avatar> to key a completion
// callback off, per the Phase-2 no-local-body decision), while F5's
// <RemoteAvatar> advances its one-shot state machine off the real clip via
// the mixer's own 'finished' event -- which, driven by the SAME
// `SIT_STAND_PLAYBACK_RATE` timeScale (Avatar.tsx), fires after exactly this
// many real-world seconds. The two stay in sync only because both derive
// from the measured source of truth above -- re-measure
// MEASURED_SIT_DOWN_DURATION_S/MEASURED_STAND_UP_DURATION_S if either GLB is
// ever re-exported.
export const SIT_DOWN_DURATION_S =
  MEASURED_SIT_DOWN_DURATION_S / SIT_STAND_PLAYBACK_RATE

export const STAND_UP_DURATION_S =
  MEASURED_STAND_UP_DURATION_S / SIT_STAND_PLAYBACK_RATE
