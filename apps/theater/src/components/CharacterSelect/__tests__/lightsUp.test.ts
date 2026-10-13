import {
  LIGHTS_UP_HOLD_MS,
  LIGHTS_UP_RAMP_MS,
  lightsUpDone,
  lightsUpIntensity,
} from 'src/components/CharacterSelect/lightsUp'

describe('lightsUpIntensity', () => {
  it('stays at zero through the hold', () => {
    expect(lightsUpIntensity(0, 10)).toBe(0)
    expect(lightsUpIntensity(LIGHTS_UP_HOLD_MS - 1, 10)).toBe(0)
  })

  it('reaches the target once the ramp completes', () => {
    expect(
      lightsUpIntensity(LIGHTS_UP_HOLD_MS + LIGHTS_UP_RAMP_MS, 10),
    ).toBeCloseTo(10)
    expect(
      lightsUpIntensity(LIGHTS_UP_HOLD_MS + LIGHTS_UP_RAMP_MS + 5000, 10),
    ).toBeCloseTo(10)
  })

  it('rises monotonically during the ramp', () => {
    const step = LIGHTS_UP_RAMP_MS / 5
    const samples = Array.from({ length: 6 }, (_, i) =>
      lightsUpIntensity(LIGHTS_UP_HOLD_MS + step * i, 10),
    )
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThan(samples[i - 1] ?? -Infinity)
    }
  })

  it('scales linearly with target intensity at a fixed elapsed time', () => {
    const elapsedMs = LIGHTS_UP_HOLD_MS + LIGHTS_UP_RAMP_MS / 2
    expect(lightsUpIntensity(elapsedMs, 20)).toBeCloseTo(
      lightsUpIntensity(elapsedMs, 10) * 2,
    )
  })
})

describe('lightsUpDone', () => {
  it('is false during the hold and ramp', () => {
    expect(lightsUpDone(0)).toBe(false)
    expect(lightsUpDone(LIGHTS_UP_HOLD_MS)).toBe(false)
    expect(lightsUpDone(LIGHTS_UP_HOLD_MS + LIGHTS_UP_RAMP_MS - 1)).toBe(false)
  })

  it('is true once the hold and ramp have both elapsed', () => {
    expect(lightsUpDone(LIGHTS_UP_HOLD_MS + LIGHTS_UP_RAMP_MS)).toBe(true)
    expect(lightsUpDone(LIGHTS_UP_HOLD_MS + LIGHTS_UP_RAMP_MS + 5000)).toBe(
      true,
    )
  })
})
