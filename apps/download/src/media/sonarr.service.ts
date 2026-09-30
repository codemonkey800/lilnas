import type {
  CommandResource,
  CommandResourceWritable,
  EpisodeFileResource,
  EpisodeResource,
  HistoryResource,
  IndexerResource,
  Language,
  ManualImportResource,
  QualityModel,
  QualityProfileResource,
  QueueResource,
  ReleaseResource,
  ReleaseType,
  SeasonResource,
  SeriesResource,
  SeriesResourceWritable,
} from '@lilnas/media/sonarr'
import {
  deleteApiV3EpisodefileById,
  deleteApiV3QueueById,
  deleteApiV3ReleaseprofileById,
  deleteApiV3SeriesById,
  getApiV3Command,
  getApiV3CommandById,
  getApiV3ConfigDownloadclient,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3Episodefile,
  getApiV3Health,
  getApiV3History,
  getApiV3HistorySeries,
  getApiV3HistorySince,
  getApiV3Indexer,
  getApiV3Manualimport,
  getApiV3Qualityprofile,
  getApiV3QualityprofileSchema,
  getApiV3Queue,
  getApiV3Release,
  getApiV3Releaseprofile,
  getApiV3Rootfolder,
  getApiV3Series,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  postApiV3Command,
  postApiV3Qualityprofile,
  postApiV3Release,
  postApiV3Releaseprofile,
  postApiV3Series,
  putApiV3EpisodeMonitor,
  putApiV3QualityprofileById,
  putApiV3ReleaseprofileById,
  putApiV3SeriesById,
  putApiV3SeriesEditor,
} from '@lilnas/media/sonarr'
import {
  DownloadType,
  type Episode,
  EPISODE_FINALE_TYPES,
  QUALITY_TIERS,
  QualityTier,
  type Release,
  type Season,
  type Show,
  SHOW_SERIES_TYPES,
  SHOW_STATUSES,
  type ShowScope,
  type ShowSeriesType,
  type ShowStatus,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { mediaId } from 'src/db/media-id'
import type {
  CommandRef,
  CommandSnapshot,
  CommandStatus,
} from 'src/media/arr-command.types'
import type { SonarrMediaClient } from 'src/media/clients'
import { SONARR_CLIENT } from 'src/media/clients'
import {
  buildFlaggedTerms,
  FLAGGED_RELEASE_PROFILE_NAME,
  planFlaggedReleaseProfile,
} from 'src/media/flagged-release-terms.util'
import { mapCatalogueEntries } from 'src/media/map-media.util'
import { originalLanguageName } from 'src/media/movie-metadata.util'
import { defaultQualityTier } from 'src/media/quality-tier-default'
import {
  planTierProfiles,
  tierProfileName,
  type TierProfilePlan,
} from 'src/media/quality-tiers'
import { toCommonRelease } from 'src/media/release-mapper.util'
import {
  checkSdkError,
  isAlreadyAddedError,
  SdkHttpError,
  unwrapSdkResult,
} from 'src/media/sdk-result.util'
import { generateTitleSlug } from 'src/media/title-slug.util'
import { toUpstreamIsoDateTime } from 'src/media/upstream-date.util'

/**
 * Sonarr's SeriesSearch command accepts seriesId but the generated SDK type
 * omits command-specific body parameters. We extend it locally so TypeScript
 * validates the extra field rather than silently ignoring it via a raw `as`.
 * (Mirrors apps/tdr-bot/src/media/services/sonarr.service.ts.)
 */
type SeriesSearchCommand = CommandResourceWritable & { seriesId?: number }

/**
 * A lookup term Sonarr v5's `/series/lookup` rejects with a 400
 * (`InvalidSearchTermException`): anything that reads as a path on either OS
 * - a leading `/` or `\`, or a drive letter like `C:\`. Mirrors Sonarr's
 * `IsPathValid(PathValidationType.AnyOs)` check in `SkyHookProxy`.
 */
const PATH_LIKE_LOOKUP_TERM = /^([\\/]|[A-Za-z]:\\)/

/**
 * The two narrower search commands, extended the same way as
 * `SeriesSearchCommand` above.
 *
 * TODO(phase-4-verify): both command names are well-documented Sonarr
 * commands but are **not** in the generated SDK (`CommandResourceWritable.name`
 * is a bare string), so nothing here type-checks the literal itself.
 *
 * A wrong `name` is the *loud* failure: Sonarr resolves the command type by
 * name and rejects an unknown one, which `checkSdkError` surfaces onto the
 * job with Sonarr's own message. The silent failure is a wrong **body field**
 * name - accepted, ignored, nothing searched. `POST /api/v3/command` echoes
 * the parsed command back in `body`, which is what makes that checkable; see
 * the Phase 4 manual-verification block in
 * `docs/features/download/backend.md`.
 */
type EpisodeSearchCommand = CommandResourceWritable & { episodeIds?: number[] }
type SeasonSearchCommand = CommandResourceWritable & {
  seasonNumber?: number
  seriesId?: number
}

/**
 * RefreshSeries, typed the same way. `isNewSeries: true` is what Sonarr's own
 * add-time refresh carries - and Sonarr dedupes a pending command on its body
 * (ignoring `trigger`), so sending the identical body is how a caller gets
 * that already-queued command's id back instead of queueing a second one.
 */
type RefreshSeriesCommand = CommandResourceWritable & {
  isNewSeries?: boolean
  seriesIds: number[]
}

/**
 * One file in a ManualImport command body - what Sonarr's own manual-import
 * dialog sends per row once the user has confirmed it.
 *
 * `path`, `seriesId` and `episodeIds` are the required trio: the path is the
 * file on disk Sonarr refused to import automatically, and the two ids say
 * which series and which episodes it belongs to. Everything else is carried
 * over from the `ManualImportResource` candidate so Sonarr keeps the quality,
 * languages and release group it already parsed instead of re-deriving them
 * from the filename - `downloadId` in particular is what lets Sonarr tie the
 * import back to the queue item that produced it.
 *
 * Built by the caller from `getManualImportCandidates()` output; exported
 * because the mapping from candidate to file lives outside this service.
 */
export type SonarrManualImportFile = {
  downloadId?: string | null
  episodeFileId?: number | null
  episodeIds: number[]
  folderName?: string | null
  indexerFlags?: number
  languages?: Language[] | null
  path: string
  quality?: QualityModel
  releaseGroup?: string | null
  releaseType?: ReleaseType
  seriesId: number
}

/**
 * The ManualImport command body. Neither SDK types command-specific fields -
 * `CommandResourceWritable` carries only `name` - so this is the same
 * locally-typed intersection trick `SeriesSearchCommand` above uses, posted
 * through `postApiV3Command`.
 */
type ManualImportCommand = CommandResourceWritable & {
  files: SonarrManualImportFile[]
  importMode: 'auto' | 'copy' | 'move'
}

/**
 * What `unmonitorScope` switches off: a `ShowScope`, optionally widened to an
 * explicit list of episodes. The list exists for a multi-episode file - an
 * episode delete removes every episode sharing the file, and no single
 * `episodeId` can name them all. When set it wins over `episodeId`.
 */
export type UnmonitorScope = ShowScope & { episodeIds?: readonly number[] }

/**
 * Scopes `getEpisodes`/the monitor writes to part of a series. An episode is
 * named by `episodeId`, or - before its id is known, as a fresh add's
 * request is - by `seasonNumber` + `episodeNumber`.
 */
export interface SeriesScope {
  episodeId?: number
  episodeNumber?: number
  seasonNumber?: number
}

/**
 * Whether a scope names part of a series rather than all of it. An episode
 * by number always carries its season, so `seasonNumber` covers it.
 */
function isNarrowScope(scope: SeriesScope | undefined): boolean {
  return (
    scope != null && (scope.episodeId != null || scope.seasonNumber != null)
  )
}

/**
 * What `getReleases` has to be scoped to: a season, an episode, or both -
 * never neither. Sonarr's `GET /release` with only a `seriesId` doesn't
 * search at all; it answers with the indexers' RSS feed, so an unscoped
 * listing reads as "what's new everywhere", not "what exists for this show".
 * Making the empty scope unrepresentable keeps that call from compiling.
 */
export type SonarrReleaseScope =
  | { episodeId: number; seasonNumber?: number }
  | { episodeId?: number; seasonNumber: number }

/**
 * Narrows a loose scope to one `getReleases` accepts, or `undefined` when it
 * names neither a season nor an episode. `!= null`, never truthiness: season
 * 0 is Sonarr's specials.
 */
export function toSonarrReleaseScope(
  scope: SeriesScope,
): SonarrReleaseScope | undefined {
  if (scope.episodeId != null) {
    return scope.seasonNumber != null
      ? { episodeId: scope.episodeId, seasonNumber: scope.seasonNumber }
      : { episodeId: scope.episodeId }
  }

  if (scope.seasonNumber != null) {
    return { seasonNumber: scope.seasonNumber }
  }

  return undefined
}

export interface EnsureSeriesOptions {
  /**
   * `true` for a request: add the series monitored (`monitor: 'all'` -
   * every season but the specials; a narrow scope's add is monitored later,
   * by `monitorScope` - see `ensureSeries`), or turn series monitoring on
   * for a library series that has it off. `false`
   * for browsing and grabbing: add an absent series **unmonitored**
   * (`monitor: 'none'`, so every episode is off too) and never write to one
   * that is already there. Sonarr's interactive search and its grab endpoint
   * don't check `monitored`, so neither needs it on - a grab turns on what it
   * covers itself, and only once the grab has succeeded.
   */
  monitored: boolean
  /**
   * Honoured only with `monitored: true`. When present, `ensureSeries` also
   * walks the episodes this scope names and monitors any that are off - an
   * empty object means the whole series **outside season 0**, matching
   * Sonarr's own `MonitorTypes.All` (`SeasonNumber > 0`). Specials are
   * monitored only when the scope names season 0 or a season-0 episode.
   *
   * `ensureSeries` never widens the scope on its own: the request path
   * decides what a request covers (a bare `POST /download/shows` is an
   * explicit whole-series request and monitors every regular season).
   *
   * A narrow scope (a season or an episode) on a series that was
   * **unmonitored** also turns off every fileless episode outside it before
   * series monitoring goes on, so the request doesn't re-arm RSS for the
   * rest of the series.
   */
  monitorEpisodes?: SeriesScope
  /**
   * The quality profile an **add** gets - see
   * `EnsureMovieOptions.qualityProfileId`: absent means the default tier's,
   * and a library series keeps its profile.
   */
  qualityProfileId?: number
}

/**
 * What `ensureSeries()` hands back - see `EnsureMovieResult`, its Radarr
 * twin, for what each field means.
 */
export interface EnsureSeriesResult {
  series: SeriesResource
  sonarrId: number
  /** `true` when this call *added* the series to Sonarr. */
  wasAdded: boolean
  wasMonitored: boolean
}

/**
 * A Sonarr release as this service hands it out: the shared `Release` plus
 * what Sonarr *mapped* the release to in the library.
 *
 * `seasonNumber`/`episodeNumbers` are what Sonarr parsed from the release
 * title; the `mapped*` fields are what that parse resolved to once scene and
 * absolute numbering were applied - the numbers a job's scope should be
 * compared against. Absent when Sonarr could not map the release (nulls are
 * omitted upstream).
 */
export type SonarrRelease = Release & {
  mappedEpisodeNumbers?: number[]
  mappedSeasonNumber?: number
  mappedSeriesId?: number
}

/**
 * Sonarr's half of the shared `Release` mapper - the common fields plus the
 * Sonarr-only ones. Note `imdbId` is a *string* here where Radarr types it as
 * a number, which is one of the reasons the two generated `ReleaseResource`
 * types can't simply be unioned; the DTO reads neither.
 */
export function toRelease(resource: ReleaseResource): SonarrRelease {
  return {
    ...toCommonRelease(resource),
    episodeNumbers: resource.episodeNumbers ?? undefined,
    fullSeason: resource.fullSeason,
    mappedEpisodeNumbers: resource.mappedEpisodeNumbers ?? undefined,
    mappedSeasonNumber: resource.mappedSeasonNumber ?? undefined,
    mappedSeriesId: resource.mappedSeriesId ?? undefined,
    seasonNumber: resource.seasonNumber,
  }
}

/**
 * The `/health` sources that speak for the download client: one checks that
 * a client is configured and reachable, the other that none is in a failure
 * back-off.
 */
const DOWNLOAD_CLIENT_HEALTH_SOURCES: ReadonlySet<string> = new Set([
  'DownloadClientCheck',
  'DownloadClientStatusCheck',
])

/** Page size for the paged endpoints (`/queue`, `/history`). */
const PAGE_SIZE = 1000

/**
 * A command as `POST /command` returned it -> the `CommandRef` a caller
 * follows it by. `name` and `queued` are always on Sonarr's response; the
 * fallbacks only cover a sparse body, so `name` falls back to what was sent.
 * A missing `id` throws - a command that can't be followed is worthless.
 */
function toCommandRef(resource: CommandResource, sent: string): CommandRef {
  if (resource.id == null) {
    throw new Error(`Sonarr did not return an id for the ${sent} command`)
  }

  return {
    id: resource.id,
    name: resource.name ?? sent,
    queuedAt: resource.queued ?? new Date().toISOString(),
  }
}

/**
 * One `CommandResource` -> `CommandSnapshot`. `id`, `name` and `status` are
 * structural (Sonarr always sends them) and throw when missing, like
 * `toEpisode`'s ids. A command read back from the database after it left the
 * in-memory list has `result: 'unknown'` and no `message`.
 */
function toCommandSnapshot(resource: CommandResource): CommandSnapshot {
  const status: CommandStatus | undefined = resource.status

  if (resource.id == null || resource.name == null || status == null) {
    throw new Error(
      `Sonarr returned a command without an id/name/status ` +
        `(id=${resource.id}, name=${resource.name}, status=${status})`,
    )
  }

  return {
    body: resource.body ?? {},
    ended: resource.ended ?? undefined,
    id: resource.id,
    message: resource.message ?? undefined,
    name: resource.name,
    queued: resource.queued,
    result: resource.result,
    started: resource.started ?? undefined,
    status,
    trigger: resource.trigger,
  }
}

/**
 * The single Sonarr -> `Media` mapper (plan §4.1/§4.2) - see
 * `radarr.service.ts`'s `toMovie()` for the shape of the collapse.
 * `SeriesResource.path` is the series folder (not a per-episode file,
 * unlike Radarr's `movieFile.path`) - Phase 4's episode work will need
 * `episodeFile` separately. Unlike Radarr's per-provider Ratings breakdown,
 * Sonarr's is already a single flat `{ votes, value }` pair.
 *
 * Throws on a missing `tvdbId` for the reason `toMovie()` throws on a
 * missing `tmdbId` - see that function. List call sites go through
 * `mapCatalogueEntries()`.
 */
/** `''`, `null` and whitespace all mean "Sonarr did not say". */
function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** Sonarr sends `0` for an id - or a size - it does not have. */
function positiveInt(value: number | null | undefined): number | undefined {
  return value != null && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

/** See {@link SHOW_STATUSES} for why `deleted` maps to nothing. */
function toShowStatus(
  status: SeriesResource['status'],
): ShowStatus | undefined {
  return SHOW_STATUSES.find(known => known === status)
}

/** See {@link SHOW_SERIES_TYPES} for why `standard` maps to nothing. */
function toShowSeriesType(
  seriesType: SeriesResource['seriesType'],
): ShowSeriesType | undefined {
  return SHOW_SERIES_TYPES.find(known => known === seriesType)
}

/**
 * Sonarr's alternate titles are per scene release and per season, so one
 * name recurs; the series' own title is in the list too. Both go.
 */
function toAlternateTitles(series: SeriesResource): string[] | undefined {
  const own = series.title?.trim().toLowerCase()
  const titles = new Map<string, string>()

  for (const alternate of series.alternateTitles ?? []) {
    const title = text(alternate.title)
    const key = title?.toLowerCase()

    if (title && key && key !== own && !titles.has(key)) {
      titles.set(key, title)
    }
  }

  return titles.size > 0 ? [...titles.values()] : undefined
}

export function toShow(
  series: SeriesResource,
  tierForProfileId: (profileId: number) => QualityTier | null = () => null,
): Show {
  const posterUrl = series.images?.find(
    img => img.coverType === 'poster',
  )?.remoteUrl
  const releaseDate = series.firstAired ?? undefined
  const tvdbId = series.tvdbId

  if (tvdbId == null || !Number.isInteger(tvdbId) || tvdbId <= 0) {
    throw new Error(
      `Sonarr returned a series without a usable tvdbId ` +
        `(tvdbId=${tvdbId}, title=${series.title ?? 'unknown'})`,
    )
  }

  // Falsy-guarded rather than nullish-guarded: Sonarr returns `id: 0` for
  // a lookup result that isn't in the library (see toMovie()).
  const sonarrId = series.id || undefined

  return {
    alternateTitles: toAlternateTitles(series),
    // A non-library lookup hit's `added` is .NET's `DateTime.MinValue`,
    // which `toUpstreamIsoDateTime()` drops - gated on the library id too so
    // the intent doesn't rest on that sentinel alone.
    addedAt: sonarrId ? toUpstreamIsoDateTime(series.added) : undefined,
    certification: series.certification ?? undefined,
    // `statistics` is Sonarr's own count - the one that says whether the
    // series has anything on disk (`episodeFileCount > 0`), since
    // `filePath` below is set for every library series, files or not.
    // `episodeCount` is Sonarr's *wanted-or-have* count, not a total: an
    // episode counts when it is monitored and has aired, or has a file
    // (`SeriesStatisticsRepository.cs:80`). The total is
    // `totalEpisodeCount`, which this doesn't carry.
    episodeCount: sonarrId ? series.statistics?.episodeCount : undefined,
    episodeFileCount: sonarrId
      ? series.statistics?.episodeFileCount
      : undefined,
    filePath: series.path ?? undefined,
    genres: series.genres ?? [],
    id: mediaId({ tvdbId, type: DownloadType.Show }),
    imdbId: text(series.imdbId),
    lastAired: text(series.lastAired),
    // A non-library lookup hit comes back `monitored: true` (Sonarr's
    // default for the add form), which says nothing about this title.
    monitored: sonarrId ? series.monitored : undefined,
    network: text(series.network),
    originalLanguage: originalLanguageName(series.originalLanguage),
    overview: series.overview ?? undefined,
    posterUrl: posterUrl ?? undefined,
    // Only a library series has a profile of its own (see toMovie()).
    qualityTier:
      sonarrId && series.qualityProfileId != null
        ? tierForProfileId(series.qualityProfileId)
        : null,
    ratingValue: series.ratings?.value,
    releaseDate,
    // Sonarr reports minutes; `Media.runtime` is seconds (see MediaBaseSchema).
    runtime: series.runtime != null ? series.runtime * 60 : undefined,
    seriesType: toShowSeriesType(series.seriesType),
    // Library series only, like the counts above - and `0` is an empty
    // series folder, not a size worth printing.
    sizeOnDisk: sonarrId
      ? positiveInt(series.statistics?.sizeOnDisk)
      : undefined,
    sonarrId,
    status: toShowStatus(series.status),
    title: series.title ?? 'Unknown title',
    tmdbId: positiveInt(series.tmdbId),
    tvMazeId: positiveInt(series.tvMazeId),
    tvdbId,
    type: DownloadType.Show,
    year: series.year,
  }
}

/**
 * `toShow()` for a `/series/lookup` hit. Sonarr's lookup zeroes `statistics`
 * even for a series that is in the library - a fully downloaded series comes
 * back `episodeFileCount: 0` - so the counts are dropped rather than
 * reported as "nothing on disk". Everything else on a lookup hit is sound.
 */
export function toLookupShow(
  series: SeriesResource,
  tierForProfileId?: (profileId: number) => QualityTier | null,
): Show {
  return toShow({ ...series, statistics: undefined }, tierForProfileId)
}

/**
 * Whether a request's scope covers an episode: the one episode when it names
 * one (by id, or by season and episode number), else the whole season when
 * it names one, else every regular season - an empty scope leaves season 0
 * out, as Sonarr's own `MonitorTypes.All` (`SeasonNumber > 0`) does.
 * `!= null`, never truthiness: season 0 is Sonarr's specials.
 */
function isEpisodeInScope(
  episode: EpisodeResource,
  scope: SeriesScope,
): boolean {
  if (scope.episodeId != null) {
    return episode.id === scope.episodeId
  }

  if (scope.seasonNumber != null) {
    return (
      episode.seasonNumber === scope.seasonNumber &&
      (scope.episodeNumber == null ||
        episode.episodeNumber === scope.episodeNumber)
    )
  }

  return episode.seasonNumber != null && episode.seasonNumber > 0
}

/**
 * One `EpisodeResource` -> the `Episode` wire type.
 *
 * Every field on the generated type is optional, but `id`, `seasonNumber`
 * and `episodeNumber` are structural - Sonarr has no way to represent an
 * episode without them, and an episode missing one couldn't be searched,
 * grabbed or rendered. So those three throw rather than being defaulted,
 * where `monitored`/`hasFile` (genuinely boolean state) default to `false`.
 */
export function toEpisode(resource: EpisodeResource): Episode {
  if (
    resource.id == null ||
    resource.seasonNumber == null ||
    resource.episodeNumber == null
  ) {
    throw new Error(
      `Sonarr returned an episode without an id/seasonNumber/episodeNumber ` +
        `(id=${resource.id}, season=${resource.seasonNumber}, ` +
        `episode=${resource.episodeNumber})`,
    )
  }

  return {
    absoluteEpisodeNumber: positiveInt(resource.absoluteEpisodeNumber),
    // The broadcast-local day - see `EpisodeSchema.airDate` for why not
    // `airDateUtc`.
    airDate: text(resource.airDate),
    // `episodeFileId: 0` is Sonarr's "no file" - truthiness, not a null
    // guard, and the key is omitted rather than carrying a meaningless 0.
    episodeFileId: resource.episodeFileId || undefined,
    episodeNumber: resource.episodeNumber,
    finaleType: EPISODE_FINALE_TYPES.find(
      known => known === resource.finaleType,
    ),
    hasFile: resource.hasFile ?? false,
    id: resource.id,
    monitored: resource.monitored ?? false,
    overview: resource.overview ?? undefined,
    // Sonarr reports minutes; `Episode.runtime` is seconds, matching
    // `MediaBaseSchema.runtime`'s convention (see `toShow()` above).
    runtime: resource.runtime != null ? resource.runtime * 60 : undefined,
    seasonNumber: resource.seasonNumber,
    title: resource.title ?? undefined,
  }
}

/**
 * One `SeasonResource` plus its already-mapped episodes -> the `Season` wire
 * type.
 *
 * The counts come from Sonarr's own `statistics`, and `episodeCount` is
 * **not** a total: Sonarr counts an episode there when it is
 * `(monitored AND aired) OR hasFile` (`SeriesStatisticsRepository.cs:80`), so
 * unmonitored and not-yet-aired episodes are left out - a season of
 * unmonitored specials reads `0`. The season's total is Sonarr's
 * `totalEpisodeCount` (`COUNT(*)`), which is exactly `episodes.length` here
 * since `episodes` is every row Sonarr holds for the season (`listSeasons()`
 * fetches them unscoped). The counts fall back to the episode list only when
 * Sonarr sent no statistics at all - a freshly-added series, or a season
 * `listSeasons()` synthesized - so there `episodeCount` is the total.
 */
export function toSeason(
  resource: SeasonResource,
  episodes: Episode[],
): Season {
  const statistics = resource.statistics

  return {
    episodeCount: statistics?.episodeCount ?? episodes.length,
    episodeFileCount:
      statistics?.episodeFileCount ?? episodes.filter(e => e.hasFile).length,
    episodes,
    monitored: resource.monitored ?? false,
    seasonNumber: resource.seasonNumber ?? 0,
    sizeOnDisk: statistics?.sizeOnDisk,
  }
}

@Injectable()
export class SonarrService {
  private logger = new Logger(SonarrService.name)

  constructor(
    @Inject(SONARR_CLIENT) private readonly client: SonarrMediaClient,
  ) {}

  /**
   * Sonarr's lookup, mapped to `Media` - backs both `/shows/search` and
   * `/discover`. See `RadarrService.search()` for why those were ever two
   * methods.
   *
   * Sonarr v5 answers a path-like term (see `PATH_LIKE_LOOKUP_TERM`) with a
   * 400 instead of an empty list, which used to surface as a 500 from
   * `/shows/search`. No series can match such a term, so it comes back as no
   * results: the guard skips the round trip, and a lookup 400 maps to `[]`
   * too, for any term Sonarr rejects that the guard doesn't know about. The
   * term itself stays out of that log line - it's user input.
   */
  async search(query: string): Promise<Show[]> {
    if (PATH_LIKE_LOOKUP_TERM.test(query)) {
      return []
    }

    let series: SeriesResource[]
    try {
      series = unwrapSdkResult(
        await getApiV3SeriesLookup({
          client: this.client,
          query: { term: query },
        }),
        'searchShows',
      )
    } catch (error) {
      if (error instanceof SdkHttpError && error.status === 400) {
        this.logger.warn(
          { action: 'searchShows', status: error.status },
          'Sonarr rejected the lookup term - returning no results',
        )
        return []
      }
      throw error
    }

    return mapCatalogueEntries(series, this.toLookupShow, {
      action: 'searchShows',
      logger: this.logger,
    })
  }

  /**
   * The whole Sonarr library, mapped to `Media` - `MediaResolverService`'s
   * library cache is built from this (one call per TTL window rather than
   * one per job). Same underlying call as `ensureSeries()`'s
   * library-first lookup (`getApiV3Series`).
   */
  async getLibrary(): Promise<Show[]> {
    const [series] = await Promise.all([
      getApiV3Series({ client: this.client }).then(result =>
        unwrapSdkResult(result, 'getSeries'),
      ),
      this.warmTierCache(),
    ])

    return mapCatalogueEntries(series, this.toShow, {
      action: 'getSeries',
      logger: this.logger,
    })
  }

  /**
   * `RadarrService.getLibraryMovie()`'s Sonarr twin: one series' library
   * entry by `tvdbId`, or `undefined` when Sonarr's library doesn't hold it.
   */
  async getLibraryShow(tvdbId: number): Promise<Show | undefined> {
    const [series] = await Promise.all([
      getApiV3Series({ client: this.client, query: { tvdbId } }).then(result =>
        unwrapSdkResult(result, 'getSeries'),
      ),
      this.warmTierCache(),
    ])

    const show = series.find(entry => entry.tvdbId === tvdbId)
    return show ? this.toShow(show) : undefined
  }

  /**
   * Per-id fallback for `MediaResolverService` when a tvdbId isn't in the
   * library cache. This is the *discover* lookup, not a library query, so a
   * title requested but since removed from Sonarr still resolves
   * (metadata-only, no `sonarrId`/`filePath`). But when the series **is** in
   * the library, Sonarr's lookup returns the library row itself - real `id`,
   * `monitored`, `path`, `qualityProfileId` - so the result carries a
   * `sonarrId` and `filePath` like a library read would. Only `statistics`
   * is untrustworthy on a lookup hit, which `toLookupShow()` drops.
   */
  async lookupByTvdbId(tvdbId: number): Promise<Show> {
    const searchResults = unwrapSdkResult(
      await getApiV3SeriesLookup({
        client: this.client,
        query: { term: `tvdb:${tvdbId}` },
      }),
      'lookupSeriesByTvdbId',
    )

    const lookup = searchResults.find(s => s.tvdbId === tvdbId)
    if (!lookup) {
      throw new Error(`Series with TVDB ID ${tvdbId} not found`)
    }

    return this.toLookupShow(lookup)
  }

  /**
   * Gets the series into Sonarr's library - the Sonarr counterpart to
   * `RadarrService.ensureMovie()`, with the same three branches:
   *
   * - **absent**: added with `monitored: opts.monitored`, searching for
   *   nothing - a caller that wants a search layers the command on top. A
   *   monitored whole-series add is `addOptions.monitor: 'all'`, which
   *   covers every episode outside the specials - Sonarr's
   *   `MonitorTypes.All` is `SeasonNumber > 0` (`EpisodeMonitoredService.cs`),
   *   the same line `monitorScopedEpisodes` draws for an unscoped request.
   *   A monitored add for a narrower scope is `'none'`, so RSS isn't armed
   *   for every other episode - and Sonarr adds a `'none'` series with the
   *   series flag **off**, whatever `monitored` says. The caller monitors
   *   the scope with `monitorScope`, series flag included, once the add-time
   *   refresh has finished and the episodes exist. An unmonitored add is
   *   `'none'`.
   * - **present, `opts.monitored: false`**: nothing is written.
   * - **present, `opts.monitored: true`**: series monitoring is turned on if
   *   it was off, and `opts.monitorEpisodes` names the episodes to turn on.
   *   Sonarr needs the *episodes* monitored, not just the series, for its
   *   own searches to grab anything. When the series was off and the scope
   *   is narrower than the whole series, fileless episodes outside it are
   *   turned off first (see `EnsureSeriesOptions.monitorEpisodes`).
   *
   * A `400 already been added` from the add re-reads the library and carries
   * on down the "present" branch rather than failing.
   */
  async ensureSeries(
    tvdbId: number,
    opts: EnsureSeriesOptions,
  ): Promise<EnsureSeriesResult> {
    const existing = await this.findLibrarySeries(tvdbId)

    if (existing) {
      return this.ensureExistingSeries(tvdbId, existing, opts)
    }

    const searchResults = unwrapSdkResult(
      await getApiV3SeriesLookup({
        client: this.client,
        query: { term: `tvdb:${tvdbId}` },
      }),
      'lookupSeriesByTvdbId',
    )

    const lookup = searchResults.find(s => s.tvdbId === tvdbId)
    if (!lookup) {
      throw new Error(`Series with TVDB ID ${tvdbId} not found`)
    }

    const [qualityProfileId, { rootFolderPath }] = await Promise.all([
      opts.qualityProfileId ?? this.tierProfileId(defaultQualityTier()),
      this.getDefaultConfiguration(),
    ])

    const title = lookup.title ?? `Show ${tvdbId}`

    let added: SeriesResource
    try {
      added = unwrapSdkResult(
        await postApiV3Series({
          client: this.client,
          // Domain fields line up 1:1 with SeriesResourceWritable; addOptions
          // is the only nested writable-only shape, so a targeted cast
          // covers it.
          body: {
            tvdbId,
            title,
            titleSlug: lookup.titleSlug ?? generateTitleSlug(title),
            qualityProfileId,
            rootFolderPath,
            monitored: opts.monitored,
            seasonFolder: true,
            useSceneNumbering: false,
            // Keep the type Sonarr looked up: a daily show added as
            // `standard` can't match air-date release names, nor an anime
            // absolute numbering.
            seriesType: lookup.seriesType ?? 'standard',
            addOptions: {
              monitor:
                opts.monitored && !isNarrowScope(opts.monitorEpisodes)
                  ? 'all'
                  : 'none',
              // Never search on add - a request sends its own explicit
              // search command afterwards, and browsing must not kick off a
              // series-wide grab as a side effect. Mirrors Radarr's
              // `searchForMovie: false`.
              searchForMissingEpisodes: false,
              searchForCutoffUnmetEpisodes: false,
            },
          } as unknown as SeriesResourceWritable,
        }),
        'addSeries',
      )
    } catch (error) {
      const raced = isAlreadyAddedError(error)
        ? await this.findLibrarySeries(tvdbId)
        : undefined
      if (!raced) {
        throw error
      }

      this.logger.log(
        { action: 'ensureSeries', tvdbId },
        'Series was added concurrently - continuing with the library entry',
      )
      return this.ensureExistingSeries(tvdbId, raced, opts)
    }

    if (added.id == null) {
      throw new Error(`Sonarr did not return an id for series tvdbId=${tvdbId}`)
    }

    return {
      series: added,
      sonarrId: added.id,
      wasAdded: true,
      wasMonitored: false,
    }
  }

  /** `ensureSeries()`'s "already in the library" branch. */
  private async ensureExistingSeries(
    tvdbId: number,
    existing: SeriesResource,
    opts: EnsureSeriesOptions,
  ): Promise<EnsureSeriesResult> {
    if (existing.id == null) {
      throw new Error(`Sonarr did not return an id for series tvdbId=${tvdbId}`)
    }

    const wasMonitored = existing.monitored === true
    const result = {
      series: existing,
      sonarrId: existing.id,
      wasAdded: false,
      wasMonitored,
    }

    if (!opts.monitored) {
      return result
    }

    // Sonarr's RSS sync grabs any monitored, fileless episode of a monitored
    // series - so turning the series flag on for a narrow request would also
    // re-arm every episode whose own flag was left on (Sonarr's defaults, an
    // old request). Those are turned off first, *before* the series flag
    // flips, so there's no window where the whole series is armed. A series
    // that was already monitored keeps the user's choices, and a
    // whole-series request wants everything on anyway.
    const scope = opts.monitorEpisodes
    const narrow = isNarrowScope(scope)
    const episodes =
      !wasMonitored && narrow ? await this.getEpisodes(existing.id) : undefined
    if (scope && episodes) {
      await this.unmonitorFilelessOutsideScope(episodes, scope)
    }

    if (!wasMonitored) {
      await this.setSeriesMonitored(existing.id, true)
    }

    // With no `monitorEpisodes`, an unmonitored series still gets every
    // regular (non-specials) episode turned on. That covers a series a human unmonitored in
    // Sonarr's own UI: re-monitoring the row alone would leave every episode
    // off and `SeriesSearch` with nothing to grab. A partially-monitored
    // series (some seasons on, some off) never trips this because it stays
    // series-level-monitored the whole time.
    if (scope) {
      await this.monitorScopedEpisodes(existing.id, scope, episodes)
    } else if (!wasMonitored) {
      await this.monitorScopedEpisodes(existing.id, {})
    }

    return result
  }

  /**
   * Turns off every episode outside `scope` that is monitored and has no
   * file - the ones RSS would otherwise grab once the series flag is on.
   * Episodes with a file keep their flag (RSS only upgrades those, and the
   * user may want that). One bulk call, skipped when nothing qualifies.
   */
  private async unmonitorFilelessOutsideScope(
    episodes: readonly EpisodeResource[],
    scope: SeriesScope,
  ): Promise<void> {
    const toTurnOff = episodes
      .filter(
        episode =>
          episode.id != null &&
          episode.monitored === true &&
          episode.hasFile !== true &&
          !isEpisodeInScope(episode, scope),
      )
      .map(episode => episode.id as number)

    await this.setEpisodesMonitored(toTurnOff, false)
  }

  /**
   * The raw library resource for one `tvdbId`, or `undefined`. Filtered
   * upstream like `getLibraryShow()`, and still matched here.
   */
  private async findLibrarySeries(
    tvdbId: number,
  ): Promise<SeriesResource | undefined> {
    const series = unwrapSdkResult(
      await getApiV3Series({ client: this.client, query: { tvdbId } }),
      'getSeries',
    )

    return series.find(s => s.tvdbId === tvdbId)
  }

  /**
   * Monitors whichever episodes the scope names and aren't already on. An
   * unscoped call (no season, no episode) covers the whole series **except
   * season 0** - Sonarr's own `MonitorTypes.All` is `SeasonNumber > 0`, and
   * a bare request is not a request for the specials (extras,
   * behind-the-scenes). Specials are monitored only when the scope asks for
   * them: `seasonNumber: 0`, or the `episodeId` of a season-0 episode.
   *
   * `episodes` is the whole series' list when the caller already read it
   * (the narrow-request pass in `ensureExistingSeries`); otherwise this
   * reads just the scope's season.
   */
  private async monitorScopedEpisodes(
    sonarrId: number,
    scope: SeriesScope,
    episodes?: readonly EpisodeResource[],
  ): Promise<void> {
    const candidates =
      episodes ??
      (await this.getEpisodes(sonarrId, {
        seasonNumber: scope.seasonNumber,
      }))

    const toTurnOn = candidates
      .filter(
        episode =>
          episode.id != null &&
          episode.monitored !== true &&
          isEpisodeInScope(episode, scope),
      )
      .map(episode => episode.id as number)

    await this.setEpisodesMonitored(toTurnOn, true)
  }

  /**
   * Monitors exactly what a request's scope covers, across all three of
   * Sonarr's flags: the scope's episodes (`monitorScopedEpisodes` - an
   * empty scope is every regular season, specials only when named), then,
   * for a season or the whole series, the season flags (`'all'` skips
   * season 0, like the episodes), then the series flag
   * (`monitorSeriesLast`). An episode scope leaves its season's flag alone.
   *
   * Episodes before season flags, never after: Sonarr's `PUT /series` may
   * cascade a changed season flag down to that season's episodes.
   *
   * `startSearch` runs this after a fresh add's refresh has finished - a
   * write made during the refresh is undone by it - and for a library
   * series, where `ensureSeries` has already turned the scope's episodes
   * and the series flag on, and this only adds the season flags.
   */
  async monitorScope(sonarrId: number, scope: SeriesScope): Promise<void> {
    await this.monitorScopedEpisodes(sonarrId, scope)

    if (scope.episodeId == null && scope.episodeNumber == null) {
      await this.setSeasonsMonitored(
        sonarrId,
        // `!= null`, not truthiness - season 0 is Sonarr's specials, and
        // only an explicit `[0]` reaches it: `'all'` skips it.
        scope.seasonNumber != null ? [scope.seasonNumber] : 'all',
        true,
      )
    }

    await this.monitorSeriesLast(sonarrId, scope)
  }

  /**
   * Turns the series flag on if it is off - the last of `monitorScope`'s
   * writes. A narrow request's fresh add is `monitor: 'none'`, and Sonarr's
   * `AddSeriesService` adds any `'none'` series **unmonitored**, whatever
   * `monitored` says. Left that way, the scope's own flags sit under a
   * series Sonarr ignores: `SeasonSearch` (`monitoredOnly: true`) rejects
   * every release as "Series is not monitored", and RSS never grabs.
   *
   * Fileless episodes outside a narrow scope are turned off first, as in
   * `ensureExistingSeries`, so the flag going on arms only the scope. After a
   * `'none'` add there are none to turn off; the pass is there for a series
   * someone switched off in Sonarr since the request.
   */
  private async monitorSeriesLast(
    sonarrId: number,
    scope: SeriesScope,
  ): Promise<void> {
    const series = await this.getSeriesById(sonarrId)
    if (series.monitored === true) return

    if (isNarrowScope(scope)) {
      await this.unmonitorFilelessOutsideScope(
        await this.getEpisodes(sonarrId),
        scope,
      )
    }
    await this.setSeriesMonitored(sonarrId, true)
  }

  /**
   * One series by its Sonarr id - the only call site of
   * `getApiV3SeriesById`, shared by `setSeriesMonitored` (which needs the
   * whole resource to PUT back) and `listSeasons` (which needs
   * `seasons[]`).
   */
  async getSeriesById(sonarrId: number): Promise<SeriesResource> {
    return unwrapSdkResult(
      await getApiV3SeriesById({ client: this.client, path: { id: sonarrId } }),
      'getSeries',
    )
  }

  /**
   * Every season of a series with its episodes, for
   * `GET /download/media/:id/seasons`.
   *
   * Exactly **two** upstream calls, never one per season: the series (for
   * the season list, its `monitored` flags and its per-season statistics)
   * and one unscoped episode listing, grouped by `seasonNumber` here. A
   * 10-season show is 2 requests, not 11.
   */
  async listSeasons(sonarrId: number): Promise<Season[]> {
    const [series, episodeResources] = await Promise.all([
      this.getSeriesById(sonarrId),
      this.getEpisodes(sonarrId),
    ])

    const bySeason = new Map<number, Episode[]>()
    for (const resource of episodeResources) {
      const episode = toEpisode(resource)
      const existing = bySeason.get(episode.seasonNumber)
      if (existing) {
        existing.push(episode)
      } else {
        bySeason.set(episode.seasonNumber, [episode])
      }
    }

    const seasons = new Map<number, SeasonResource>()
    for (const resource of series.seasons ?? []) {
      seasons.set(resource.seasonNumber ?? 0, resource)
    }

    // An episode whose season isn't in `series.seasons[]` still has to land
    // somewhere - Sonarr shouldn't produce one, but dropping it silently
    // would hide episodes rather than report the inconsistency. A
    // synthesized season carries no `monitored`/`statistics` of its own, so
    // `toSeason` falls back to counting the episodes it was handed.
    for (const seasonNumber of bySeason.keys()) {
      if (!seasons.has(seasonNumber)) {
        seasons.set(seasonNumber, { seasonNumber })
      }
    }

    return [...seasons.entries()]
      .sort(([a], [b]) => a - b)
      .map(([seasonNumber, resource]) =>
        toSeason(
          resource,
          // A season Sonarr lists but has no episodes for yet (announced,
          // not aired) is a real season with `episodes: []`, not an omitted
          // one.
          (bySeason.get(seasonNumber) ?? []).sort(
            (a, b) => a.episodeNumber - b.episodeNumber,
          ),
        ),
      )
  }

  /**
   * Flips a series' `monitored` flag. Like Radarr's, Sonarr's
   * `PUT /series/{id}` replaces the whole resource, so the current one is
   * read back first and re-sent with the single field changed.
   */
  async setSeriesMonitored(
    sonarrId: number,
    monitored: boolean,
  ): Promise<void> {
    const series = await this.getSeriesById(sonarrId)

    checkSdkError(
      await putApiV3SeriesById({
        client: this.client,
        // String path param on the PUT, number on the GET - an inconsistency
        // in Sonarr's spec, not a choice on this side.
        path: { id: String(sonarrId) },
        body: { ...series, monitored } as unknown as SeriesResourceWritable,
      }),
      'setSeriesMonitored',
    )
  }

  /**
   * Flips `seasons[].monitored` for the named seasons (or every regular
   * season) and returns the season numbers that actually changed. One GET +
   * at most one PUT - the PUT is skipped when nothing would change.
   *
   * `'all'` means what Sonarr's own `MonitorTypes.All` means -
   * `SeasonNumber > 0` - so it never touches season `0` (specials), in
   * either direction. Specials change only when `0` is named explicitly.
   * A season number Sonarr doesn't list is warned about and skipped
   * rather than thrown on - the delete side may name a season Sonarr has
   * since dropped. A season already at the target value is left alone and
   * not reported.
   *
   * Sonarr's `PUT /series` may itself cascade a season flag change down to
   * that season's episodes. Callers that need to know or set episode state
   * must read/write the episodes BEFORE calling this, not after.
   */
  async setSeasonsMonitored(
    sonarrId: number,
    seasons: readonly number[] | 'all',
    monitored: boolean,
  ): Promise<number[]> {
    if (seasons !== 'all' && seasons.length === 0) {
      return []
    }

    const series = await this.getSeriesById(sonarrId)
    const existing = series.seasons ?? []

    // `?? 0` matches `listSeasons`: Sonarr always sends `seasonNumber`, the
    // generated type just can't promise it.
    if (seasons !== 'all') {
      const known = new Set(existing.map(season => season.seasonNumber ?? 0))
      for (const seasonNumber of seasons) {
        if (!known.has(seasonNumber)) {
          this.logger.warn(
            { seasonNumber, sonarrId },
            'Season not present in Sonarr series; skipping monitored change',
          )
        }
      }
    }

    const wanted = seasons === 'all' ? null : new Set(seasons)
    const changed: number[] = []

    const patchedSeasons = existing.map(season => {
      const seasonNumber = season.seasonNumber ?? 0
      const inScope =
        wanted === null ? seasonNumber > 0 : wanted.has(seasonNumber)
      if (!inScope || season.monitored === monitored) {
        return season
      }

      changed.push(seasonNumber)
      return { ...season, monitored }
    })

    if (changed.length === 0) {
      return []
    }

    checkSdkError(
      await putApiV3SeriesById({
        client: this.client,
        path: { id: String(sonarrId) },
        body: {
          ...series,
          seasons: patchedSeasons,
        } as unknown as SeriesResourceWritable,
      }),
      'setSeasonsMonitored',
    )

    return changed
  }

  /** A series' episodes, optionally narrowed to one season. */
  async getEpisodes(
    sonarrId: number,
    opts: { seasonNumber?: number } = {},
  ): Promise<EpisodeResource[]> {
    return unwrapSdkResult(
      await getApiV3Episode({
        client: this.client,
        query: {
          seriesId: sonarrId,
          ...(opts.seasonNumber != null
            ? { seasonNumber: opts.seasonNumber }
            : {}),
        },
      }),
      'getEpisodes',
    )
  }

  /**
   * Bulk-sets `monitored` across episodes. A no-op for an empty id list -
   * Sonarr would accept the call, but the round trip buys nothing, and
   * callers that filter to "episodes not already on" routinely end up with
   * an empty list.
   */
  async setEpisodesMonitored(
    episodeIds: number[],
    monitored: boolean,
  ): Promise<void> {
    if (episodeIds.length === 0) {
      return
    }

    checkSdkError(
      await putApiV3EpisodeMonitor({
        client: this.client,
        body: { episodeIds, monitored },
      }),
      'setEpisodesMonitored',
    )
  }

  /**
   * Sonarr's interactive indexer search, mapped to the shared `Release` DTO.
   * Unlike Radarr's, this endpoint natively supports scoping to a season or a
   * single episode, so Phase 3 just passes those through rather than
   * filtering client-side.
   *
   * The series must be in the library first (see `ensureSeries()`) - Sonarr
   * keys the search on its own id. Neither it nor its episodes need be
   * monitored: the interactive search never checks.
   *
   * The scope is required - see `SonarrReleaseScope` for why an unscoped
   * call is the RSS feed rather than a search.
   *
   * Only releases Sonarr mapped to **this** series come back: one whose
   * `mappedSeriesId ?? seriesId` names another series (or none) is dropped,
   * so a pick can never grab a different show's release.
   */
  async getReleases(
    sonarrId: number,
    scope: SonarrReleaseScope,
  ): Promise<SonarrRelease[]> {
    const releases = unwrapSdkResult(
      await getApiV3Release({
        client: this.client,
        query: {
          seriesId: sonarrId,
          ...(scope.episodeId != null ? { episodeId: scope.episodeId } : {}),
          ...(scope.seasonNumber != null
            ? { seasonNumber: scope.seasonNumber }
            : {}),
        },
      }),
      'getReleases',
    )

    const ours = releases.filter(
      release => (release.mappedSeriesId ?? release.seriesId) === sonarrId,
    )

    if (ours.length < releases.length) {
      this.logger.warn(
        {
          action: 'getReleases',
          dropped: releases.length - ours.length,
          scope,
          sonarrId,
        },
        'Dropped releases Sonarr did not map to this series',
      )
    }

    return ours.map(toRelease)
  }

  /**
   * Hands one specific release to Sonarr to download. As with Radarr,
   * `{ guid, indexerId }` is all it needs to re-find and grab it.
   */
  async grabRelease(guid: string, indexerId: number): Promise<void> {
    checkSdkError(
      await postApiV3Release({
        client: this.client,
        body: { guid, indexerId },
      }),
      'grabRelease',
    )
  }

  /**
   * Every episode file Sonarr currently holds for a series. Sonarr's endpoint
   * has no season filter, so the replace path narrows by `seasonNumber`
   * itself off each file's own field.
   */
  async getEpisodeFiles(sonarrId: number): Promise<EpisodeFileResource[]> {
    return unwrapSdkResult(
      await getApiV3Episodefile({
        client: this.client,
        query: { seriesId: sonarrId },
      }),
      'getEpisodeFiles',
    )
  }

  /**
   * Deletes one episode file, leaving the series in the library and
   * **monitored**. Deliberately not `unmonitorAndDelete`, which removes the
   * whole series - a replace has to keep the title so the replacement
   * release has somewhere to import to.
   */
  async deleteEpisodeFile(fileId: number): Promise<void> {
    checkSdkError(
      await deleteApiV3EpisodefileById({
        client: this.client,
        path: { id: fileId },
      }),
      'deleteEpisodeFile',
    )
  }

  /**
   * A whole series' history in one unpaged call - the raw material
   * `mapFilesToReleases()` joins back into a `fileId -> release` map.
   *
   * Scoped to the series and nothing narrower on purpose. A 45-file show
   * comes back as ~90 records in 0.03s, so a per-season (let alone
   * per-episode) filter would cost the same per call and turn one request
   * into ten.
   *
   * No `eventType` filter either. Sonarr's `EpisodeHistoryEventType` enum
   * *is* positional - `0` unknown, `1` grabbed, `2` seriesFolderImported,
   * `3` downloadFolderImported, `4` downloadFailed, `5` episodeFileDeleted,
   * `6` episodeFileRenamed, `7` downloadIgnored - and the SDK's string union
   * lists them in that order, so a filter would work. It would just buy
   * nothing: the caller needs both the `grabbed` and the
   * `downloadFolderImported` records, a series' history is small, and each
   * record's `eventType` arrives as the camelCase string, so the caller
   * filters on that and no string -> number map has to exist.
   */
  async getSeriesHistory(sonarrId: number): Promise<HistoryResource[]> {
    return unwrapSdkResult(
      await getApiV3HistorySeries({
        client: this.client,
        query: { seriesId: sonarrId },
      }),
      'getSeriesHistory',
    )
  }

  /**
   * Every indexer Sonarr has configured, raw.
   *
   * Sonarr's `grabbed` history carries **no `indexerId`** - only
   * `data.indexer`, the display name (`'AltHub'`, `'NzbGeek'`) - where
   * Radarr's carries both. Resolving that name back to the id a re-grab needs
   * means matching it against `IndexerResource.name`, which is what this list
   * exists for; building (and caching) the name -> id map is the caller's job.
   */
  async getIndexers(): Promise<IndexerResource[]> {
    return unwrapSdkResult(
      await getApiV3Indexer({ client: this.client }),
      'getIndexers',
    )
  }

  /**
   * Sonarr's generic "go find something for this series" command - the
   * unflagged auto-select path for a whole-series job. When a title *does*
   * have flagged releases, `startSearch` (start-search.ts) searches and
   * picks itself instead, because this command gives the app no say in what
   * Sonarr grabs.
   *
   * Missing episodes only, on Sonarr v5, when the series' profile disallows
   * upgrades - and every tier profile does. That changes no outcome: under
   * such a profile Sonarr rejects any release for an episode that already
   * has a file, whichever command searched for it. So this is only ever the
   * "fetch what's missing" command; re-downloading an episode that has a
   * file goes through a delete and a grab by guid (`ReleaseService`), never
   * through here.
   *
   * Resolves to the queued command, which `getCommand` can follow.
   */
  async triggerSearch(sonarrId: number): Promise<CommandRef> {
    const command: SeriesSearchCommand = {
      name: 'SeriesSearch',
      seriesId: sonarrId,
    }

    return this.postCommand(command, 'SeriesSearch', 'triggerSeriesSearch')
  }

  /**
   * Searches for specific episodes - the narrowest of the three commands,
   * and the one a per-episode request uses. See `EpisodeSearchCommand` for
   * the caveat on the command name.
   */
  async triggerEpisodeSearch(episodeIds: number[]): Promise<CommandRef> {
    const command: EpisodeSearchCommand = {
      episodeIds,
      name: 'EpisodeSearch',
    }

    return this.postCommand(command, 'EpisodeSearch', 'triggerEpisodeSearch')
  }

  /**
   * Searches for one season of a series. See `SeasonSearchCommand` for the
   * caveat on the command name.
   */
  async triggerSeasonSearch(
    sonarrId: number,
    seasonNumber: number,
  ): Promise<CommandRef> {
    const command: SeasonSearchCommand = {
      name: 'SeasonSearch',
      seasonNumber,
      seriesId: sonarrId,
    }

    return this.postCommand(command, 'SeasonSearch', 'triggerSeasonSearch')
  }

  /**
   * Re-reads one series' metadata and rescans its folder.
   *
   * `isNew` marks it as the add-time refresh. Sonarr queues that one itself
   * when a series is added, with body `{ seriesIds: [id], isNewSeries: true }`,
   * and dedupes a pending command on its body - so passing `isNew` for a
   * series this app just added hands back *that* command's id rather than
   * queueing a second refresh.
   */
  async refreshSeries(
    sonarrId: number,
    opts: { isNew?: boolean } = {},
  ): Promise<CommandRef> {
    const command: RefreshSeriesCommand = {
      name: 'RefreshSeries',
      seriesIds: [sonarrId],
      ...(opts.isNew ? { isNewSeries: true } : {}),
    }

    return this.postCommand(command, 'RefreshSeries', 'refreshSeries')
  }

  /**
   * One command's current state, or `null` when Sonarr no longer knows the
   * id (404).
   *
   * Sonarr serves a finished command from memory for ~5 minutes, then from
   * its database for about a day - and the database copy has
   * `result: 'unknown'` and no `message`, so a caller that needs the outcome
   * text has to read it while the command is still fresh.
   */
  async getCommand(id: number): Promise<CommandSnapshot | null> {
    let resource: CommandResource

    try {
      resource = unwrapSdkResult(
        await getApiV3CommandById({ client: this.client, path: { id } }),
        'getCommand',
      )
    } catch (error) {
      if (error instanceof SdkHttpError && error.status === 404) {
        return null
      }
      throw error
    }

    return toCommandSnapshot(resource)
  }

  /**
   * Every command Sonarr holds in memory: the queued and running ones plus
   * those that ended in the last ~5 minutes. Older commands are only
   * reachable by id through `getCommand`.
   */
  async listCommands(): Promise<CommandSnapshot[]> {
    const commands = unwrapSdkResult(
      await getApiV3Command({ client: this.client }),
      'listCommands',
    )

    return commands.map(toCommandSnapshot)
  }

  /**
   * Every history record since `since`, ascending by date, in one unpaged
   * call.
   *
   * `includeEpisode: true` so each record carries its `episode` - the
   * season and episode numbers a caller matches a job's scope against,
   * without a lookup per record. A season pack emits one `grabbed` record
   * per episode, all sharing one `downloadId`.
   *
   * Never log a record's `data` wholesale: `data.downloadUrl` embeds the
   * indexer's API key.
   */
  async getHistorySince(since: Date | string): Promise<HistoryResource[]> {
    return unwrapSdkResult(
      await getApiV3HistorySince({
        client: this.client,
        query: {
          date: since instanceof Date ? since.toISOString() : since,
          includeEpisode: true,
        },
      }),
      'getHistorySince',
    )
  }

  /**
   * Every history record for one download (newest first, as Sonarr sorts
   * it), reading page after page until the whole set is in. The same
   * warning as `getHistorySince` applies to each record's `data`.
   */
  async getHistoryByDownloadId(downloadId: string): Promise<HistoryResource[]> {
    return this.readAllPages(
      page =>
        getApiV3History({
          client: this.client,
          query: { downloadId, page, pageSize: PAGE_SIZE },
        }),
      'getHistoryByDownloadId',
    )
  }

  /**
   * `false` when Sonarr's own health checks flag the download client - one
   * not configured, unreachable, or in a failure back-off. Only warnings
   * and errors from the two download-client checks count; a notice, or any
   * other check, says nothing about the client.
   */
  async isDownloadClientHealthy(): Promise<boolean> {
    const checks = unwrapSdkResult(
      await getApiV3Health({ client: this.client }),
      'getHealth',
    )

    return !checks.some(
      check =>
        check.source != null &&
        DOWNLOAD_CLIENT_HEALTH_SOURCES.has(check.source) &&
        (check.type === 'warning' || check.type === 'error'),
    )
  }

  /**
   * Whether Sonarr re-searches on its own after a failed download, and
   * whether it does so for a release that was picked by hand (interactive
   * search) too. A job that failed with the first on is not over - Sonarr
   * is already looking for a replacement.
   *
   * A missing flag reads as on - `!== false`, not `=== true` - because on is
   * Sonarr's own default for both.
   */
  async getFailedDownloadConfig(): Promise<{
    autoRedownloadFailed: boolean
    fromInteractive: boolean
  }> {
    const config = unwrapSdkResult(
      await getApiV3ConfigDownloadclient({ client: this.client }),
      'getDownloadClientConfig',
    )

    return {
      autoRedownloadFailed: config.autoRedownloadFailed !== false,
      fromInteractive:
        config.autoRedownloadFailedFromInteractiveSearch !== false,
    }
  }

  /**
   * Bulk-edits series-level fields through `PUT /series/editor` - one call
   * for any number of series, and no read-modify-write of the whole
   * resource the way `PUT /series/{id}` needs.
   *
   * `monitored` here is the **series** flag only; it does not touch season
   * or episode monitoring. Only the fields given are sent, so an omitted one
   * is left as it is. No ids, or no changes, makes no call.
   */
  async editSeries(
    seriesIds: number[],
    changes: { monitored?: boolean; qualityProfileId?: number },
  ): Promise<void> {
    if (
      seriesIds.length === 0 ||
      (changes.monitored == null && changes.qualityProfileId == null)
    ) {
      return
    }

    checkSdkError(
      await putApiV3SeriesEditor({
        client: this.client,
        body: {
          seriesIds,
          ...(changes.monitored != null
            ? { monitored: changes.monitored }
            : {}),
          ...(changes.qualityProfileId != null
            ? { qualityProfileId: changes.qualityProfileId }
            : {}),
        },
      }),
      'editSeries',
    )
  }

  /**
   * Fills in a scope's display fields from the one field a caller actually
   * has: given `{ episodeId }`, one lookup returns the season and episode
   * numbers to store alongside it.
   *
   * A scope with no `episodeId` (season-only, or empty) is returned as-is
   * with **no round trip** - there is nothing to resolve, and the common
   * unscoped request must not pay for a call it doesn't need.
   *
   * An episode id Sonarr doesn't know throws rather than yielding a
   * half-filled scope: a job whose scope names an episode that doesn't
   * exist would search for nothing and never explain why.
   */
  async resolveScope(scope: ShowScope): Promise<ShowScope> {
    if (scope.episodeId == null) {
      return scope
    }

    const episode = unwrapSdkResult(
      await getApiV3EpisodeById({
        client: this.client,
        path: { id: scope.episodeId },
      }),
      'getEpisodeById',
    )

    if (episode.seasonNumber == null || episode.episodeNumber == null) {
      throw new Error(
        `Sonarr returned no season/episode number for episode ${scope.episodeId}`,
      )
    }

    return {
      episodeId: scope.episodeId,
      episodeNumber: episode.episodeNumber,
      seasonNumber: episode.seasonNumber,
    }
  }

  /**
   * Turns monitoring **off** for exactly the episodes a scope names, and
   * reports how many it switched off.
   *
   * This is what makes a delete stick: to Sonarr a monitored episode with no
   * file is a *missing* episode, so the next RSS sync or missing-episode
   * search would re-download precisely what the user just removed.
   *
   * An empty scope means every episode of the series - the same widening
   * `monitorScopedEpisodes` uses on the way in. `episodeIds` names several
   * episodes at once (a multi-episode file's siblings).
   *
   * `withoutFileOnly` narrows it further to episodes with no file - what a
   * cancelled download wants, since an episode that already has a file
   * (the cancel was of a replacement) should stay monitored for that copy.
   */
  async unmonitorScope(
    sonarrId: number,
    scope: UnmonitorScope,
    opts: { withoutFileOnly?: boolean } = {},
  ): Promise<number> {
    const episodes = await this.getEpisodes(sonarrId, {
      seasonNumber: scope.seasonNumber,
    })

    const named =
      scope.episodeIds ??
      (scope.episodeId != null ? [scope.episodeId] : undefined)

    // An episode still named only by number (a request whose id isn't
    // resolved yet) is that one episode, not its whole season.
    const inScope =
      named != null
        ? episodes.filter(
            episode => episode.id != null && named.includes(episode.id),
          )
        : scope.episodeNumber != null
          ? episodes.filter(
              episode => episode.episodeNumber === scope.episodeNumber,
            )
          : episodes

    // `!== false`, mirroring `monitorScopedEpisodes`'s `!== true`: already
    // unmonitored episodes are skipped so the returned count is what this
    // call actually changed, not just what the scope covered.
    const episodeIds = inScope
      .filter(episode => episode.id != null && episode.monitored !== false)
      .filter(episode => !opts.withoutFileOnly || episode.hasFile !== true)
      .map(episode => episode.id as number)

    // `setEpisodesMonitored` already no-ops on an empty list, so a scope
    // that matched nothing costs no round trip.
    await this.setEpisodesMonitored(episodeIds, false)

    return episodeIds.length
  }

  /**
   * Asks Sonarr to re-read its download client now rather than on its own
   * once-a-minute schedule. Its queue endpoint serves a cache that only that
   * task updates, so without this the poller reads the same stale snapshot
   * for up to a minute however often it asks.
   *
   * Queued, not awaited: Sonarr runs it in the background (~20ms of work,
   * done well inside a poll tick), so the refresh lands in time for the next
   * read. Sonarr de-duplicates an identical queued command, so a slow run
   * never piles them up.
   */
  async refreshMonitoredDownloads(): Promise<void> {
    const command: CommandResourceWritable = {
      name: 'RefreshMonitoredDownloads',
    }

    checkSdkError(
      await postApiV3Command({ client: this.client, body: command }),
      'refreshMonitoredDownloads',
    )
  }

  /**
   * Fetches the whole current Sonarr queue, optionally scoped to specific
   * series IDs, reading page after page until every record is in. Used by
   * MediaPollerService (no filter -> all tracked jobs matched client-side)
   * and by unmonitorAndDelete (filtered to one series).
   *
   * Records come back raw - `errorMessage` (absent when the client gave no
   * reason) and `episodeHasFile` included. Two kinds of row are kept on
   * purpose:
   *
   * - On the unfiltered read only, `includeUnknownSeriesItems: true` keeps
   *   rows Sonarr could not match to a series (`seriesId` absent) -
   *   downloads nobody's job owns, but still downloads. A read filtered to
   *   `seriesIds` leaves the flag off, so a per-series caller never sees (or
   *   cancels) a row that belongs to no series.
   * - Rows in `delay`, `downloadClientUnavailable` or `fallback` have no
   *   `downloadId` yet; they are real queue rows all the same.
   */
  async getQueue(seriesIds?: number[]): Promise<QueueResource[]> {
    return this.readAllPages(
      page =>
        getApiV3Queue({
          client: this.client,
          query: {
            includeEpisode: false,
            includeSeries: false,
            page,
            pageSize: PAGE_SIZE,
            ...(seriesIds && seriesIds.length > 0
              ? { seriesIds }
              : { includeUnknownSeriesItems: true }),
          },
        }),
      'getQueue',
    )
  }

  /**
   * Cancels any in-progress downloads for the series, then unmonitors and
   * deletes it. Mirrors apps/tdr-bot/src/media/services/sonarr.service.ts's
   * series-equivalent delete operation order (cancel queue items, then
   * delete) without the retry/granular-unmonitoring apparatus.
   */
  async unmonitorAndDelete(
    sonarrId: number,
    deleteFiles = true,
  ): Promise<void> {
    const queueItems = await this.getQueue([sonarrId])

    const cancellations = await Promise.allSettled(
      queueItems
        .filter(item => item.id != null)
        .map(item =>
          deleteApiV3QueueById({
            client: this.client,
            path: { id: item.id as number },
            query: { removeFromClient: true },
          }),
        ),
    )

    for (const result of cancellations) {
      if (result.status === 'rejected') {
        this.logger.warn(
          { sonarrId, error: String(result.reason) },
          'Failed to cancel an in-progress queue item before deleting series',
        )
      }
    }

    checkSdkError(
      await deleteApiV3SeriesById({
        client: this.client,
        path: { id: sonarrId },
        query: { deleteFiles, addImportListExclusion: false },
      }),
      'deleteSeries',
    )
  }

  /**
   * The candidates Sonarr would offer in its own manual-import dialog for a
   * finished download it refused to import: the files it found in the
   * download folder, each with whatever series, episodes and quality it
   * managed to parse, plus the rejections it recorded.
   *
   * Scoped by `downloadId` **only**. Sonarr v4 ignores `downloadId`
   * whenever `seriesId` is also sent (`ManualImportController.cs:28`) and
   * answers with the series' *library* files instead of the download's;
   * v5 lets `downloadId` win but then ignores `seasonNumber`. With
   * `downloadId` alone both versions list the download's own files, v4
   * resolving the series from the tracked download
   * (`ManualImportService.cs:257-264`). Narrowing to a series or season is
   * the caller's job, on the `series`/`seasonNumber`/`episodes` each
   * resource carries.
   *
   * `filterExistingFiles: true` is what Sonarr's own UI sends: files already
   * in the library are dropped rather than offered for a second import.
   *
   * Resources come back raw and unmapped, and nothing here filters them: an
   * empty `episodes` (a season pack Sonarr could not parse) is not an error
   * at this layer, and a rejection is informational - manual import builds a
   * fresh decision with no rejections per file, so even a `permanent` one
   * does not block the import. The caller decides what an empty list, an
   * empty `episodes` or a rejection means.
   */
  async getManualImportCandidates(
    downloadId: string,
  ): Promise<ManualImportResource[]> {
    return unwrapSdkResult(
      await getApiV3Manualimport({
        client: this.client,
        query: { downloadId, filterExistingFiles: true },
      }),
      'getManualImportCandidates',
    )
  }

  /**
   * Imports the chosen files - the button at the bottom of Sonarr's
   * manual-import dialog.
   *
   * The import is a **command**, not a call to the manualimport endpoint:
   * `postApiV3Manualimport` is the *reprocess* endpoint, which re-evaluates
   * candidates after the user edits a field and imports nothing at all, so it
   * is deliberately not used here.
   *
   * `importMode: 'auto'` lets Sonarr choose move-vs-copy from the download
   * client's own settings, which is what its UI sends.
   *
   * An empty list throws before anything reaches Sonarr: a ManualImport
   * command with no files would be accepted and quietly do nothing, so it is
   * a caller bug worth failing loudly on.
   */
  async commitManualImport(files: SonarrManualImportFile[]): Promise<void> {
    if (files.length === 0) {
      throw new Error('commitManualImport requires at least one file')
    }

    const command: ManualImportCommand = {
      files,
      importMode: 'auto',
      name: 'ManualImport',
    }

    checkSdkError(
      await postApiV3Command({ client: this.client, body: command }),
      'commitManualImport',
    )
  }

  /**
   * Drops a single queue row when the user *discards* a stuck download
   * instead of importing it - handing the download back rather than keeping
   * it. Not the tail of an import: Sonarr clears the row itself once a
   * ManualImport command succeeds.
   *
   * `removeFromClient: true` because giving the download back means the
   * download client drops its copy too. `blocklist: false` because the
   * release itself was fine - the folder name was the problem - and
   * blocklisting it would stop Sonarr picking the same release next time.
   * `skipRedownload: true` keeps Sonarr from immediately searching again on
   * the user's behalf.
   */
  async removeQueueItem(queueId: number): Promise<void> {
    checkSdkError(
      await deleteApiV3QueueById({
        client: this.client,
        path: { id: queueId },
        query: {
          blocklist: false,
          removeFromClient: true,
          skipRedownload: true,
        },
      }),
      'removeQueueItem',
    )
  }

  // - Quality tier profiles

  // - Tier -> id of its `lilnas · ` profile, filled by `ensureTierProfiles()`
  private readonly tierProfileIds = new Map<QualityTier, number>()
  private tierProfilesInFlight: Promise<void> | null = null

  /**
   * Plan 024. Creates or repairs the three `lilnas · <tier>` quality
   * profiles, matched by name: a missing one is created, a drifted one is
   * updated in place (see `planTierProfiles()`), and a profile without the
   * prefix is never touched. Idempotent; concurrent calls share one run.
   */
  async ensureTierProfiles(): Promise<void> {
    this.tierProfilesInFlight ??= this.reconcileTierProfiles().finally(() => {
      this.tierProfilesInFlight = null
    })
    return this.tierProfilesInFlight
  }

  /**
   * The id of `tier`'s profile. Served from the cache; a miss (boot's
   * `ensureTierProfiles()` failed, or hasn't run yet) runs it first.
   *
   * Rejects - naming the profile - when that run fails (see
   * `RadarrService.tierProfileId()`).
   */
  async tierProfileId(tier: QualityTier): Promise<number> {
    const cached = this.tierProfileIds.get(tier)
    if (cached != null) return cached

    try {
      await this.ensureTierProfiles()
    } catch (error) {
      throw new Error(
        `Could not set up Sonarr's "${tierProfileName(tier)}" quality profile: ${getErrorMessage(error)}`,
      )
    }
    const id = this.tierProfileIds.get(tier)
    if (id == null) {
      throw new Error(`Sonarr has no "${tierProfileName(tier)}" profile`)
    }
    return id
  }

  /**
   * The tier a quality profile id stands for, from the cache - `null` for a
   * profile that isn't one of ours, or before the cache is filled.
   */
  tierForProfileId(id: number): QualityTier | null {
    for (const [tier, profileId] of this.tierProfileIds) {
      if (profileId === id) return tier
    }
    return null
  }

  // - One read-path attempt at filling the tier cache, kept once settled
  private tierCacheWarm: Promise<void> | null = null

  /**
   * `RadarrService.warmTierCache()`'s twin: a no-op once every tier is
   * cached, otherwise one shared, never-retried `ensureTierProfiles()` run
   * before a library read maps its series.
   */
  private async warmTierCache(): Promise<void> {
    if (this.tierProfileIds.size >= QUALITY_TIERS.length) return

    this.tierCacheWarm ??= this.ensureTierProfiles().catch((error: unknown) => {
      this.logger.warn(
        `Could not load the quality tier profiles; titles report no tier until they are: ${getErrorMessage(error)}`,
      )
    })
    await this.tierCacheWarm
  }

  /** `toShow()` with this service's tier cache behind `qualityTier`. */
  private readonly toShow = (series: SeriesResource): Show =>
    toShow(series, id => this.tierForProfileId(id))

  /** `toLookupShow()` with this service's tier cache behind `qualityTier`. */
  private readonly toLookupShow = (series: SeriesResource): Show =>
    toLookupShow(series, id => this.tierForProfileId(id))

  private async reconcileTierProfiles(): Promise<void> {
    const [profilesResult, schemaResult] = await Promise.all([
      getApiV3Qualityprofile({ client: this.client }),
      getApiV3QualityprofileSchema({ client: this.client }),
    ])
    const plans = planTierProfiles(
      'sonarr',
      unwrapSdkResult(profilesResult, 'getQualityProfiles'),
      unwrapSdkResult(schemaResult, 'getQualityProfileSchema'),
    )

    // - One at a time, caching each as it lands, so a failure part-way
    //   still leaves the tiers before it usable
    for (const plan of plans) {
      this.tierProfileIds.set(plan.tier, await this.applyTierProfilePlan(plan))
    }
  }

  private async applyTierProfilePlan(
    plan: TierProfilePlan<QualityProfileResource>,
  ): Promise<number> {
    const name = tierProfileName(plan.tier)

    switch (plan.action) {
      case 'keep':
        return plan.id

      case 'create': {
        const created = unwrapSdkResult(
          await postApiV3Qualityprofile({
            client: this.client,
            body: plan.profile,
          }),
          'createQualityProfile',
        )
        if (created.id == null) {
          throw new Error(
            `createQualityProfile returned "${name}" without an id`,
          )
        }
        this.logger.log(`Created quality profile "${name}" (${created.id})`)
        return created.id
      }

      case 'update':
        unwrapSdkResult(
          await putApiV3QualityprofileById({
            client: this.client,
            path: { id: String(plan.id) },
            body: plan.profile,
          }),
          'updateQualityProfile',
        )
        this.logger.log(
          `Repaired drifted quality profile "${name}" (${plan.id})`,
        )
        return plan.id
    }
  }

  // - Flagged release profile

  // - Titles already warned about as unmirrorable, so each is logged once
  private readonly reportedSkippedFlagTitles = new Set<string>()

  /**
   * Plan 024. Mirrors this app's flagged release titles (`bad_files`) into
   * the `lilnas · Flagged releases` release profile, so Sonarr's own RSS
   * sync and automatic searches reject them too. Created on the first flag,
   * updated only when the term set changes, deleted with the last flag (an
   * empty profile is invalid) - see `planFlaggedReleaseProfile()`. A
   * profile under any other name is never touched.
   *
   * Interactive grabs ignore release profiles, so this backs up - doesn't
   * replace - `ReleaseService`'s own refusal of a flagged release.
   */
  async syncFlaggedReleaseProfile(titles: string[]): Promise<void> {
    const { terms, skipped } = buildFlaggedTerms(titles)
    const unreported = skipped.filter(
      title => !this.reportedSkippedFlagTitles.has(title),
    )
    if (unreported.length > 0) {
      unreported.forEach(title => this.reportedSkippedFlagTitles.add(title))
      this.logger.warn(
        `Not mirroring ${unreported.length} flagged release title(s) into Sonarr: a "/" would make Sonarr read the term as a regex: ${unreported.join(', ')}`,
      )
    }

    const plan = planFlaggedReleaseProfile(
      unwrapSdkResult(
        await getApiV3Releaseprofile({ client: this.client }),
        'getReleaseProfiles',
      ),
      terms,
    )

    if (plan.create) {
      const created = unwrapSdkResult(
        await postApiV3Releaseprofile({
          client: this.client,
          body: plan.create,
        }),
        'createReleaseProfile',
      )
      this.logger.log(
        `Created release profile "${FLAGGED_RELEASE_PROFILE_NAME}" (${created.id}) with ${terms.length} term(s)`,
      )
    }

    if (plan.update) {
      unwrapSdkResult(
        await putApiV3ReleaseprofileById({
          client: this.client,
          path: { id: String(plan.update.id) },
          body: plan.update,
        }),
        'updateReleaseProfile',
      )
      this.logger.log(
        `Updated release profile "${FLAGGED_RELEASE_PROFILE_NAME}" (${plan.update.id}) to ${terms.length} term(s)`,
      )
    }

    for (const id of plan.deleteIds) {
      checkSdkError(
        await deleteApiV3ReleaseprofileById({
          client: this.client,
          path: { id },
        }),
        'deleteReleaseProfile',
      )
      this.logger.log(
        `Deleted release profile "${FLAGGED_RELEASE_PROFILE_NAME}" (${id})`,
      )
    }
  }

  /**
   * Posts a command and hands back the `CommandRef` to follow it by. Sonarr
   * answers with the command it queued - or, for a duplicate of one already
   * pending, that existing command.
   */
  private async postCommand(
    command: CommandResourceWritable,
    name: string,
    context: string,
  ): Promise<CommandRef> {
    const queued = unwrapSdkResult(
      await postApiV3Command({ client: this.client, body: command }),
      context,
    )

    return toCommandRef(queued, name)
  }

  /**
   * Reads a paged endpoint (1-based pages) to the end. Stops once
   * `totalRecords` are in, or on an empty page - the guard against a total
   * that shifts while the pages are being read.
   */
  private async readAllPages<T>(
    fetchPage: (page: number) => Promise<{
      data?: { records?: T[] | null; totalRecords?: number }
      error?: unknown
      response?: Response
    }>,
    context: string,
  ): Promise<T[]> {
    const all: T[] = []

    for (let page = 1; ; page++) {
      const paging = unwrapSdkResult(await fetchPage(page), context)
      const records = paging.records ?? []
      all.push(...records)

      if (records.length === 0 || all.length >= (paging.totalRecords ?? 0)) {
        return all
      }
    }
  }

  /**
   * Where an add goes. The root folder only - the quality profile is the
   * requested tier's (see `EnsureSeriesOptions.qualityProfileId`).
   */
  private async getDefaultConfiguration(): Promise<{
    rootFolderPath: string
  }> {
    const folders = unwrapSdkResult(
      await getApiV3Rootfolder({ client: this.client }),
      'getRootFolders',
    )

    const folder = folders.find(f => f.accessible) ?? folders[0]
    if (!folder || folder.path == null) {
      throw new Error('No accessible root folders available in Sonarr')
    }

    return { rootFolderPath: folder.path }
  }
}
