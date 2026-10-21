'use client'

import { KeyboardControlsEntry, useKeyboardControls } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Ecctrl, type EcctrlHandle, type MovementInput } from 'ecctrl'
import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'

import { usePlaybackStore } from 'src/playback/store'

import {
  applyMouseDelta,
  INITIAL_LOOK,
  lookFromDirection,
  lookToEuler,
} from './firstPersonLook'
import { playerVelocity } from './playerVelocity'
import { isFiniteVec3, isOutOfBounds } from './respawn'
import { seatPhaseRef } from './SeatedCamera'

export type Controls =
  'forward' | 'backward' | 'leftward' | 'rightward' | 'jump' | 'run'

export const KEYBOARD_MAP: KeyboardControlsEntry<Controls>[] = [
  { name: 'forward', keys: ['KeyW', 'ArrowUp'] },
  { name: 'backward', keys: ['KeyS', 'ArrowDown'] },
  { name: 'leftward', keys: ['KeyA', 'ArrowLeft'] },
  { name: 'rightward', keys: ['KeyD', 'ArrowRight'] },
  { name: 'jump', keys: ['Space'] },
  { name: 'run', keys: ['ShiftLeft', 'ShiftRight'] },
]

// Picked from the debug HUD's live position readout while standing on the
// raked floor, so the player spawns resting on the floor instead of falling
// onto it.
const SPAWN_POSITION: [number, number, number] = [2.19, 1.13, -3.62]
const SPAWN_VECTOR = {
  x: SPAWN_POSITION[0],
  y: SPAWN_POSITION[1],
  z: SPAWN_POSITION[2],
}
const ZERO_VELOCITY = { x: 0, y: 0, z: 0 }
const NO_MOVEMENT: MovementInput = {
  forward: false,
  backward: false,
  leftward: false,
  rightward: false,
  run: false,
  jump: false,
}

// Theater.tsx recenters the model so its lowest floor point is always
// exactly y=0 in world space — so falling this far below is unambiguously
// off the collision mesh, not a legitimate low point of a real floor.
// isOutOfBounds' NaN check catches ecctrl's separate NaN-position failure
// mode (see the capsule-sizing comment below) regardless of this threshold.
const RESPAWN_MIN_Y = -2

// The capsule is pinned to ecctrl 1.0.97's defaults rather than 2.0's
// (half-height 0.3, radius 0.3, float 0.2). 2.0's shape-cast float rests the
// capsule's bottom `floatHeight` above the ground, so these values keep the
// centre resting 0.35 + 0.3 + 0.3 = 0.95m up, exactly where 1.0.97 held it:
// SPAWN_POSITION, the eye height below and LocalPresence.tsx's
// EYE_TO_FEET_HEIGHT_M all carry over unchanged. Don't shrink it. On 1.0.97,
// shrinking the radius alone produced NaN positions within ~1-2s of
// sustained wall contact + a jump: the RigidBody's auto-computed mass drops
// with its volume, but the float spring's constants stay absolute, so the
// same forces overpower the lighter body. 2.0's float spring (springK /
// dampingC) is still mass-independent, and the NaN case hasn't been
// re-tested on 2.0.
const CAPSULE_HALF_HEIGHT = 0.35
const CAPSULE_RADIUS = 0.3
const FLOAT_HEIGHT = 0.3

// Movement tuning carried over from 1.0.97 so walking, running and jumping
// feel the same: its maxVelLimit default (2.5 m/s) times its sprintMult
// default (2), the jumpVel this file always set, its sprintJumpMult default
// (1.2, applied while run is held) and its fallingGravityScale default (2.5;
// 2.0's is 3). 2.0's acceleration/drag model is new (accDeltaTime/
// decDeltaTime have no 1.0.97 equivalent), so those stay at 2.0's defaults.
const MAX_WALK_VEL = 2.5
const MAX_RUN_VEL = 5
const JUMP_VEL = 2.5
const RUN_JUMP_MULT = 1.2
const FALLING_GRAVITY_SCALE = 2.5

// Eye height above the capsule centre. ecctrl 2.0 has no camera of its own
// (see firstPersonLook.ts), so this file now places the camera itself.
// 1.0.97 put its follow pivot at the centre + camTargetPos.y +
// capsuleHalfHeight + capsuleRadius / 2 = -0.2 + 0.35 + 0.15 = 0.3m, and
// camInitDis={-0.01} sat the camera on that pivot. The -0.2 was a pure
// visual offset (no physics feedback) that made the default eye height feel
// less like a looming adult, which is why it's kept.
const EYE_HEIGHT_ABOVE_BODY_M = 0.3

// ecctrl 2.0's per-frame loop returns on its very first line when `enable`
// is false, before ground detection, the float spring and its gravityScale
// management (applyDynamicGravity) run. See
// node_modules/ecctrl/dist/src-*.js. That leaves gravityScale at whatever it
// last set: 0 for a grounded character (2.0 holds it up with the spring
// alone), 1 while rising and FALLING_GRAVITY_SCALE while falling. Nothing
// damps the velocity either. A character frozen mid-jump (iPad opened in the
// air) would keep falling with no spring to catch it, fast enough to tunnel
// through the floor's thin trimesh collider (ecctrl has no CCD), and a
// grounded one would coast on whatever velocity it had. Freezing gravity +
// velocity here for the whole time `frozen` is true (iPad open OR any part
// of the seated state machine below, per `seatPhaseRef`) is what keeps the
// character "exactly in place". On unfreeze, gravityScale goes back to
// ecctrl's initial value (`props.gravityScale ?? 1`). applyDynamicGravity
// rewrites it for the actual ground/air state on its next awake frame
// anyway, so this only makes sure the frozen 0 never outlives the freeze.
const FROZEN_GRAVITY_SCALE = 0
const DEFAULT_GRAVITY_SCALE = 1 // ecctrl's initialGravityScale with no gravityScale prop

// A debug HUD only needs a human-readable refresh rate — pushing telemetry
// into React state at useFrame's display-refresh cadence (~60Hz) would mean
// 60 Scene re-renders/sec for numbers nobody can read that fast.
const TELEMETRY_INTERVAL_S = 0.1

export type Telemetry = {
  position: { x: number; y: number; z: number }
  velocity: { x: number; y: number; z: number }
}

export type PlayerProps = {
  onTelemetry?: (telemetry: Telemetry) => void
}

export function Player({ onTelemetry }: PlayerProps) {
  const ipadOpen = usePlaybackStore(state => state.ipadOpen)
  const ecctrlRef = useRef<EcctrlHandle>(null)
  // ecctrl 2.0 no longer reads drei's <KeyboardControls> itself -- input
  // only reaches it through `setMovement` (its README's "drive a controller
  // directly through its ref"). `getKeys` is polled once per frame below.
  // `runHeld` is the one key this component re-renders on, to switch
  // jumpVel for the running-jump boost (2.0 has no sprintJumpMult).
  const [, getKeys] = useKeyboardControls<Controls>()
  const runHeld = useKeyboardControls<Controls>(state => state.run)
  const lookRef = useRef(INITIAL_LOOK)
  const lookDirectionScratchRef = useRef(new Vector3())
  const telemetryElapsedRef = useRef(0)
  // Tracks "frozen as of the end of the last frame", written ONLY inside
  // useFrame below and read there and by the mousemove handler (never during
  // render -- react-hooks/refs flags exactly that) so the gravity-restore edge and the frozenState sync
  // below always compare against the previous frame's value, not whatever
  // frozenState happens to still read while a render is pending.
  const wasFrozenRef = useRef(ipadOpen)
  // The actual value read by the JSX below for <Ecctrl>'s `enable` prop --
  // see the sync comment inside useFrame for why this can't just be the ref
  // above.
  const [frozenState, setFrozenState] = useState(ipadOpen)

  // First-person mouse look, replacing ecctrl 1.0.97's own
  // onDocumentMouseMove. Gated on pointer lock like that one was (openIpad()
  // releases the lock but mousemove keeps firing), and also on `frozen`, which
  // 1.0.97's never was: its listener kept turning a hidden pivot the whole
  // time the player was seated or the iPad was open. Here nothing accumulates
  // while frozen, and useFrame re-seeds the look from the camera on unfreeze.
  // 1.0.97 also turned the view on a mouse drag without pointer lock, and on
  // a one-finger touch drag. Neither is carried over: clicking the canvas
  // requests pointer lock (Scene.tsx's requestLook).
  useEffect(() => {
    function handleMouseMove(event: MouseEvent): void {
      if (wasFrozenRef.current || !document.pointerLockElement) return
      lookRef.current = applyMouseDelta(
        lookRef.current,
        event.movementX,
        event.movementY,
      )
    }

    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  useFrame((state, delta) => {
    const ecctrl = ecctrlRef.current
    const body = ecctrl?.body
    if (!ecctrl || !body) return

    // Bugfix: no seat teleport here anymore. The old behavior moved the
    // physics body's ORIGIN (the ecctrl capsule's centre) to the seat's
    // FLOOR position — but ecctrl's floating capsule rests with its centre
    // `capsuleHalfHeight + capsuleRadius + floatHeight` above the ground
    // (the CAPSULE_* / FLOAT_HEIGHT constants above: 0.35 + 0.3 + 0.3 =
    // 0.95m — matches SPAWN_POSITION.y = 1.13 "resting on the floor" above),
    // so the body ended up buried ~0.95m into the floor collider for the
    // whole seated window. On stand-up, gravity/collision resumed from
    // inside solid geometry: best case a hard pop back to the surface,
    // worst case Rapier's own penetration-recovery shove sent it flying,
    // which read as "glitch out and clip through the map." The player's
    // body simply stays exactly where it was standing (frozen in place
    // below, same as it already does while the iPad is open) for the whole
    // sit_down/sitting/stand_up window — SeatedCamera.tsx eases the local
    // camera back to that SAME standing position on stand-up (see its
    // `standingReturnPosRef`), so there's no seat-derived position this
    // file needs to compute or teleport to at all.

    // Publish the player's TRUE planar velocity for LocalPresence's animState
    // classification (see playerVelocity.ts). The Rapier rigid body's linvel is
    // read straight off the physics state -- accurate magnitude, no camera-delta
    // aliasing, and a sharp start/stop edge -- replacing the camera-position
    // delta + EMA that lagged the classified stop by ~0.3s.
    const linvel = body.linvel()
    playerVelocity.x = linvel.x
    playerVelocity.z = linvel.z

    // Frozen while the iPad is open OR while any part of the sit/stand
    // transition is in flight. `seatPhaseRef.current !== 'standing'` covers
    // sit_down/sitting/stand_up as ONE window, not just the seated steady
    // state: useSeatStore's `mySeatId` clears at the START of stand_up (see
    // SeatedCamera.tsx), so keying off `mySeatId` alone would unfreeze one
    // whole animation early and drop the character mid stand-up.
    const frozen = ipadOpen || seatPhaseRef.current !== 'standing'
    const wasFrozen = wasFrozenRef.current

    if (frozen !== wasFrozen) {
      // <Ecctrl>'s `enable` prop (below) only takes effect on a fresh render
      // of THIS component -- r3f's useFrame captures each render's props
      // into a ref via a layout effect (useMutableCallback), so `frozen`
      // changing here doesn't reach it on its own. `ipadOpen` toggling already re-renders us via its own
      // zustand subscription above, but the seatPhaseRef-driven edge
      // (specifically stand_up -> standing, a pure timer inside
      // SeatedCamera.tsx with no store change of its own to subscribe to)
      // would otherwise never trigger one. `setFrozenState` only fires on an
      // actual transition, matching this file's own established discipline
      // against pushing every-frame values into React state (see
      // TELEMETRY_INTERVAL_S's comment).
      setFrozenState(frozen)
    }

    // Every frame, not just on the frozen edge: `enable` only flips on the
    // re-render setFrozenState schedules, and until then ecctrl's own loop
    // (which runs before this one, since child useFrames subscribe first)
    // keeps rewriting gravityScale and pushing the body. Once it's disabled
    // nothing else touches either, so this just re-asserts the freeze.
    if (frozen) {
      body.setGravityScale(FROZEN_GRAVITY_SCALE, true)
      body.setLinvel(ZERO_VELOCITY, true)
      body.setAngvel(ZERO_VELOCITY, true)
    } else if (wasFrozen) {
      // Just unfroze — hand gravityScale back so ecctrl's own management
      // (which only runs while `enable` is true) resumes from its initial
      // value instead of the frozen 0 we left it at.
      body.setGravityScale(DEFAULT_GRAVITY_SCALE, true)
      // Pick the look up from wherever the camera actually is now, so the
      // follow camera below continues it instead of snapping. After
      // stand_up that's SeatedCamera.tsx's final view. After the iPad it's
      // the view from before it opened, since nothing turns the camera
      // while frozen. This is the "seed the controller's camera state on
      // release" fallback PLAN.md planned for 1.0.97's `rotateCamera()`.
      lookRef.current = lookFromDirection(
        state.camera.getWorldDirection(lookDirectionScratchRef.current),
      )
    }
    wasFrozenRef.current = frozen

    // Read every frame and handed to ecctrl, which applies it on its own next
    // frame. While frozen, `enable` is false and ecctrl reads no input at
    // all; feeding it all-false too means no key held through the freeze
    // (e.g. typed into the iPad's search box) is waiting in its input state
    // on unfreeze.
    ecctrl.setMovement(frozen ? NO_MOVEMENT : getKeys())

    if (isOutOfBounds(body.translation(), RESPAWN_MIN_Y)) {
      body.setTranslation(SPAWN_VECTOR, true)
      body.setLinvel(ZERO_VELOCITY, true)
      body.setAngvel(ZERO_VELOCITY, true)
    }

    // The first-person follow camera, standing only. While frozen the
    // camera belongs to whoever else holds it (SeatedCamera.tsx while
    // seated; nobody while the iPad is open, so the view holds still behind
    // it), which is what 1.0.97's disableFollowCam used to arrange. Placed
    // straight on the body with no lerp (1.0.97's camFollowMult/camLerpMult
    // of 1000 made its lerps effectively instant too), and after the respawn
    // above so a NaN body never reaches it.
    if (!frozen) {
      const position = body.translation()
      state.camera.position.set(
        position.x,
        position.y + EYE_HEIGHT_ABOVE_BODY_M,
        position.z,
      )
      const euler = lookToEuler(lookRef.current)
      state.camera.rotation.set(euler.x, euler.y, 0, 'YXZ')
    }

    // Backstop alongside the body respawn above: a non-finite camera
    // position throws inside AudioListener.updateMatrixWorld the next time
    // positional audio updates (linearRampToValueAtTime rejects non-finite
    // values), and SeatedCamera.tsx's lerps never recover from one ("NaN +
    // anything" stays NaN). The follow above can't produce one, but snap
    // back the instant anything does.
    if (!isFiniteVec3(state.camera.position)) {
      state.camera.position.set(...SPAWN_POSITION)
    }

    if (onTelemetry) {
      telemetryElapsedRef.current += delta
      if (telemetryElapsedRef.current >= TELEMETRY_INTERVAL_S) {
        telemetryElapsedRef.current = 0
        onTelemetry({ position: body.translation(), velocity: body.linvel() })
      }
    }
  })

  return (
    <Ecctrl
      ref={ecctrlRef}
      // Stops ecctrl's whole per-frame loop while frozen: no input is read,
      // so typing in the iPad's search box (or sitting in a seat) can't move
      // the character, even though drei's KeyboardControls listens on
      // `window` regardless of DOM focus. It also stops ecctrl's float
      // spring and gravity handling (see the FROZEN_GRAVITY_SCALE comment
      // above for why that alone isn't safe), so the useFrame above holds
      // the character in place for as long as this is false. ecctrl 2.0
      // has no camera to disable alongside it. The follow camera lives in
      // this file and checks `frozen` itself.
      enable={!frozenState}
      capsuleHalfHeight={CAPSULE_HALF_HEIGHT}
      capsuleRadius={CAPSULE_RADIUS}
      floatHeight={FLOAT_HEIGHT}
      maxWalkVel={MAX_WALK_VEL}
      maxRunVel={MAX_RUN_VEL}
      // 2.0 defaults to Shift toggling run on and off. 1.0.97 ran only
      // while Shift was held.
      enableToggleRun={false}
      jumpVel={runHeld ? JUMP_VEL * RUN_JUMP_MULT : JUMP_VEL}
      fallingGravityScale={FALLING_GRAVITY_SCALE}
      position={SPAWN_POSITION}
    >
      <mesh visible={false}>
        <capsuleGeometry args={[0.3, 0.7]} />
        <meshBasicMaterial />
      </mesh>
    </Ecctrl>
  )
}
