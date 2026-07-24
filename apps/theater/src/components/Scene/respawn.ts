// Shared by isOutOfBounds below (the body) and Player.tsx's per-frame camera
// guard — ecctrl's floating-capsule physics can produce a NaN position (see
// Player.tsx's capsule-sizing comment), and THREE.Vector3.lerp never
// recovers from that on its own (`NaN + anything` stays `NaN`), so both the
// body and the camera need the same finite check.
export function isFiniteVec3(v: { x: number; y: number; z: number }): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
}

// Whether a body has fallen off the collision mesh and should be respawned.
// The finite check catches ecctrl's NaN-position failure mode — a `y < minY`
// check alone would never trip on NaN, since every comparison against NaN is
// false.
export function isOutOfBounds(
  position: { x: number; y: number; z: number },
  minY: number,
): boolean {
  return !isFiniteVec3(position) || position.y < minY
}
