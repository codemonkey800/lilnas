import type { ManualImportResource as RadarrManualImportResource } from '@lilnas/media/radarr'
import type { ManualImportResource as SonarrManualImportResource } from '@lilnas/media/sonarr'
import type {
  ManualImportCandidate,
  ReleaseQuality,
  ShowScope,
} from '@lilnas/utils/download/types'

export type { RadarrManualImportResource, SonarrManualImportResource }

/**
 * What the dialog says about a file Sonarr could not attribute to any
 * episode. Exported so the row that renders it and the test that asserts it
 * name the same string rather than two copies of the same sentence.
 *
 * This is the one genuinely un-importable case: the `ManualImport` command
 * is keyed on `episodeIds`, so a file with no episodes has nothing to import
 * *into*. Sonarr's own dialog lets a human pick the episodes by hand, which
 * is exactly what the message points at.
 */
export const UNPARSED_EPISODES_REASON =
  'Sonarr could not tell which episodes this file holds. Import it from Sonarr, where you can pick them.'

/**
 * The fields Radarr's and Sonarr's (nominally distinct, structurally
 * identical) `ManualImportResource` types share - everything the wire
 * `ManualImportCandidate` reads before the per-service half is layered on.
 *
 * Declared structurally for the reason `CommonReleaseResource` is: the two
 * generated types differ only in the fields this does *not* touch (Radarr
 * has `movie`, Sonarr has `episodes`/`seasonNumber`/`releaseType`), so one
 * parameter type serves both without a union.
 */
interface CommonManualImportResource {
  downloadId?: string | null
  languages?: Array<{ name?: string | null }> | null
  name?: string | null
  path?: string | null
  quality?: { quality?: { name?: string | null; resolution?: number } }
  rejections?: Array<{ reason?: string | null }> | null
  relativePath?: string | null
  releaseGroup?: string | null
  size?: number
}

/**
 * Flattens the SDK's nested `QualityModel` to the two fields the dialog
 * renders, exactly as `release-mapper.util.ts` does for a release: a
 * candidate with no quality info stays `undefined` rather than becoming a
 * `{ name: 'Unknown' }` placeholder only the caller could decide on.
 */
function toQuality(
  model: CommonManualImportResource['quality'],
): ReleaseQuality | undefined {
  const name = model?.quality?.name
  if (!name) {
    return undefined
  }

  return { name, resolution: model?.quality?.resolution }
}

/** `Array<Language> -> string[]`, dropping unnamed entries. */
function toLanguageNames(
  languages: CommonManualImportResource['languages'],
): string[] | undefined {
  const names = (languages ?? [])
    .map(language => language.name)
    .filter((name): name is string => Boolean(name))

  return names.length > 0 ? names : undefined
}

/**
 * `Array<ImportRejectionResource> -> string[]` - the `reason` sentences only.
 *
 * A rejection is `{ reason, type }`, not a string, and the `type`
 * (`permanent`/`temporary`) is deliberately dropped: upstream's
 * `ManualImportService` builds a *fresh* import decision with no rejections
 * for every file it is handed, so even a `permanent` rejection is
 * informational here. Surfacing the severity would only invite the dialog to
 * gate on it.
 *
 * Always an array (possibly empty), never `undefined`: the wire type makes
 * `rejections` required so a row can render the list without a null check.
 */
function toRejectionReasons(
  rejections: CommonManualImportResource['rejections'],
): string[] {
  return (rejections ?? [])
    .map(rejection => rejection.reason)
    .filter((reason): reason is string => Boolean(reason))
}

/**
 * The service-agnostic half of a candidate, or `undefined` for a resource
 * with no `path`.
 *
 * `path` is the identity of a row - it is what a commit sends back, and what
 * upstream defines `ManualImportFile` equality on - so a resource without
 * one cannot be addressed by any later call and is not a candidate at all.
 * The caller logs the skip; this has no logger of its own.
 */
function toBaseCandidate(
  resource: CommonManualImportResource,
): Omit<ManualImportCandidate, 'importable'> | undefined {
  const path = resource.path

  if (!path) {
    return undefined
  }

  return {
    downloadId: resource.downloadId ?? undefined,
    languages: toLanguageNames(resource.languages),
    name: resource.name ?? undefined,
    path,
    quality: toQuality(resource.quality),
    rejections: toRejectionReasons(resource.rejections),
    relativePath: resource.relativePath ?? undefined,
    releaseGroup: resource.releaseGroup ?? undefined,
    size: resource.size,
  }
}

/**
 * Radarr's `ManualImportResource` -> the wire candidate.
 *
 * Always `importable: true`. Radarr is asked for candidates by `downloadId`
 * **and** `movieId`, and it resolves the candidate's movie from that id even
 * when the filename defeats its parser - which is precisely the case this
 * whole feature exists for. So there is no movie-side equivalent of Sonarr's
 * "which episodes is this?" question to fail on, and the `movieId` the
 * command carries is the resolved upstream id either way.
 *
 * `fallbackTitle` is the resolved media's own title, used when Radarr echoes
 * back no movie at all - the row still has to say what it is importing.
 */
export function toMovieCandidate(
  resource: RadarrManualImportResource,
  fallbackTitle?: string,
): ManualImportCandidate | undefined {
  const base = toBaseCandidate(resource)

  if (!base) {
    return undefined
  }

  return {
    ...base,
    importable: true,
    movieTitle: resource.movie?.title ?? fallbackTitle,
  }
}

/**
 * Sonarr's `ManualImportResource` -> the wire candidate, in three branches:
 *
 * - Sonarr parsed the episodes: use them.
 * - It did not, but the request is episode-scoped: the job already names the
 *   episode, so the scope answers the question Sonarr could not. Only the id
 *   matters to the command - the numbers are display, and default to 0 when
 *   nothing supplies them.
 * - Neither: not importable ({@link UNPARSED_EPISODES_REASON}). A season
 *   pack Sonarr could not parse legitimately lands here; it is a blocked
 *   row, not an error.
 */
export function toShowCandidate(
  resource: SonarrManualImportResource,
  scope?: ShowScope,
): ManualImportCandidate | undefined {
  const base = toBaseCandidate(resource)

  if (!base) {
    return undefined
  }

  // `flatMap` rather than `filter().map()` so the `id != null` test actually
  // narrows - the command is keyed on episode ids, and an episode Sonarr
  // handed back without one is not addressable.
  const episodes = (resource.episodes ?? []).flatMap(episode =>
    episode.id == null
      ? []
      : [
          {
            episodeNumber: episode.episodeNumber ?? 0,
            id: episode.id,
            seasonNumber: episode.seasonNumber ?? 0,
            ...(episode.title ? { title: episode.title } : {}),
          },
        ],
  )

  if (episodes.length > 0) {
    return { ...base, episodes, importable: true }
  }

  if (scope?.episodeId != null) {
    return {
      ...base,
      episodes: [
        {
          episodeNumber: scope.episodeNumber ?? 0,
          id: scope.episodeId,
          seasonNumber: scope.seasonNumber ?? resource.seasonNumber ?? 0,
        },
      ],
      importable: true,
    }
  }

  return { ...base, blockedReason: UNPARSED_EPISODES_REASON, importable: false }
}
