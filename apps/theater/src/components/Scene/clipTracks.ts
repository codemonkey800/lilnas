import { AnimationClip } from 'three'

// Mixamo bakes a translation (position) and scale track onto *every* bone,
// not just the root — including bones whose rest offset never actually
// changes during the clip. Those tracks encode the source rig's bone
// lengths, not motion: sharing idle.glb (exported from Kanna's proportions)
// onto a differently-proportioned rig like Master Chief overwrote his bone
// offsets with hers every frame, bulging the mesh away from the pose its
// skin was bound to (forearms ~51% off, hands ~40%, Hips ~369%, measured
// against the shipped assets). Articulation — the part actually worth
// sharing — lives entirely in the rotation tracks, which are proportion-
// independent. Keep those plus the root bone's own position (a caller may
// re-anchor that one itself — CharacterModel's per-frame pedestal does),
// drop everything else.
export function stripProportionTracks(
  clip: AnimationClip,
  rootBoneName: string,
): AnimationClip {
  const filtered = clip.clone()
  filtered.tracks = filtered.tracks.filter(
    track =>
      track.name.endsWith('.quaternion') ||
      track.name === `${rootBoneName}.position`,
  )
  return filtered
}

// Quaternion-only: drop every position/scale track, including the root
// bone's own position that stripProportionTracks above keeps. For remote
// multiplayer avatars, the group transform is driven entirely by the
// network-broadcast position (see multiplayer/store.ts's peerBuffers), so
// any retained root-motion/position track would double-move the character
// on top of that and slide the feet across the floor.
export function stripToRotation(clip: AnimationClip): AnimationClip {
  const filtered = clip.clone()
  filtered.tracks = filtered.tracks.filter(track =>
    track.name.endsWith('.quaternion'),
  )
  return filtered
}
