// Whether a body has fallen off the collision mesh and should be respawned.
// Non-finite components catch ecctrl's NaN-position failure mode (see
// Player.tsx's capsule-sizing comment) — a `y < minY` check alone would never
// trip on NaN, since every comparison against NaN is false.
export function isOutOfBounds(
  position: { x: number; y: number; z: number },
  minY: number,
): boolean {
  return (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z) ||
    position.y < minY
  )
}
