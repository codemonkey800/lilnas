import {
  QUALITY_TIER_LABELS,
  QUALITY_TIERS,
  QualityTier,
} from '@lilnas/utils/download/types'

/**
 * Plan 024. The three quality profiles this app manages in each of Radarr
 * and Sonarr - one per `QualityTier`. Everything here is pure: building the
 * profile a tier should be, spotting drift, and planning what to create or
 * update. `RadarrService`/`SonarrService` do the HTTP.
 *
 * Facts the tables and builder rely on (Radarr 6.4 / Sonarr 4.0, read from
 * `/qualityprofile/schema`):
 *
 * - A profile's `items` must list every quality exactly once, allowed or
 *   not, and run worst -> best (the UI shows them reversed).
 * - A top-level item is either a leaf (`{ quality, items: [], allowed }`) or
 *   a group (`{ id >= 1000, name, items: [leaf, ...], allowed }`) - the four
 *   `WEB <res>` groups pair WEBDL with WEBRip.
 * - `cutoff` is the id of an allowed top-level item - a quality id or a
 *   group id.
 */

export type ArrApp = 'radarr' | 'sonarr'

/** Every managed profile's name starts with this; nothing else is touched. */
export const TIER_PROFILE_PREFIX = 'lilnas · '

/**
 * The language a Radarr tier profile carries - what the existing
 * `HD - 720p/1080p` profile uses, rather than the schema's "Original".
 * Sonarr profiles have no language.
 */
export const RADARR_TIER_PROFILE_LANGUAGE = { id: 1, name: 'English' }

// - The `WEB <res>` group ids, the same in both apps
const WEB_480P = 1000
const WEB_720P = 1001
const WEB_1080P = 1002
const WEB_2160P = 1003

// - Radarr quality ids
const RADARR_HD = [
  30, // Remux-1080p
  7, // Bluray-1080p
  WEB_1080P,
  9, // HDTV-1080p
  6, // Bluray-720p
  WEB_720P,
  4, // HDTV-720p
  21, // Bluray-576p
  20, // Bluray-480p
  WEB_480P,
  2, // DVD
  1, // SDTV
] as const

const RADARR_UHD_ONLY = [
  31, // Remux-2160p
  19, // Bluray-2160p
  WEB_2160P,
  16, // HDTV-2160p
] as const

// - Sonarr quality ids - several differ from Radarr's for the same name
const SONARR_HD = [
  20, // Bluray-1080p Remux
  7, // Bluray-1080p
  WEB_1080P,
  9, // HDTV-1080p
  6, // Bluray-720p
  WEB_720P,
  4, // HDTV-720p
  22, // Bluray-576p
  13, // Bluray-480p
  WEB_480P,
  2, // DVD
  1, // SDTV
] as const

const SONARR_UHD_ONLY = [
  21, // Bluray-2160p Remux
  19, // Bluray-2160p
  WEB_2160P,
  16, // HDTV-2160p
] as const

/** Drops everything above 720p: the tail of the HD list from Bluray-720p. */
function from720p(hd: readonly number[]): readonly number[] {
  return hd.slice(hd.indexOf(6))
}

/**
 * The top-level items each tier allows, **best first**, by quality or group
 * id. A Radarr/Sonarr upgrade that renumbers a quality makes
 * `tierProfileSpec()` throw instead of quietly allowing the wrong thing.
 */
export const TIER_QUALITY_IDS: Readonly<
  Record<ArrApp, Readonly<Record<QualityTier, readonly number[]>>>
> = {
  radarr: {
    [QualityTier.UpTo4k]: [...RADARR_UHD_ONLY, ...RADARR_HD],
    [QualityTier.Hd]: RADARR_HD,
    [QualityTier.UpTo720p]: from720p(RADARR_HD),
  },
  sonarr: {
    [QualityTier.UpTo4k]: [...SONARR_UHD_ONLY, ...SONARR_HD],
    [QualityTier.Hd]: SONARR_HD,
    [QualityTier.UpTo720p]: from720p(SONARR_HD),
  },
}

/**
 * Qualities no tier may ever allow - pre-release rips, disc images and raw
 * captures. Not read by the builder (anything outside a tier's list is
 * disallowed anyway); kept so the tests can pin that no tier lists one.
 */
export const NEVER_ALLOWED_QUALITY_IDS: Readonly<
  Record<ArrApp, readonly number[]>
> = {
  radarr: [
    0, // Unknown
    24, // WORKPRINT
    25, // CAM
    26, // TELESYNC
    27, // TELECINE
    29, // REGIONAL
    28, // DVDSCR
    23, // DVD-R
    22, // BR-DISK
    10, // Raw-HD
  ],
  sonarr: [
    0, // Unknown
    10, // Raw-HD
  ],
}

/**
 * The fields of a Radarr or Sonarr `QualityProfileQualityItemResource` this
 * module reads. Both SDKs' generated types satisfy it structurally.
 */
export interface TierQualityItem {
  id?: number
  name?: string | null
  quality?: { id?: number; name?: string | null }
  items?: TierQualityItem[] | null
  allowed?: boolean
}

/**
 * The fields of a Radarr or Sonarr `QualityProfileResource` this module
 * reads or writes. Both SDKs' generated types satisfy it structurally.
 */
export interface TierQualityProfile {
  id?: number
  name?: string | null
  upgradeAllowed?: boolean
  cutoff?: number
  items?: TierQualityItem[] | null
  minFormatScore?: number
  cutoffFormatScore?: number
  minUpgradeFormatScore?: number
  formatItems?: { score?: number }[] | null
  language?: { id?: number; name?: string | null }
}

type ItemOf<P extends TierQualityProfile> = NonNullable<P['items']>[number]

export interface TierProfileSpecOptions {
  /** Radarr only; defaults to `RADARR_TIER_PROFILE_LANGUAGE`. */
  language?: { id: number; name: string }
}

/** `lilnas · Up to 4K`, `lilnas · HD (up to 1080p)`, `lilnas · Up to 720p`. */
export function tierProfileName(tier: QualityTier): string {
  return `${TIER_PROFILE_PREFIX}${QUALITY_TIER_LABELS[tier]}`
}

/**
 * The id a top-level item is referred to by - a group's own id, a leaf's
 * quality id - or `undefined` for an item carrying neither.
 */
function topLevelItemId(item: TierQualityItem): number | undefined {
  return item.items?.length ? item.id : item.quality?.id
}

/** The item, with it and (for a group) every member set to `allowed`. */
function withAllowed<I extends TierQualityItem>(item: I, allowed: boolean): I {
  return {
    ...item,
    allowed,
    ...(item.items ? { items: item.items.map(m => ({ ...m, allowed })) } : {}),
  }
}

/**
 * The profile `tier` should be in `app`, built from that app's
 * `/qualityprofile/schema` so every quality is present exactly once:
 *
 * - The qualities outside the tier come first (the worst end), disallowed,
 *   in the schema's own order.
 * - The tier's items follow, allowed, worst -> best - built from the tier
 *   table rather than the schema's order, which differs between the apps.
 * - `cutoff` is the best allowed item; upgrades are off; custom-format
 *   scores are zeroed. Radarr gets `opts.language` (English by default).
 *
 * Throws if the schema lacks an id the tier lists.
 */
export function tierProfileSpec<P extends TierQualityProfile>(
  app: ArrApp,
  tier: QualityTier,
  schema: P,
  opts: TierProfileSpecOptions = {},
): P {
  const tierIds = TIER_QUALITY_IDS[app][tier]
  const schemaItems: ItemOf<P>[] = schema.items ?? []

  const byId = new Map<number, ItemOf<P>>()
  for (const item of schemaItems) {
    const id = topLevelItemId(item)
    if (id != null) byId.set(id, item)
  }

  const missing = tierIds.filter(id => !byId.has(id))
  if (missing.length > 0) {
    throw new Error(
      `${app} quality profile schema has no top-level quality or group with id ${missing.join(', ')} - the ${tier} tier table in quality-tiers.ts is out of date`,
    )
  }

  const inTier = new Set(tierIds)
  const disallowed = schemaItems
    .filter(item => {
      const id = topLevelItemId(item)
      return id == null || !inTier.has(id)
    })
    .map(item => withAllowed(item, false))
  const allowed = [...tierIds].reverse().flatMap(id => {
    const item = byId.get(id)
    return item ? [withAllowed(item, true)] : []
  })

  return {
    ...schema,
    // - A new profile: Radarr/Sonarr assign the id on create
    id: undefined,
    name: tierProfileName(tier),
    upgradeAllowed: false,
    cutoff: tierIds[0],
    items: [...disallowed, ...allowed],
    minFormatScore: 0,
    cutoffFormatScore: 0,
    // - Zeroed rather than emptied: the schema lists every custom format,
    //   and Radarr/Sonarr reject a profile that leaves one out
    formatItems: (schema.formatItems ?? []).map(f => ({ ...f, score: 0 })),
    ...(app === 'radarr'
      ? { language: opts.language ?? RADARR_TIER_PROFILE_LANGUAGE }
      : {}),
  }
}

/**
 * A profile's allowed items, worst -> best, one key each - `q<id>` for a
 * quality, `g<id>[members]` for a group with its allowed member ids.
 */
function allowedSignature(profile: TierQualityProfile): string[] {
  return (profile.items ?? [])
    .filter(item => item.allowed)
    .map(item => {
      if (!item.items?.length) return `q${item.quality?.id}`
      const members = item.items
        .filter(m => m.allowed)
        .map(m => m.quality?.id)
        .sort((a, b) => (a ?? -1) - (b ?? -1))
      return `g${item.id}[${members.join(',')}]`
    })
}

/**
 * `true` when `existing` allows a different set of items, in a different
 * order, or has a different cutoff or `upgradeAllowed` from `wanted`. Its
 * name, disallowed items' order, scores, language and everything else are
 * not compared - someone tuning those in the Radarr/Sonarr UI is left be.
 */
export function profileDrifted(
  existing: TierQualityProfile,
  wanted: TierQualityProfile,
): boolean {
  if (existing.cutoff !== wanted.cutoff) return true
  if ((existing.upgradeAllowed ?? false) !== (wanted.upgradeAllowed ?? false)) {
    return true
  }

  const a = allowedSignature(existing)
  const b = allowedSignature(wanted)
  return a.length !== b.length || a.some((key, i) => key !== b[i])
}

export type TierProfilePlan<P extends TierQualityProfile> =
  | { action: 'create'; tier: QualityTier; profile: P }
  | { action: 'update'; tier: QualityTier; id: number; profile: P }
  | { action: 'keep'; tier: QualityTier; id: number }

/**
 * What to do, per tier (best first), to bring `app`'s profiles in line:
 *
 * - No profile carries the tier's name -> `create` it (deleted ones come
 *   back this way).
 * - It has drifted -> `update`: the existing profile with only `items`,
 *   `cutoff` and `upgradeAllowed` replaced, so its id, name and anything
 *   else someone set are kept.
 * - Otherwise -> `keep`.
 *
 * Profiles are matched by exact name, so one without the `lilnas · ` prefix
 * is never matched and never touched. Throws as `tierProfileSpec()` does.
 */
export function planTierProfiles<P extends TierQualityProfile>(
  app: ArrApp,
  existing: readonly P[],
  schema: P,
  opts: TierProfileSpecOptions = {},
): TierProfilePlan<P>[] {
  return QUALITY_TIERS.map((tier): TierProfilePlan<P> => {
    const wanted = tierProfileSpec(app, tier, schema, opts)
    const match = existing.find(
      p => p.id != null && p.name === tierProfileName(tier),
    )

    if (match?.id == null) return { action: 'create', tier, profile: wanted }
    if (!profileDrifted(match, wanted)) {
      return { action: 'keep', tier, id: match.id }
    }

    return {
      action: 'update',
      tier,
      id: match.id,
      profile: {
        ...match,
        items: wanted.items,
        cutoff: wanted.cutoff,
        upgradeAllowed: wanted.upgradeAllowed,
      },
    }
  })
}
