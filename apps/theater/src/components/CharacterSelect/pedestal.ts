import {
  Bone,
  Box3,
  Matrix4,
  Mesh,
  Object3D,
  SkinnedMesh,
  Vector3,
} from 'three'

export type PedestalAnchor = { x: number; z: number }

// Both functions below read bone positions through a `worldToLocal` call
// rather than `matrixWorld.elements` directly. A bone's `matrixWorld` is in
// world space; scene.position (and the captured anchor/groundY) are in the
// space of whatever ancestor they're relative to. Subtracting one from the
// other directly — the previous approach — only cancels correctly when
// every ancestor between that space and world space has an identity
// rotation. CharacterStage.tsx's PresentationControls rotates the group
// `scene` sits in on every drag, so that assumption broke as soon as the
// user rotated the character: the leftover rotation term fed back into
// scene.position every frame, and for rotations past ~60° that feedback
// amplifies (rather than decays) each frame, sending the character to
// infinity within a couple dozen frames — see pedestal.test.ts's angle
// sweep for the reproduction.
const scratch = new Vector3()

export function capturePedestalAnchor(
  scene: Object3D,
  rootBone: Bone,
  groundingBones: readonly Bone[],
): { anchor: PedestalAnchor; groundY: number } {
  const parent = scene.parent
  if (!parent) {
    scratch.setFromMatrixPosition(rootBone.matrixWorld)
    return {
      anchor: { x: scratch.x, z: scratch.z },
      groundY: scratch.y,
    }
  }

  // Anchor and groundY are fixed *targets* for scene.position, so — unlike
  // the raw offsets below — they belong in the same space scene.position
  // itself lives in (the parent's local space), not scene's own local space.
  scratch.setFromMatrixPosition(rootBone.matrixWorld)
  parent.worldToLocal(scratch)
  const anchor = { x: scratch.x, z: scratch.z }

  let groundY = Infinity
  for (const bone of groundingBones) {
    scratch.setFromMatrixPosition(bone.matrixWorld)
    parent.worldToLocal(scratch)
    if (scratch.y < groundY) {
      groundY = scratch.y
    }
  }

  return { anchor, groundY }
}

export function applyPedestal(
  scene: Object3D,
  rootBone: Bone,
  groundingBones: readonly Bone[],
  anchor: PedestalAnchor,
  groundY: number,
  rootSwayScale: number,
): void {
  // scene.worldToLocal strips out both the parent's rotation and scene's
  // own current position, leaving exactly the clip's raw offset — the
  // quantity these three adjustments are meant to react to — with no
  // dependency on last frame's scene.position (i.e. no feedback term) at
  // any rotation angle.
  let lowestLocalY = Infinity
  for (const bone of groundingBones) {
    scratch.setFromMatrixPosition(bone.matrixWorld)
    scene.worldToLocal(scratch)
    if (scratch.y < lowestLocalY) {
      lowestLocalY = scratch.y
    }
  }

  scratch.setFromMatrixPosition(rootBone.matrixWorld)
  scene.worldToLocal(scratch)
  const rawX = scratch.x
  const rawZ = scratch.z

  scene.position.set(
    anchor.x - rawX * (1 - rootSwayScale),
    groundY - lowestLocalY,
    anchor.z - rawZ * (1 - rootSwayScale),
  )
}

// Restricted to the FK chain that actually deforms the mesh — excluding IK
// targets (`ik_*`), physics/socket helpers (`dyn_*`), and attachment points
// (`attach`, `weapon_*`) — because those aren't reliably coincident with the
// boot soles: on the dance clip, one of them reported a wildly wrong height
// on some frames and lifted the whole body off the floor. The root bone
// itself is excluded separately (by reference, where this is used below) —
// it's the one bone whose translation *is* the unit-mismatch bug pedestal
// math corrects for, so on frames where its swing dips below the feet, it
// would get (wrongly) planted at floor level instead of them, leaving the
// feet floating by the difference.
function isGroundingBone(bone: Bone): boolean {
  return (
    !bone.name.startsWith('ik_') &&
    !bone.name.startsWith('dyn_') &&
    !bone.name.startsWith('weapon_') &&
    bone.name !== 'attach'
  )
}

export type PreparedCharacterScene = {
  rootBone: Bone | null
  bones: Bone[]
  anchor: PedestalAnchor | null
  groundY: number
}

// Bounding box of `scene`'s meshes expressed in scene's OWN local frame,
// independent of however the stage turntable has rotated the group `scene`
// sits inside. Box3.setFromObject builds a WORLD-space AABB — it bakes in
// every ancestor transform, including CharacterStage.tsx's PresentationControls
// azimuth/polar drag — so recentering scene.position (a parent-local quantity)
// against that world box only cancels correctly when the stage is unrotated;
// switch characters while the turntable is turned and the negated world centre
// lands the character off the stage axis by a rotation-dependent offset (see
// pedestal.test.ts's rotated-recenter sweep). This measures each mesh's
// bind-pose box through scene.worldToLocal instead — the same way applyPedestal
// strips ancestor rotation out of its per-frame bone reads — so the result is
// the character's true extent regardless of drag angle. Uses each mesh's own
// bind-pose box (SkinnedMesh.boundingBox / geometry.boundingBox, matching
// setFromObject's own source selection), so it stays a bind-pose measurement
// and inherits the same "call before any clip plays" requirement.
function measureLocalBounds(scene: Object3D): Box3 {
  scene.updateMatrixWorld(true)
  const sceneInverse = new Matrix4().copy(scene.matrixWorld).invert()
  const relativeToScene = new Matrix4()
  const meshBox = new Box3()
  const localBox = new Box3()

  scene.traverse(child => {
    let source: Box3 | null = null
    if (child instanceof SkinnedMesh) {
      if (!child.boundingBox) {
        child.computeBoundingBox()
      }
      source = child.boundingBox
    } else if (child instanceof Mesh) {
      const geometry = child.geometry
      if (!geometry.boundingBox) {
        geometry.computeBoundingBox()
      }
      source = geometry.boundingBox
    }
    if (!source) {
      return
    }

    // child.matrixWorld carries the turntable rotation; sceneInverse cancels
    // it back out, leaving the box in scene's local frame.
    relativeToScene.multiplyMatrices(sceneInverse, child.matrixWorld)
    meshBox.copy(source).applyMatrix4(relativeToScene)
    localBox.union(meshBox)
  })

  return localBox
}

// Recenters `scene` against its *current* pose — feet (box.min.y) on the
// floor at y=0, centred in x/z — then captures the pedestal anchor from that
// same pose, so both must be called on a scene that's genuinely still at
// its bind pose. The measurement (measureLocalBounds) reads each SkinnedMesh
// from its bind pose regardless of the animated pose, so this is safe to call
// before any clip plays; it is NOT safe to call on a `useGLTF`-cached scene
// that a previous mount already recentered and animated (see
// CharacterModel.tsx's clone comment) — callers must pass a scene freshly
// cloned from that cache, never the cache itself.
export function prepareCharacterScene(scene: Object3D): PreparedCharacterScene {
  let skinned: SkinnedMesh | null = null
  scene.traverse(child => {
    if (child instanceof Mesh) {
      child.castShadow = true
      child.receiveShadow = true
      // A SkinnedMesh's bounding sphere is baked from the bind pose and
      // never updates for animated deformation, so frustum culling can
      // (and did, here) hide a mesh whose actual skinned vertices are
      // on-screen. There's only ever one character on stage, so the cost
      // of never culling it is negligible.
      child.frustumCulled = false
    }
    if (!skinned && child instanceof SkinnedMesh) {
      skinned = child
    }
  })

  // Local, not world, bounds — measuring against the rotated turntable frame
  // is what pushed switched-in characters off-centre (see measureLocalBounds).
  const box = measureLocalBounds(scene)
  const center = box.getCenter(new Vector3())
  scene.position.set(-center.x, -box.min.y, -center.z)
  scene.updateMatrixWorld(true)

  // Both meshes share one skeleton (single skin in the GLB); grab it off
  // whichever SkinnedMesh we found. Root = the structural top bone (first
  // with no Bone parent), not a hardcoded name — a future cast member's rig
  // may name it differently.
  const candidates = skinned
    ? (skinned as SkinnedMesh).skeleton.bones.filter(isGroundingBone)
    : []
  const rootBone =
    candidates.find(bone => !(bone.parent instanceof Bone)) ??
    candidates[0] ??
    null
  // Bones eligible for the "lowest point" grounding scan — everything
  // grounding-eligible except root itself (see isGroundingBone's comment).
  const bones = rootBone
    ? candidates.filter(bone => bone !== rootBone)
    : candidates

  if (rootBone && bones.length > 0) {
    const { anchor, groundY } = capturePedestalAnchor(scene, rootBone, bones)
    return { rootBone, bones, anchor, groundY }
  }

  return { rootBone, bones, anchor: null, groundY: 0 }
}
