import { isOutOfBounds } from 'src/components/Scene/respawn'

describe('isOutOfBounds', () => {
  it('is false for a finite position at or above the threshold', () => {
    expect(isOutOfBounds({ x: 0, y: 1, z: 0 }, -2)).toBe(false)
    expect(isOutOfBounds({ x: 3, y: -2, z: -5 }, -2)).toBe(false)
  })

  it('is true once y drops below the threshold', () => {
    expect(isOutOfBounds({ x: 0, y: -2.01, z: 0 }, -2)).toBe(true)
    expect(isOutOfBounds({ x: 0, y: -50, z: 0 }, -2)).toBe(true)
  })

  // The regression this guards against: ecctrl's floating-capsule physics can
  // produce NaN positions after sustained wall contact + a jump (see
  // Player.tsx's capsule-sizing comment). A threshold-only check would never
  // catch that — NaN compares false to every number, including `< minY` — so
  // a NaN'd player would never respawn and stayed stuck until a page reload.
  it('is true for any non-finite component, regardless of the threshold', () => {
    expect(isOutOfBounds({ x: NaN, y: 1, z: 0 }, -2)).toBe(true)
    expect(isOutOfBounds({ x: 0, y: NaN, z: 0 }, -2)).toBe(true)
    expect(isOutOfBounds({ x: 0, y: 1, z: NaN }, -2)).toBe(true)
    expect(isOutOfBounds({ x: 0, y: Infinity, z: 0 }, -2)).toBe(true)
    expect(isOutOfBounds({ x: 0, y: -Infinity, z: 0 }, -2)).toBe(true)
  })
})
