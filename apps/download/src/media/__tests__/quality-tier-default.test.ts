import { DEFAULT_QUALITY_TIER, QualityTier } from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'

import { defaultQualityTier } from 'src/media/quality-tier-default'

describe('defaultQualityTier', () => {
  let originalValue: string | undefined
  let warnSpy: jest.SpiedFunction<Logger['warn']>

  beforeEach(() => {
    originalValue = process.env.DEFAULT_QUALITY_TIER
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  afterEach(() => {
    if (originalValue === undefined) delete process.env.DEFAULT_QUALITY_TIER
    else process.env.DEFAULT_QUALITY_TIER = originalValue
    jest.restoreAllMocks()
  })

  it.each([QualityTier.UpTo4k, QualityTier.Hd, QualityTier.UpTo720p])(
    'returns the configured tier %s',
    tier => {
      process.env.DEFAULT_QUALITY_TIER = tier

      expect(defaultQualityTier()).toBe(tier)
      expect(warnSpy).not.toHaveBeenCalled()
    },
  )

  it('trims surrounding whitespace from a valid value', () => {
    process.env.DEFAULT_QUALITY_TIER = ' up_to_720p \n'

    expect(defaultQualityTier()).toBe(QualityTier.UpTo720p)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('returns the shared default when unset', () => {
    delete process.env.DEFAULT_QUALITY_TIER

    expect(defaultQualityTier()).toBe(DEFAULT_QUALITY_TIER)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('treats a blank value as unset', () => {
    process.env.DEFAULT_QUALITY_TIER = '   '

    expect(defaultQualityTier()).toBe(DEFAULT_QUALITY_TIER)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('falls back to hd and warns once per distinct invalid value', () => {
    process.env.DEFAULT_QUALITY_TIER = '4k'

    expect(defaultQualityTier()).toBe(QualityTier.Hd)
    expect(defaultQualityTier()).toBe(QualityTier.Hd)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('DEFAULT_QUALITY_TIER="4k"'),
    )

    process.env.DEFAULT_QUALITY_TIER = 'HD'

    expect(defaultQualityTier()).toBe(QualityTier.Hd)
    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('DEFAULT_QUALITY_TIER="HD"'),
    )
  })
})
