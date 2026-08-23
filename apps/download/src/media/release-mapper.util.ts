import type {
  Release,
  ReleaseProtocol,
  ReleaseQuality,
} from '@lilnas/utils/download/types'

/**
 * The structural intersection of Radarr's and Sonarr's generated
 * `ReleaseResource` types - every field the shared `Release` DTO reads that
 * both sides spell identically.
 *
 * Declared structurally rather than as `RadarrReleaseResource |
 * SonarrReleaseResource` because the two are only *nominally* distinct: they
 * differ in the fields this doesn't touch (Sonarr adds `fullSeason`/
 * `seasonNumber`/`episodeNumbers`; `imdbId` is a number in Radarr and a
 * string in Sonarr), so a structural parameter lets one mapper serve both
 * without importing either SDK's types here.
 */
export interface CommonReleaseResource {
  age?: number
  customFormatScore?: number
  downloadAllowed?: boolean
  guid?: string | null
  indexer?: string | null
  indexerId?: number
  languages?: Array<{ name?: string | null }> | null
  leechers?: number | null
  protocol?: ReleaseProtocol
  publishDate?: string
  quality?: { quality?: { name?: string | null; resolution?: number } }
  rejected?: boolean
  rejections?: Array<string> | null
  releaseGroup?: string | null
  seeders?: number | null
  size?: number
  title?: string | null
}

/**
 * Flattens the SDK's nested `QualityModel { quality: { name, resolution,
 * source, modifier }, revision }` down to the two fields anyone renders.
 * Returns `undefined` rather than a `{ name: 'Unknown' }` placeholder - a
 * release genuinely missing quality info and one reporting unknown quality
 * are different things, and only the caller knows which to show.
 */
function toReleaseQuality(
  model: CommonReleaseResource['quality'],
): ReleaseQuality | undefined {
  const name = model?.quality?.name
  if (!name) {
    return undefined
  }

  return { name, resolution: model?.quality?.resolution }
}

/**
 * Flattens `Array<Language>` to just the names, dropping unnamed entries.
 * `undefined` (not `[]`) when there's nothing to show, so "no language data"
 * stays distinguishable from "explicitly no languages".
 */
function toReleaseLanguages(
  languages: CommonReleaseResource['languages'],
): string[] | undefined {
  const names = (languages ?? [])
    .map(language => language.name)
    .filter((name): name is string => Boolean(name))

  return names.length > 0 ? names : undefined
}

/**
 * Maps the fields Radarr and Sonarr share onto the `Release` DTO. Each
 * service's own `toRelease()` calls this and then layers on whatever is
 * unique to it (nothing, for Radarr; the season/episode fields, for Sonarr).
 *
 * `flaggedBad` is always `false` here: it's this app's own annotation, joined
 * on from `bad_files` one layer up in `ReleaseService.listReleases()`. A
 * mapper that reached for the DB would make every release list N queries deep.
 */
export function toCommonRelease(resource: CommonReleaseResource): Release {
  return {
    age: resource.age,
    customFormatScore: resource.customFormatScore,
    // Defaulted rather than left optional: the UI gates the grab button on
    // these two, and an absent field must read as "not allowed"/"not
    // rejected" explicitly rather than as `undefined` for the caller to
    // guess at.
    downloadAllowed: resource.downloadAllowed ?? false,
    flaggedBad: false,
    // A release with no guid can't be grabbed, but it's still a real search
    // result - so it maps to an empty identity and stays visible rather
    // than vanishing from the list with no explanation.
    guid: resource.guid ?? '',
    indexer: resource.indexer ?? undefined,
    indexerId: resource.indexerId ?? 0,
    languages: toReleaseLanguages(resource.languages),
    leechers: resource.leechers ?? undefined,
    protocol: resource.protocol,
    publishDate: resource.publishDate,
    quality: toReleaseQuality(resource.quality),
    rejected: resource.rejected ?? false,
    rejections: resource.rejections ?? undefined,
    releaseGroup: resource.releaseGroup ?? undefined,
    seeders: resource.seeders ?? undefined,
    size: resource.size,
    title: resource.title ?? 'Unknown release',
  }
}
