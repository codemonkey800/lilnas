import {
  DEFAULT_QUALITY_TIER,
  QUALITY_TIERS,
  QualityTier,
} from '@lilnas/utils/download/types'
import { env } from '@lilnas/utils/env'
import { Logger } from '@nestjs/common'

import { EnvKeys } from 'src/env'

const logger = new Logger('QualityTierDefault')

// - Bad values already warned about, so a misconfigured env logs once per
//   distinct value instead of on every request.
const warnedValues = new Set<string>()

function isQualityTier(value: string): value is QualityTier {
  return (QUALITY_TIERS as readonly string[]).includes(value)
}

/**
 * The tier a movie/show request gets when it names none, from
 * `DEFAULT_QUALITY_TIER`. Unset or blank -> the shared `DEFAULT_QUALITY_TIER`;
 * an unknown value -> `QualityTier.Hd`, with a warning the first time that
 * value is seen.
 */
export function defaultQualityTier(): QualityTier {
  const raw = env(EnvKeys.DEFAULT_QUALITY_TIER, '').trim()
  if (!raw) return DEFAULT_QUALITY_TIER
  if (isQualityTier(raw)) return raw

  if (!warnedValues.has(raw)) {
    warnedValues.add(raw)
    logger.warn(
      `Ignoring ${EnvKeys.DEFAULT_QUALITY_TIER}=${JSON.stringify(raw)} - expected one of ${QUALITY_TIERS.join(', ')}; using ${QualityTier.Hd}`,
    )
  }
  return QualityTier.Hd
}
