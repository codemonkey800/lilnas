import { PerspectiveCamera, Vector3 } from 'three'

import {
  applyMouseDelta,
  INITIAL_LOOK,
  type Look,
  LOOK_PITCH_MAX_RAD,
  LOOK_PITCH_MIN_RAD,
  LOOK_SENSITIVITY_RAD_PER_PX,
  lookFromDirection,
  lookToEuler,
} from 'src/components/Scene/firstPersonLook'

// Applies a look to a real three.js camera the same way Player.tsx does and
// returns where it ends up facing.
function directionFor(look: Look): Vector3 {
  const camera = new PerspectiveCamera()
  const euler = lookToEuler(look)
  camera.rotation.set(euler.x, euler.y, 0, 'YXZ')
  camera.updateMatrixWorld()
  return camera.getWorldDirection(new Vector3())
}

// Wraps into [-PI, PI] so yaws that differ by a full turn compare equal.
function wrap(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians))
}

describe('applyMouseDelta', () => {
  it('turns right on a rightward move and looks down on a downward move', () => {
    const next = applyMouseDelta(INITIAL_LOOK, 100, 50)

    expect(next.yaw).toBeCloseTo(-100 * LOOK_SENSITIVITY_RAD_PER_PX)
    expect(next.pitch).toBeCloseTo(-50 * LOOK_SENSITIVITY_RAD_PER_PX)

    // Negative yaw in the atan2(x, z) convention is toward -X, which is the
    // camera's right when facing +Z.
    const dir = directionFor(next)
    expect(dir.x).toBeLessThan(0)
    expect(dir.y).toBeLessThan(0)
  })

  it('clamps pitch at both limits instead of overshooting', () => {
    expect(applyMouseDelta(INITIAL_LOOK, 0, 100_000).pitch).toBe(
      LOOK_PITCH_MIN_RAD,
    )
    expect(applyMouseDelta(INITIAL_LOOK, 0, -100_000).pitch).toBe(
      LOOK_PITCH_MAX_RAD,
    )
  })

  it('leaves yaw unbounded', () => {
    const next = applyMouseDelta(INITIAL_LOOK, -10_000, 0)
    expect(next.yaw).toBeCloseTo(10_000 * LOOK_SENSITIVITY_RAD_PER_PX)
  })

  it('does not mutate its input', () => {
    const look = { yaw: 0.5, pitch: 0.1 }
    applyMouseDelta(look, 10, 10)
    expect(look).toEqual({ yaw: 0.5, pitch: 0.1 })
  })
})

describe('lookToEuler', () => {
  it('faces +Z, level, for the initial look', () => {
    const dir = directionFor(INITIAL_LOOK)
    expect(dir.x).toBeCloseTo(0)
    expect(dir.y).toBeCloseTo(0)
    expect(dir.z).toBeCloseTo(1)
  })
})

describe('lookFromDirection', () => {
  it('reads yaw from atan2(x, z) and pitch from asin(y)', () => {
    const look = lookFromDirection(new Vector3(1, 0, 0))
    expect(look.yaw).toBeCloseTo(Math.PI / 2)
    expect(look.pitch).toBeCloseTo(0)
  })

  it('round-trips through a real camera for any in-range look', () => {
    const looks: Look[] = [
      { yaw: 0, pitch: 0 },
      { yaw: 1.2, pitch: 0.4 },
      { yaw: -2.9, pitch: -1.1 },
      { yaw: 3.1, pitch: LOOK_PITCH_MAX_RAD },
      { yaw: -0.3, pitch: LOOK_PITCH_MIN_RAD },
    ]

    for (const look of looks) {
      const back = lookFromDirection(directionFor(look))
      expect(wrap(back.yaw - look.yaw)).toBeCloseTo(0, 6)
      expect(back.pitch).toBeCloseTo(look.pitch, 6)
    }
  })

  // The stand_up -> standing hand-off: SeatedCamera.tsx's applyLook writes
  // `rotation.set(pitch, PI + seat.yaw + yaw, 0, 'YXZ')`, and Player.tsx
  // re-seeds from that camera on unfreeze. The follow camera's first frame
  // must face exactly where the seated camera's last frame did.
  it('re-seeds onto the exact view a seated camera left behind', () => {
    const seated = new PerspectiveCamera()
    seated.rotation.set(0.3, Math.PI + -2.4 + 0.5, 0, 'YXZ')
    seated.updateMatrixWorld()
    const seatedDir = seated.getWorldDirection(new Vector3())

    const followDir = directionFor(lookFromDirection(seatedDir))

    expect(followDir.distanceTo(seatedDir)).toBeCloseTo(0, 6)
  })

  it('clamps a direction steeper than the pitch limits', () => {
    expect(lookFromDirection(new Vector3(0, -1, 0)).pitch).toBe(
      LOOK_PITCH_MIN_RAD,
    )
    expect(lookFromDirection(new Vector3(0, 1, 0)).pitch).toBe(
      LOOK_PITCH_MAX_RAD,
    )
  })
})
