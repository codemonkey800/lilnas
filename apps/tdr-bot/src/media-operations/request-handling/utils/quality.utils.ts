import { QualityTier } from '@lilnas/utils/download/types'

import type { MediaRequestQuality } from 'src/schemas/graph'

const QUALITY_TIER_BY_REQUESTED_QUALITY: Readonly<
  Record<MediaRequestQuality, QualityTier>
> = {
  '4k': QualityTier.UpTo4k,
  '1080p': QualityTier.Hd,
  '720p': QualityTier.UpTo720p,
}

/**
 * The download app's quality tier for the quality a user named in their
 * message. `undefined` when they named none (or it was unrecognised), so the
 * request leaves the tier off and the download app's default applies.
 */
export function toQualityTier(
  quality: MediaRequestQuality | null | undefined,
): QualityTier | undefined {
  if (!quality || !Object.hasOwn(QUALITY_TIER_BY_REQUESTED_QUALITY, quality)) {
    return undefined
  }
  return QUALITY_TIER_BY_REQUESTED_QUALITY[quality]
}
