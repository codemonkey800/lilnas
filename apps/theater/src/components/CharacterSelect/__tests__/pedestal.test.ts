import {
  Bone,
  Box3,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  Object3D,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { SkeletonUtils } from 'three-stdlib'

import {
  applyPedestal,
  capturePedestalAnchor,
  prepareCharacterScene,
} from 'src/components/CharacterSelect/pedestal'

// Mirrors CharacterModel.tsx's real skeleton shape closely enough to drive
// the pedestal math: a "turntable" group standing in for
// PresentationControls' rotating group (CharacterStage.tsx, azimuth drag),
// a model root ("scene") it contains, and a root bone with one grounding
// bone below it.
function buildRig(turntableAzimuth: number) {
  const turntable = new Group()
  turntable.rotation.y = turntableAzimuth

  const scene = new Object3D()
  turntable.add(scene)

  const rootBone = new Bone()
  scene.add(rootBone)

  const footBone = new Bone()
  footBone.position.y = -0.9
  rootBone.add(footBone)

  turntable.updateMatrixWorld(true)

  return { scene, rootBone, footBone }
}

// Stand-in for the real clip's broken root motion (a units mismatch bakes
// centimetre-scale curves onto a metre-scale rig — see CharacterModel.tsx),
// which swings the root bone tens of units per frame in the actual asset.
// Constant 40-unit magnitude every frame (sin/cos), so any run that grows
// frame-over-frame is amplifying its own state, not just echoing a louder
// input.
function simulateClipRootMotion(rootBone: Bone, frame: number): void {
  rootBone.position.set(Math.sin(frame) * 40, 0, Math.cos(frame) * 40)
}

// Loose enough that the correct implementation — whose scene.position
// tracks the clip's ~40-unit raw offset directly, by design, to cancel it —
// never approaches it, but tight enough that the buggy recurrence blows
// through it within ~20 frames at any tested angle at or past 90°.
const BOUND = 200

describe('pedestal', () => {
  it('keeps scene.position bounded across many frames at every turntable angle', () => {
    for (const degrees of [0, 30, 45, 90, 120, 150]) {
      const { scene, rootBone, footBone } = buildRig((degrees * Math.PI) / 180)
      const { anchor, groundY } = capturePedestalAnchor(scene, rootBone, [
        footBone,
      ])

      for (let frame = 0; frame < 60; frame++) {
        simulateClipRootMotion(rootBone, frame)
        scene.updateMatrixWorld(true)
        applyPedestal(scene, rootBone, [footBone], anchor, groundY, 0.004)
      }

      expect(Number.isFinite(scene.position.length())).toBe(true)
      expect(scene.position.length()).toBeLessThan(BOUND)
    }
  })

  it('stays bounded even holding a single rotated angle with no further dragging', () => {
    // Isolates the loop's own instability from "still actively dragging":
    // the turntable is rotated once, then held fixed — matching the video,
    // where the character kept diverging even after the drag motion itself
    // would have settled, purely from repeated per-frame correction.
    const { scene, rootBone, footBone } = buildRig(Math.PI / 2)
    const { anchor, groundY } = capturePedestalAnchor(scene, rootBone, [
      footBone,
    ])

    for (let frame = 0; frame < 120; frame++) {
      simulateClipRootMotion(rootBone, frame)
      scene.updateMatrixWorld(true)
      applyPedestal(scene, rootBone, [footBone], anchor, groundY, 0.004)
    }

    expect(scene.position.length()).toBeLessThan(BOUND)
  })
})

// Mirrors the real GLTF shape closely enough to exercise prepareCharacterScene's
// mesh/bone discovery: a model root ("scene") containing both a SkinnedMesh
// (for the Box3 measurement and skeleton lookup) and the bone chain, as
// siblings — the shape SkeletonUtils.clone's parallelTraverse must walk
// correctly for skinning to survive the clone, and the shape real glTF
// exports use (mesh and skeleton root as siblings, not mesh-owns-bones).
// `bindAfterMatrixUpdate` controls where the character's feet land relative
// to its own local origin, which is the whole point of the two
// rootBoneHeight cases below. Binding the Skeleton BEFORE the first
// updateMatrixWorld (the default) leaves every bone inverse identity, so the
// skinned bind-pose box gets shifted up by the root bone's offset and the
// feet coincide with local zero. Binding AFTER makes the inverses real, the
// bind-pose skinning an identity round-trip, and the box stay at the
// geometry's own extents — the "origin is not at the feet" shape that
// master-chief and xxxtentacion actually ship in.
function buildCharacterRig(
  offset: { x: number; z: number } = { x: 0, z: 0 },
  { bindAfterMatrixUpdate = false }: { bindAfterMatrixUpdate?: boolean } = {},
) {
  const scene = new Object3D()

  const rootBone = new Bone()
  rootBone.name = 'root'
  rootBone.position.set(0, 0.9, 0)
  scene.add(rootBone)

  const footBone = new Bone()
  footBone.name = 'foot'
  footBone.position.set(0, -0.9, 0)
  rootBone.add(footBone)

  // SkinnedMesh.computeBoundingBox (Box3.setFromObject's path for a skinned
  // mesh) transforms every vertex through its bone weights, so — unlike a
  // plain Mesh — the geometry needs real skinIndex/skinWeight attributes or
  // it throws reading them as undefined. Every vertex fully bound to bone 0
  // (rootBone) is enough; this rig doesn't exercise deformation.
  const geometry = new BoxGeometry(0.4, 1.8, 0.4)
  // Optionally shove the mesh off the origin in x/z, standing in for a model
  // whose bind-pose geometry isn't authored dead-centre — the case the
  // recenter exists to correct, and the one that exposes a world-vs-local
  // frame mismatch when the stage is rotated at switch time.
  geometry.translate(offset.x, 0, offset.z)
  const position = geometry.getAttribute('position')
  const vertexCount = position.count
  const skinIndices = new Array(vertexCount * 4).fill(0)
  const skinWeights = new Array(vertexCount * 4)
    .fill(0)
    .map((_, i) => (i % 4 === 0 ? 1 : 0))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndices, 4))
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(skinWeights, 4),
  )

  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  scene.add(mesh)
  if (bindAfterMatrixUpdate) {
    scene.updateMatrixWorld(true)
  }
  mesh.bind(new Skeleton([rootBone, footBone]))

  scene.updateMatrixWorld(true)

  return { scene, rootBone, footBone }
}

// Stands in for CharacterStage.tsx's PresentationControls group, which every
// mount's scene sits inside at runtime — capturePedestalAnchor branches on
// scene.parent being present, so mounting under one here exercises the same
// path production hits, rather than its parentless fallback.
function mountOnStage(scene: Object3D, azimuth = 0): Object3D {
  const turntable = new Group()
  turntable.rotation.y = azimuth
  turntable.add(scene)
  turntable.updateMatrixWorld(true)
  return scene
}

describe('prepareCharacterScene', () => {
  it('leaves the source scene untouched, so independent mounts never see a previous mount state', () => {
    const { scene: source, rootBone, footBone } = buildCharacterRig()

    const sourceRootStart = rootBone.position.clone()
    const sourceFootStart = footBone.position.clone()
    const sourcePositionStart = source.position.clone()

    const mountA = mountOnStage(SkeletonUtils.clone(source))
    const resultA = prepareCharacterScene(mountA)

    // Simulate mount A staying on stage through an animation cycle and
    // unmounting with the mixer frozen mid-clip: the foot bone's LOCAL
    // offset relative to the root ends up wherever that frame left it,
    // instead of back at bind pose. A *relative* pose change, not a uniform
    // bulk shift of scene.position/rootBone together — prepareCharacterScene
    // re-derives position from scratch every call, so a uniform shift gets
    // cancelled out on the next call regardless of cloning and wouldn't
    // prove anything here.
    const mountAFoot = resultA.bones[0]
    mountAFoot?.position.set(0.6, -0.2, 0.5)
    mountA.updateMatrixWorld(true)

    const mountB = mountOnStage(SkeletonUtils.clone(source))
    const resultB = prepareCharacterScene(mountB)

    expect(resultB.anchor).toEqual(resultA.anchor)
    expect(resultB.groundY).toBeCloseTo(resultA.groundY)

    expect(rootBone.position.equals(sourceRootStart)).toBe(true)
    expect(footBone.position.equals(sourceFootStart)).toBe(true)
    expect(source.position.equals(sourcePositionStart)).toBe(true)
  })

  // Regression: switching characters while the turntable is rotated used to
  // land the newcomer off to the side (only a front-facing switch centred
  // them). The recenter measured a WORLD-space box — which bakes in the
  // turntable's azimuth — then applied the negated centre as scene.position,
  // a parent-LOCAL quantity, so the two frames only agreed at 0°. An
  // off-origin character exposes it; a dead-centre one would stay at 0
  // regardless of the bug, so it must be offset here.
  it('centres a rotated-in character on the stage axis at every turntable angle', () => {
    const { scene: source } = buildCharacterRig({ x: 0.5, z: 0.3 })

    for (const degrees of [0, 30, 45, 90, 135, 180, 270]) {
      const scene = mountOnStage(
        SkeletonUtils.clone(source),
        (degrees * Math.PI) / 180,
      )
      prepareCharacterScene(scene)
      scene.parent?.updateMatrixWorld(true)

      // After the recenter, the character's world-space centre must sit on
      // the turntable's rotation axis (world origin in x/z) for any angle —
      // that's what "centred on the spotlight" means once the whole rig spins.
      const worldCenter = new Box3()
        .setFromObject(scene)
        .getCenter(new Vector3())
      expect(Math.abs(worldCenter.x)).toBeLessThan(1e-6)
      expect(Math.abs(worldCenter.z)).toBeLessThan(1e-6)
    }
  })

  // Bugfix regression guard: a seated remote peer used to float ~0.35-0.72m
  // above their seat cushion (measured across the 7 shipped characters).
  // Root cause was RemoteAvatars.tsx pinning the seated group with a single
  // guessed constant instead of each character's own bind-pose hip height.
  // `rootBoneHeight` is the fix's measured replacement.
  it("measures the root bone's bind-pose height above the recentred floor, independent of the turntable rotation", () => {
    const { scene: source } = buildCharacterRig()

    for (const degrees of [0, 45, 90, 180]) {
      const scene = mountOnStage(
        SkeletonUtils.clone(source),
        (degrees * Math.PI) / 180,
      )
      const result = prepareCharacterScene(scene)

      // buildCharacterRig binds its Skeleton before the first
      // updateMatrixWorld, so the bone inverses come out identity and the
      // skinned bind-pose box lands at y=[0, 1.8] — i.e. this fixture's feet
      // are ALREADY at local zero (verified by measuring mesh.boundingBox
      // directly, not assumed). Hips at local 0.9 are therefore 0.9 above
      // the floor.
      //
      // Because box.min.y is exactly 0 here, this case cannot distinguish
      // "hips above the floor" from "hips above the model's authored
      // origin" — the two coincide. The test below covers a rig where they
      // don't, which is the shape master-chief and xxxtentacion ship in.
      expect(result.rootBoneHeight).toBeCloseTo(0.9, 5)
    }
  })

  // Regression guard for the shipped-asset bug the case above structurally
  // cannot catch. master-chief and xxxtentacion are authored with their
  // origin at roughly hip height rather than at their feet, so their
  // bind-pose box starts BELOW local zero (box.min.y = -1.000 / -0.987,
  // measured off the shipped GLBs through the real GLTFLoader). Reading the
  // root bone's scene-local Y without subtracting box.min.y then reports
  // hips-above-origin instead of hips-above-feet, and RemoteAvatars.tsx pins
  // them that much too high — a full metre above the cushion.
  //
  // Reproduced here by binding the Skeleton AFTER the first
  // updateMatrixWorld, which makes the bone inverses real, leaves the
  // skinned box at the geometry's own y=[-0.9, 0.9], and so puts the floor
  // at box.min.y = -0.9 rather than 0. Pre-fix this returned 0.9.
  it('measures hips above the FEET, not above the model origin, when the bind-pose box starts below local zero', () => {
    const { scene } = buildCharacterRig(
      { x: 0, z: 0 },
      { bindAfterMatrixUpdate: true },
    )
    const result = prepareCharacterScene(
      mountOnStage(SkeletonUtils.clone(scene)),
    )

    // Root bone at local y=0.9, floor (box.min.y) at local y=-0.9.
    expect(result.rootBoneHeight).toBeCloseTo(1.8, 5)
  })

  it("is 0 when there is no skeleton to measure, matching groundY's own no-skeleton fallback", () => {
    const scene = new Object3D()
    const result = prepareCharacterScene(scene)

    expect(result.rootBone).toBeNull()
    expect(result.rootBoneHeight).toBe(0)
    expect(result.rootBoneOffsetX).toBe(0)
    expect(result.rootBoneOffsetZ).toBe(0)
  })

  // Bugfix regression guard: a seated remote peer's hips landed off-centre
  // on the cushion -- up to 90% of the way across its depth for Kanna, whose
  // back then sat ~12.5cm clear of the backrest -- because RemoteAvatars.tsx's
  // seat pin matched the group's X/Z straight to the cushion's own X/Z with
  // no correction (unlike the Y pin, which already applied `rootBoneHeight`).
  // Root cause: the recenter above places the group origin at the bind-pose
  // bounding box's X/Z CENTRE, which only coincides with the hips for a rig
  // whose silhouette is symmetric around its own pelvis -- Kanna's hair and
  // tail extend behind her and pull the box behind her actual hips.
  // `rootBoneOffsetX`/`rootBoneOffsetZ` are the fix's measured replacement.
  it("measures the root bone's bind-pose X/Z offset from the recentred origin, independent of the turntable rotation", () => {
    // Same asymmetric fixture as "centres a rotated-in character on the
    // stage axis" above -- geometry bbox centred at (0.5, _, 0.3) while the
    // root bone itself sits at local (0, 0.9, 0), i.e. offset (-0.5, _, -0.3)
    // from that centre, unaffected by the mesh-only offset (see that test's
    // own comment for why the bone hierarchy never moves).
    const { scene: source } = buildCharacterRig({ x: 0.5, z: 0.3 })

    for (const degrees of [0, 45, 90, 180]) {
      const scene = mountOnStage(
        SkeletonUtils.clone(source),
        (degrees * Math.PI) / 180,
      )
      const result = prepareCharacterScene(scene)

      expect(result.rootBoneOffsetX).toBeCloseTo(-0.5, 5)
      expect(result.rootBoneOffsetZ).toBeCloseTo(-0.3, 5)
    }
  })

  // The complementary case: a rig whose silhouette IS already centred on its
  // own hips (offset {x: 0, z: 0} -- the shape most of the shipped characters
  // actually ship in) must come out at ~0. The fix has to be a no-op for
  // them, not a new source of drift.
  it('is ~0 when the bind-pose bounding box is already centred on the root bone', () => {
    const { scene: source } = buildCharacterRig()
    const scene = mountOnStage(SkeletonUtils.clone(source))
    const result = prepareCharacterScene(scene)

    expect(result.rootBoneOffsetX).toBeCloseTo(0, 5)
    expect(result.rootBoneOffsetZ).toBeCloseTo(0, 5)
  })
})
