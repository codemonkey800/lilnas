// The local player's first-person look state, owned by Player.tsx. ecctrl
// 2.0 dropped the follow camera 1.0.97 shipped (a `pivot`/`followCam` pair
// driven by its own pointer-locked mousemove listener -- see
// node_modules/ecctrl/dist/src-*.js: the 2.0 controller only ever READS the
// camera, via `camera.getWorldDirection`, to orient WASD), so the app now
// owns the camera's yaw/pitch itself. A plain `.ts` file rather than inline
// in Player.tsx so the math is unit-testable (this repo's jest config can't
// import a `.tsx`).
//
// Same angle conventions as SeatedCamera.tsx and seats.ts, so the seated
// hand-off in both directions is a plain copy: yaw is `atan2(dir.x, dir.z)`
// (0 == +Z, the screen end), pitch is `asin(dir.y)` (positive == looking up).

export type Look = { yaw: number; pitch: number }

// 1.0.97's onDocumentMouseMove: 0.002 rad per pixel on both axes (times
// camMoveSpeed, which Player.tsx never overrode from its default of 1).
// SeatedCamera.tsx reuses this so the seated view turns at the same rate.
export const LOOK_SENSITIVITY_RAD_PER_PX = 0.002

// 1.0.97's camLowLimit/camUpLimit defaults (-1.3 / 1.5), translated: its
// followCam.rotation.x was positive looking DOWN, so its 1.5 rad "up" limit
// is how far you could look down and its -1.3 how far up. Both stay short of
// +-PI/2, which keeps `atan2(dir.x, dir.z)` well defined in lookFromDirection.
export const LOOK_PITCH_MIN_RAD = -1.5
export const LOOK_PITCH_MAX_RAD = 1.3

// 1.0.97's camInitDir default: level, facing +Z.
export const INITIAL_LOOK: Look = { yaw: 0, pitch: 0 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function clampPitch(pitch: number): number {
  return clamp(pitch, LOOK_PITCH_MIN_RAD, LOOK_PITCH_MAX_RAD)
}

// One pointer-locked mousemove. Moving right turns right and moving down
// looks down, like 1.0.97. Pitch is clamped at the limits, where 1.0.97
// dropped the whole vertical step instead -- so a fast flick now lands
// exactly on the limit rather than stopping short of it.
export function applyMouseDelta(
  look: Look,
  movementX: number,
  movementY: number,
): Look {
  return {
    yaw: look.yaw - movementX * LOOK_SENSITIVITY_RAD_PER_PX,
    pitch: clampPitch(look.pitch - movementY * LOOK_SENSITIVITY_RAD_PER_PX),
  }
}

// The look that reproduces a camera's world direction. Player.tsx re-seeds
// from this on every unfreeze, so wherever SeatedCamera.tsx (or anything
// else holding the camera while the player is frozen) left the view is
// exactly where the follow camera picks up.
export function lookFromDirection(direction: {
  x: number
  y: number
  z: number
}): Look {
  return {
    yaw: Math.atan2(direction.x, direction.z),
    pitch: clampPitch(Math.asin(clamp(direction.y, -1, 1))),
  }
}

// The camera Euler angles (order 'YXZ', roll 0) for a look. The `Math.PI +`
// is the same correction SeatedCamera.tsx's applyLook documents: three.js
// cameras look down local -Z, while this convention's yaw 0 is +Z.
export function lookToEuler(look: Look): { x: number; y: number } {
  return { x: look.pitch, y: Math.PI + look.yaw }
}
