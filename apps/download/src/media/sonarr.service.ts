import type {
  CommandResourceWritable,
  EpisodeFileResource,
  EpisodeResource,
  QueueResource,
  ReleaseResource,
  SeasonResource,
  SeriesResource,
  SeriesResourceWritable,
} from '@lilnas/media/sonarr'
import {
  deleteApiV3EpisodefileById,
  deleteApiV3QueueById,
  deleteApiV3SeriesById,
  getApiV3Episode,
  getApiV3Episodefile,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3Release,
  getApiV3Rootfolder,
  getApiV3Series,
  getApiV3SeriesById,
  getApiV3SeriesLookup,
  postApiV3Command,
  postApiV3Release,
  postApiV3Series,
  putApiV3EpisodeMonitor,
  putApiV3SeriesById,
} from '@lilnas/media/sonarr'
import {
  DownloadType,
  type Episode,
  type Release,
  type Season,
  type Show,
} from '@lilnas/utils/download/types'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { mediaId } from 'src/db/media-id'
import type { SonarrMediaClient } from 'src/media/clients'
import { SONARR_CLIENT } from 'src/media/clients'
import { toCommonRelease } from 'src/media/release-mapper.util'
import { checkSdkError, unwrapSdkResult } from 'src/media/sdk-result.util'
import { generateTitleSlug } from 'src/media/title-slug.util'

/**
 * Sonarr's SeriesSearch command accepts seriesId but the generated SDK type
 * omits command-specific body parameters. We extend it locally so TypeScript
 * validates the extra field rather than silently ignoring it via a raw `as`.
 * (Mirrors apps/tdr-bot/src/media/services/sonarr.service.ts.)
 */
type SeriesSearchCommand = CommandResourceWritable & { seriesId?: number }

export interface RequestShowResult {
  overview?: string
  posterUrl?: string
  sonarrId: number
  title: string
}

/** Scopes `getReleases`/`getEpisodes` to part of a series. */
export interface SeriesScope {
  episodeId?: number
  seasonNumber?: number
}

export interface EnsureSeriesOptions {
  /**
   * When present, `ensureSeries` also walks the episodes this scope names
   * and monitors any that are off - an empty object means the whole series.
   *
   * Opt-in rather than always-on because only the release paths need it.
   * `requestShow` deliberately passes nothing: a user who has monitored just
   * season 3 of a show and then re-requests the show should not silently
   * have all ten seasons switched on.
   */
  monitorEpisodes?: SeriesScope
}

/**
 * What `ensureSeries()` hands back - `EnsureMovieResult` plus the episode
 * granularity Sonarr forces on us.
 *
 * Series-level `monitored` is **not enough** for Sonarr: a series added with
 * `monitor: 'none'` has a monitored series row and unmonitored episodes, and
 * Sonarr won't grab a release for an unmonitored episode. So the capture
 * carries `turnedOnEpisodeIds` - the episodes this call switched on, and
 * *only* those. A restore that unmonitored every episode in the season would
 * clobber ones the user had deliberately monitored themselves.
 */
export interface EnsureSeriesResult {
  series: SeriesResource
  sonarrId: number
  /** Episodes this call turned monitoring on for - the restore set. */
  turnedOnEpisodeIds: number[]
  wasMonitored: boolean
}

/**
 * Sonarr's half of the shared `Release` mapper - the common fields plus the
 * three Sonarr-only ones. Note `imdbId` is a *string* here where Radarr types
 * it as a number, which is one of the reasons the two generated
 * `ReleaseResource` types can't simply be unioned; the DTO reads neither.
 */
export function toRelease(resource: ReleaseResource): Release {
  return {
    ...toCommonRelease(resource),
    episodeNumbers: resource.episodeNumbers ?? undefined,
    fullSeason: resource.fullSeason,
    seasonNumber: resource.seasonNumber,
  }
}

/**
 * The single Sonarr -> `Media` mapper (plan §4.1/§4.2) - see
 * `radarr.service.ts`'s `toMovie()` for the shape of the collapse.
 * `SeriesResource.path` is the series folder (not a per-episode file,
 * unlike Radarr's `movieFile.path`) - Phase 4's episode work will need
 * `episodeFile` separately. Unlike Radarr's per-provider Ratings breakdown,
 * Sonarr's is already a single flat `{ votes, value }` pair.
 */
export function toShow(series: SeriesResource): Show {
  const posterUrl = series.images?.find(img => img.coverType === 'poster')?.url
  const releaseDate = series.firstAired ?? undefined
  const tvdbId = series.tvdbId ?? 0

  return {
    certification: series.certification ?? undefined,
    filePath: series.path ?? undefined,
    genres: series.genres ?? [],
    id: mediaId({ tvdbId, type: DownloadType.Show }),
    overview: series.overview ?? undefined,
    posterUrl: posterUrl ?? undefined,
    ratingValue: series.ratings?.value,
    releaseDate,
    // Sonarr reports minutes; `Media.runtime` is seconds (see MediaBaseSchema).
    runtime: series.runtime != null ? series.runtime * 60 : undefined,
    // Falsy-guarded rather than nullish-guarded: Sonarr returns `id: 0` for
    // a lookup result that isn't in the library (see toMovie()).
    sonarrId: series.id || undefined,
    title: series.title ?? 'Unknown title',
    tvdbId,
    type: DownloadType.Show,
    year: series.year,
  }
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
    airDate: resource.airDateUtc ?? undefined,
    // `episodeFileId: 0` is Sonarr's "no file" - truthiness, not a null
    // guard, and the key is omitted rather than carrying a meaningless 0.
    episodeFileId: resource.episodeFileId || undefined,
    episodeNumber: resource.episodeNumber,
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
 * The counts come from Sonarr's own `statistics` rather than from
 * `episodes.length`: the two can legitimately disagree (statistics counts
 * episodes Sonarr knows are coming), and Sonarr's number is the honest one.
 * They fall back to the episode list only when Sonarr sent no statistics at
 * all, which is what a freshly-added series looks like.
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
   */
  async search(query: string): Promise<Show[]> {
    const series = unwrapSdkResult(
      await getApiV3SeriesLookup({
        client: this.client,
        query: { term: query },
      }),
      'searchShows',
    )

    return series.map(toShow)
  }

  /**
   * The whole Sonarr library, mapped to `Media` - `MediaResolverService`'s
   * library cache is built from this (one call per TTL window rather than
   * one per job). Same underlying call as `requestShow()`'s existing
   * library-first lookup (`getApiV3Series`).
   */
  async getLibrary(): Promise<Show[]> {
    const series = unwrapSdkResult(
      await getApiV3Series({ client: this.client }),
      'getSeries',
    )

    return series.map(toShow)
  }

  /**
   * Per-id fallback for `MediaResolverService` when a tvdbId isn't in the
   * library cache - metadata-only, no `sonarrId`/`filePath` (this is the
   * *discover* lookup, not a library query, so a title requested but since
   * removed from Sonarr still resolves).
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

    return toShow(lookup)
  }

  /**
   * Gets the series into a state where Sonarr will actually surface and grab
   * releases for it - the Sonarr counterpart to `RadarrService.ensureMovie()`,
   * with one extra layer.
   *
   * Sonarr needs the *episodes* monitored, not just the series: a series
   * added with `monitor: 'none'` has `monitored: true` at the series level
   * and every episode off. So when `opts.monitorEpisodes` is given this also
   * walks the episodes that scope names, turns on the ones that are off, and
   * reports exactly those back as `turnedOnEpisodeIds` for the caller to
   * restore.
   *
   * A fresh add needs no episode pass at all - `addOptions.monitor: 'all'`
   * already monitors everything, so `turnedOnEpisodeIds` is empty and a
   * restore correctly unmonitors nothing (the series-level flip is what gets
   * undone in that case).
   */
  async ensureSeries(
    tvdbId: number,
    opts: EnsureSeriesOptions = {},
  ): Promise<EnsureSeriesResult> {
    const existingSeries = unwrapSdkResult(
      await getApiV3Series({ client: this.client }),
      'getSeries',
    )

    const existing = existingSeries.find(s => s.tvdbId === tvdbId)

    if (existing) {
      if (existing.id == null) {
        throw new Error(
          `Sonarr did not return an id for series tvdbId=${tvdbId}`,
        )
      }

      const wasMonitored = existing.monitored === true
      if (!wasMonitored) {
        await this.setSeriesMonitored(existing.id, true)
      }

      const turnedOnEpisodeIds = opts.monitorEpisodes
        ? await this.monitorScopedEpisodes(existing.id, opts.monitorEpisodes)
        : []

      return {
        series: existing,
        sonarrId: existing.id,
        turnedOnEpisodeIds,
        wasMonitored,
      }
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

    const { qualityProfileId, rootFolderPath } =
      await this.getDefaultConfiguration()

    const title = lookup.title ?? `Show ${tvdbId}`

    const added = unwrapSdkResult(
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
          monitored: true,
          seasonFolder: true,
          useSceneNumbering: false,
          seriesType: 'standard',
          addOptions: {
            monitor: 'all',
            // Both `false`, where the pre-extraction `requestShow` set them
            // `true`. The search moved to the explicit `SeriesSearch`
            // command `requestShow` was *already* sending afterwards, so a
            // request still searches exactly once - but `ReleaseService`,
            // which adds a series only so it can list its releases, no
            // longer kicks off a series-wide grab as a side effect of
            // browsing. Mirrors Radarr's `searchForMovie: false` + command.
            searchForMissingEpisodes: false,
            searchForCutoffUnmetEpisodes: false,
          },
        } as unknown as SeriesResourceWritable,
      }),
      'addSeries',
    )

    if (added.id == null) {
      throw new Error(`Sonarr did not return an id for series tvdbId=${tvdbId}`)
    }

    return {
      series: added,
      sonarrId: added.id,
      // `monitor: 'all'` already covered every episode, so this call turned
      // nothing on individually and there is nothing episode-level to undo.
      turnedOnEpisodeIds: [],
      wasMonitored: false,
    }
  }

  /**
   * Monitors whichever episodes the scope names and aren't already on,
   * returning just the ids this call changed. An unscoped call (no season,
   * no episode) covers the whole series, matching what a season-agnostic
   * release listing actually searches.
   */
  private async monitorScopedEpisodes(
    sonarrId: number,
    scope: SeriesScope,
  ): Promise<number[]> {
    const episodes = await this.getEpisodes(sonarrId, {
      seasonNumber: scope.seasonNumber,
    })

    const inScope =
      scope.episodeId != null
        ? episodes.filter(episode => episode.id === scope.episodeId)
        : episodes

    const toTurnOn = inScope
      .filter(episode => episode.id != null && episode.monitored !== true)
      .map(episode => episode.id as number)

    if (toTurnOn.length > 0) {
      await this.setEpisodesMonitored(toTurnOn, true)
    }

    return toTurnOn
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
   * Sonarr would accept the call, but the round trip buys nothing and the
   * restore path hits this with an empty list whenever it had nothing to
   * turn on.
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
   * The series must be in the library with the target episodes monitored
   * first (see `ensureSeries()`), otherwise Sonarr has nothing to search for.
   */
  async getReleases(
    sonarrId: number,
    scope: SeriesScope = {},
  ): Promise<Release[]> {
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

    return releases.map(toRelease)
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
   * Adds (if needed) and triggers a search for a series by TVDB ID.
   * Simplified relative to tdr-bot's monitorAndDownloadSeries: no
   * retry/circuit-breaker wrapper and no granular per-season/episode
   * selection - the whole series is monitored and searched.
   *
   * Now literally `ensureSeries()` + the search command, the same shape
   * `requestMovie` has.
   */
  async requestShow(tvdbId: number): Promise<RequestShowResult> {
    const { series, sonarrId } = await this.ensureSeries(tvdbId)

    await this.triggerSearch(sonarrId)

    const posterUrl = series.images?.find(
      img => img.coverType === 'poster',
    )?.remoteUrl

    return {
      overview: series.overview ?? undefined,
      posterUrl: posterUrl ?? undefined,
      sonarrId,
      title: series.title ?? `Show ${tvdbId}`,
    }
  }

  /**
   * Sonarr's generic "go find something for this series" command - the
   * unflagged auto-select path. When a title *does* have flagged releases,
   * `MediaDownloadService` fetches and picks itself instead, because this
   * command gives the app no say in what Sonarr grabs.
   */
  async triggerSearch(sonarrId: number): Promise<void> {
    const command: SeriesSearchCommand = {
      name: 'SeriesSearch',
      seriesId: sonarrId,
    }

    checkSdkError(
      await postApiV3Command({ client: this.client, body: command }),
      'triggerSeriesSearch',
    )
  }

  /**
   * Fetches the current Sonarr queue, optionally scoped to specific series
   * IDs. Used by MediaPollerService (no filter -> all tracked jobs matched
   * client-side) and by unmonitorAndDelete (filtered to one series).
   */
  async getQueue(seriesIds?: number[]): Promise<QueueResource[]> {
    const paging = unwrapSdkResult(
      await getApiV3Queue({
        client: this.client,
        query: {
          includeEpisode: false,
          includeSeries: false,
          pageSize: 1000,
          ...(seriesIds && seriesIds.length > 0 ? { seriesIds } : {}),
        },
      }),
      'getQueue',
    )

    return paging.records ?? []
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

  private async getDefaultConfiguration(): Promise<{
    qualityProfileId: number
    rootFolderPath: string
  }> {
    const [profiles, folders] = await Promise.all([
      unwrapSdkResult(
        await getApiV3Qualityprofile({ client: this.client }),
        'getQualityProfiles',
      ),
      unwrapSdkResult(
        await getApiV3Rootfolder({ client: this.client }),
        'getRootFolders',
      ),
    ])

    const profile =
      profiles.find(p => (p.name ?? '').toLowerCase().includes('any')) ??
      profiles[0]
    if (!profile || profile.id == null) {
      throw new Error('No quality profiles available in Sonarr')
    }

    const folder = folders.find(f => f.accessible) ?? folders[0]
    if (!folder || folder.path == null) {
      throw new Error('No accessible root folders available in Sonarr')
    }

    return { qualityProfileId: profile.id, rootFolderPath: folder.path }
  }
}
