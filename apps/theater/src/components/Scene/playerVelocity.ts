// Module-level singleton carrying the local player's TRUE planar (XZ) velocity,
// written by Player.tsx from the ecctrl rigid body's `linvel()` each frame and
// read by LocalPresence.tsx for animState classification.
//
// Why a module singleton (matching this app's existing cross-component channels
// -- Theater.tsx's `theaterEnvRef`, multiplayer/store.ts's `peerBuffers`,
// playback/store.ts's `sharedVideoElement`): <Player> lives inside <Physics>
// and owns the ecctrl ref; <LocalPresence> is mounted OUTSIDE <Physics> and
// only reads the camera, so it has no direct path to the rigid body. Rather
// than prop-drill a ref through Scene.tsx (out of scope for both components) or
// lift ecctrl out of <Physics>, Player publishes its velocity here and
// LocalPresence reads it -- the same sibling-to-sibling handoff pattern the
// rest of Scene/ already uses.
//
// This replaces LocalPresence's earlier camera-position-delta velocity, which
// was runtime-proven (via frame-by-frame velocity logging) to cause the "walk
// animation keeps playing ~1s after you stop" lag: a per-render-frame delta of
// the ecctrl-driven camera aliases against the fixed 60 Hz physics step (0 on
// frames between steps, ~2x on the frame one lands), which forced an EMA
// low-pass to ride over the zero frames -- and that EMA's decay tail lagged the
// classified stop by ~0.32s (smoothed speed still read 1.3 m/s a frame after
// the true velocity had already hit 0). `linvel()` is the rigid body's real
// velocity: accurate magnitude with NO aliasing AND a sharp edge on start/stop,
// so no smoothing -- and none of its latency -- is needed.
export const playerVelocity = { x: 0, z: 0 }
