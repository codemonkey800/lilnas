import {
  DownloadType,
  type Media,
  type Movie,
  type Show,
  type Video,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'

import { DbService } from 'src/db/db.service'
import { mediaId, mediaIdSuffix, mediaTypeFromKey } from 'src/db/media-id'
import type { VideoRow } from 'src/db/schema'
import { getVideosByIds } from 'src/db/videos.repo'
import { EmbyStatusService } from 'src/emby/emby-status.service'

import { MediaStateService } from './media-state.service'
import { RadarrService } from './radarr.service'
import { SonarrService } from './sonarr.service'

export interface MediaKey {
  mediaId: string
  type: DownloadType
}

export interface MediaResolverResult {
  degradedSources: DownloadType[]
  media: Map<string, Media>
}

/**
 * One title the library holds a file for, with when that file landed. The
 * `media` is the library cache's own object - read it, never mutate it - and
 * is **not** annotated for this read: it can still carry an Emby status or a
 * state from an earlier `resolve()`, which are stale by definition. A caller
 * that renders it resolves the page it needs first.
 */
export interface LibraryEntry {
  addedAt: Date
  media: Movie | Show
}

export interface LibraryListing {
  /** Sources whose library couldn't be read; their titles are omitted. */
  degradedSources: DownloadType[]
  entries: LibraryEntry[]
}

interface LibraryCacheEntry<T> {
  entries: Map<number, T>
  expiresAtMs: number
  /** A failed fetch's empty stand-in, cached for `FAILURE_TTL_MS`. */
  failed: boolean
}

interface LibraryCache<T> {
  current?: LibraryCacheEntry<T>
  /** Bumped by every `invalidate()`; see `readLibrary`. */
  epoch: number
  /**
   * Media id -> `libraryFingerprint()` of every title the last good read
   * held, patched by `refreshTitles()`. What a new read is diffed against to
   * tell which titles changed upstream (see `onLibraryChange`). Unset until
   * the first good read, which has nothing to diff against.
   */
  known?: Map<string, string>
}

/** Called with the media ids whose library entry changed upstream. */
export type LibraryChangeListener = (mediaIds: readonly string[]) => void

/**
 * The library fields a page's state is derived from - whether the title is
 * in the library at all, its monitoring, and its file(s). A change in any of
 * them is what `onLibraryChange` reports; metadata (title, poster, ratings)
 * moving is not.
 */
function libraryFingerprint(media: Movie | Show): string {
  return media.type === DownloadType.Movie
    ? JSON.stringify([
        media.radarrId,
        media.monitored,
        media.filePath,
        media.addedAt,
      ])
    : JSON.stringify([
        media.sonarrId,
        media.monitored,
        media.episodeCount,
        media.episodeFileCount,
      ])
}

function hydrateVideo(row: VideoRow): Video {
  const hasFile = (row.downloadUrls?.length ?? 0) > 0

  return {
    // `updated_at` is the row's last write, and setting `download_urls` is
    // the pipeline's final one - so for a finished video it stands in for
    // "the file landed". A row with no file has no such moment, and its
    // bumps from title/metadata writes must not read as one.
    addedAt: hasFile ? row.updatedAt.toISOString() : undefined,
    downloadUrls: row.downloadUrls ?? undefined,
    id: mediaId({ id: row.id, type: DownloadType.Video }),
    overview: row.overview ?? undefined,
    posterUrl: row.posterUrl ?? undefined,
    runtime: row.runtime ?? undefined,
    sourceUrl: row.sourceUrl,
    timeRange: row.timeRange ?? undefined,
    title: row.title,
    type: DownloadType.Video,
  }
}

/**
 * `(type, mediaId)[] -> Media[]` - the single place a key becomes a `Media`
 * (plan §4.1). Everything that renders a job or a gallery card goes through
 * here, so there is exactly one place that knows how a key becomes a media.
 *
 * A `video:` key resolves via one `videos` query; a `tmdb:`/`tvdb:` key via
 * a whole-library cache
 * (`RadarrService.getLibrary()`/`SonarrService.getLibrary()`, 60s success /
 * 10s failure TTL, mirroring `AdminCheckService`) with a per-id fallback on a
 * cache miss. An upstream throw never propagates - a placeholder `Media`
 * (`{ id, title: id, type }`) is returned instead, with the source flagged in
 * `degradedSources`, so a list endpoint degrades rather than 500s.
 *
 * Every resolved movie/show that has a file on disk is then annotated with
 * its Emby state (`EmbyStatusService.annotate()`), so a caller never has to
 * ask a second service where to watch something - and then every resolved
 * media, placeholders included, is annotated with its live state
 * (`MediaStateService.annotate()`, plan 021), so nothing the API serves is
 * missing one.
 *
 * Every library read is also diffed against the last one, and the titles
 * whose library state moved are reported to `onLibraryChange` - how a change
 * made in Radarr's/Sonarr's own UI reaches open pages (`LibraryWatchService`).
 */
@Injectable()
export class MediaResolverService {
  private static readonly TTL_MS = 60_000
  private static readonly FAILURE_TTL_MS = 10_000

  private readonly logger = new Logger(MediaResolverService.name)
  private readonly movieLibrary: LibraryCache<Movie> = { epoch: 0 }
  private readonly showLibrary: LibraryCache<Show> = { epoch: 0 }
  private readonly changeListeners = new Set<LibraryChangeListener>()

  constructor(
    private readonly dbService: DbService,
    private readonly embyStatusService: EmbyStatusService,
    private readonly mediaStateService: MediaStateService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  async resolve(keys: readonly MediaKey[]): Promise<MediaResolverResult> {
    const media = new Map<string, Media>()
    const degradedSources = new Set<DownloadType>()

    const videoKeys = keys.filter(key => key.type === DownloadType.Video)
    const movieKeys = keys.filter(key => key.type === DownloadType.Movie)
    const showKeys = keys.filter(key => key.type === DownloadType.Show)

    if (videoKeys.length > 0) {
      this.resolveVideos(videoKeys, media)
    }

    await Promise.all([
      movieKeys.length > 0
        ? this.resolveMovies(movieKeys, media, degradedSources)
        : undefined,
      showKeys.length > 0
        ? this.resolveShows(showKeys, media, degradedSources)
        : undefined,
    ])

    // Called unconditionally, including for a video-only or empty result:
    // "is this batch worth an Emby round trip" is EmbyStatusService's own
    // decision (it returns before any HTTP call when nothing has a
    // filePath), and duplicating that test here would be a second place to
    // keep in sync. One batched call per resolve() - never a per-key one -
    // is the whole integration; resolve() runs on a 10s cron, and the 60s
    // path-index TTL inside EmbyStatusService is what bounds Emby load.
    //
    // Emby state is deliberately NOT reflected in degradedSources: Emby
    // isn't a DownloadType, and a per-title `unknown` already carries the
    // degradation signal at the only granularity a caller can act on.
    try {
      await this.embyStatusService.annotate(media.values())
    } catch (err) {
      // annotate() is documented never to throw, so this is a guard against
      // a future regression in it rather than a live path. resolve() backs
      // every list endpoint and the poller, so a broken Emby annotation must
      // cost a badge, not the whole payload - which is already resolved and
      // correct by this point.
      this.logger.warn(
        { action: 'resolve', error: getErrorMessage(err) },
        'Emby annotation threw - returning media without Emby status',
      )
    }

    // Plan 021: every media the API serves carries a state. Synchronous and
    // memory-only (the poller feeds it the queues), so it needs no guard. The
    // two annotators write disjoint fields - Emby never touches `state`,
    // this never touches `embyStatus` - so their order is not load-bearing.
    this.mediaStateService.annotate(media.values())

    return { degradedSources: [...degradedSources], media }
  }

  private resolveVideos(
    keys: readonly MediaKey[],
    media: Map<string, Media>,
  ): void {
    const ids = keys.map(key => mediaIdSuffix(key.mediaId))
    const rows = getVideosByIds(this.dbService.db, ids)

    for (const row of rows) {
      media.set(
        mediaId({ id: row.id, type: DownloadType.Video }),
        hydrateVideo(row),
      )
    }

    // `jobs.media_id` has no foreign key (it points at `videos` for a third
    // of rows and at TMDB/TVDB for the rest, and SQLite FKs can't be
    // conditional), so a dangling `video:` key is structurally possible even
    // though `ensureVideo()` is the only writer of either table. Emitting a
    // placeholder rather than a gap means `resolve()` always answers for
    // every key it was given, and a list endpoint degrades one card instead
    // of failing the page. `/media/:id` still 404s a missing video - it
    // checks the row directly rather than going through this path.
    for (const key of keys) {
      if (media.has(key.mediaId)) continue

      this.logger.warn(
        { action: 'resolveVideos', mediaId: key.mediaId },
        'No videos row for media id - returning a placeholder',
      )
      media.set(key.mediaId, {
        id: key.mediaId,
        sourceUrl: '',
        title: key.mediaId,
        type: DownloadType.Video,
      })
    }
  }

  private async resolveMovies(
    keys: readonly MediaKey[],
    media: Map<string, Media>,
    degradedSources: Set<DownloadType>,
  ): Promise<void> {
    let library: Map<number, Movie>
    try {
      library = await this.getMovieLibrary()
    } catch (err) {
      this.logger.warn(
        { action: 'resolveMovies', error: getErrorMessage(err) },
        'Radarr library lookup failed - falling back to per-id lookups',
      )
      degradedSources.add(DownloadType.Movie)
      library = new Map()
    }

    await Promise.all(
      keys.map(async key => {
        const tmdbId = Number(mediaIdSuffix(key.mediaId))
        const cached = library.get(tmdbId)
        if (cached) {
          media.set(key.mediaId, cached)
          return
        }

        try {
          media.set(
            key.mediaId,
            await this.radarrService.lookupByTmdbId(tmdbId),
          )
        } catch (err) {
          this.logger.warn(
            {
              action: 'resolveMovies',
              error: getErrorMessage(err),
              tmdbId,
            },
            'Radarr per-id lookup failed - returning a placeholder',
          )
          degradedSources.add(DownloadType.Movie)
          media.set(key.mediaId, {
            id: key.mediaId,
            title: key.mediaId,
            tmdbId,
            type: DownloadType.Movie,
          })
        }
      }),
    )
  }

  private async resolveShows(
    keys: readonly MediaKey[],
    media: Map<string, Media>,
    degradedSources: Set<DownloadType>,
  ): Promise<void> {
    let library: Map<number, Show>
    try {
      library = await this.getShowLibrary()
    } catch (err) {
      this.logger.warn(
        { action: 'resolveShows', error: getErrorMessage(err) },
        'Sonarr library lookup failed - falling back to per-id lookups',
      )
      degradedSources.add(DownloadType.Show)
      library = new Map()
    }

    await Promise.all(
      keys.map(async key => {
        const tvdbId = Number(mediaIdSuffix(key.mediaId))
        const cached = library.get(tvdbId)
        if (cached) {
          media.set(key.mediaId, cached)
          return
        }

        try {
          media.set(
            key.mediaId,
            await this.sonarrService.lookupByTvdbId(tvdbId),
          )
        } catch (err) {
          this.logger.warn(
            {
              action: 'resolveShows',
              error: getErrorMessage(err),
              tvdbId,
            },
            'Sonarr per-id lookup failed - returning a placeholder',
          )
          degradedSources.add(DownloadType.Show)
          media.set(key.mediaId, {
            id: key.mediaId,
            title: key.mediaId,
            tvdbId,
            type: DownloadType.Show,
          })
        }
      }),
    )
  }

  /**
   * Makes the next read of the library cache that holds `key` go back
   * upstream for the **whole** library. Called after a change to that title
   * which the app itself made or observed - a file deleted, replaced,
   * imported, or a download settling on its file - where waiting out the TTL
   * would serve a copy the app already knows is wrong. Normal staleness is
   * still bounded by the TTL alone.
   *
   * The whole library, not just `key`'s entry: `resolve()` reads a key
   * missing from a live cache as "not in the library" and answers it with the
   * per-id *discover* lookup, which has no `radarrId`/`sonarrId`, no
   * `monitored` and no file - so a title evicted on its own would resolve as
   * `absent` until the TTL ran out, the opposite of a fresh read. Every
   * caller changes a title that stays in the library, so one list read is
   * what "fresh" costs. A read already in flight when this is called is
   * returned to its own caller but not cached (see `readLibrary`), so it
   * can't put the pre-change copy back.
   */
  invalidate(key: string): void {
    const type = mediaTypeFromKey(key)
    if (type === DownloadType.Movie || type === DownloadType.Show) {
      this.invalidateLibrary(type)
    }
  }

  /**
   * `invalidate()` by media type, for a caller that knows which library is
   * stale but not the media id - `MediaPollerService`, holding a queue item
   * whose Radarr/Sonarr id the cached library doesn't have yet.
   */
  invalidateLibrary(type: DownloadType.Movie | DownloadType.Show): void {
    const cache =
      type === DownloadType.Movie ? this.movieLibrary : this.showLibrary

    cache.current = undefined
    cache.epoch += 1
  }

  /**
   * `invalidate(key)` after an `ensureMovie`/`ensureSeries` that changed the
   * library entry - added the title, or turned its monitoring on - and that
   * the caller keeps (a request or a grab, not a restored release listing).
   *
   * An added title is missing from a cache filled before the add, so until
   * the TTL ran out it would resolve from the discover lookup: no
   * `radarrId`/`sonarrId`, which leaves its job untrackable by the poller,
   * and `absent` on its page. A monitoring flip is the same staleness in
   * `monitored`. An ensure that changed nothing leaves the cache alone.
   */
  invalidateAfterEnsure(
    key: string,
    { wasAdded, wasMonitored }: { wasAdded: boolean; wasMonitored: boolean },
  ): void {
    if (wasAdded || !wasMonitored) this.invalidate(key)
  }

  /**
   * The cached Radarr library, keyed by `tmdbId`. Public for
   * `MediaPollerService`, which has only a queue item's Radarr `movieId` and
   * needs the media id it belongs to - read through this cache rather than
   * a `getLibrary()` of its own, so it costs upstream nothing extra. The map
   * is the cache itself: read it, never mutate it. Throws when a fetch
   * fails, and returns an empty map for `FAILURE_TTL_MS` after that.
   */
  async getMovieLibrary(): Promise<Map<number, Movie>> {
    return this.readLibrary(this.movieLibrary, () => this.fetchMovieLibrary())
  }

  /** `getMovieLibrary()`'s Sonarr twin, keyed by `tvdbId`. */
  async getShowLibrary(): Promise<Map<number, Show>> {
    return this.readLibrary(this.showLibrary, () => this.fetchShowLibrary())
  }

  /**
   * Re-reads one whole library from upstream whatever the cache's age, for
   * `LibraryWatchService`'s background lane. Unlike `invalidateLibrary()`
   * the current copy keeps serving while the read is in flight, so a page
   * load never waits on it. Throws when the read fails.
   */
  async refreshLibrary(
    type: DownloadType.Movie | DownloadType.Show,
  ): Promise<void> {
    if (type === DownloadType.Movie) {
      await this.readLibrary(
        this.movieLibrary,
        () => this.fetchMovieLibrary(),
        { force: true },
      )
    } else {
      await this.readLibrary(this.showLibrary, () => this.fetchShowLibrary(), {
        force: true,
      })
    }
  }

  /**
   * Re-reads just these titles' library entries from upstream - one small
   * call each, rather than the whole library - and patches any that changed
   * into the cache, reporting them to `onLibraryChange`. For
   * `LibraryWatchService`'s fast lane, which runs this every second for the
   * titles open on a detail page.
   *
   * A title Radarr/Sonarr no longer holds is dropped from the cache, so it
   * resolves through the discover lookup as `absent` - exactly what a full
   * read would have made of it.
   *
   * Does nothing for a library with no good read yet (nothing to compare
   * against; the first read sets that), and drops a batch that a full read
   * or an `invalidate()` overtook while it was in flight - the newer read
   * already carries anything this one would have found. A title whose read
   * fails is left alone until the next call. Never throws.
   */
  async refreshTitles(mediaIds: readonly string[]): Promise<void> {
    const movieIds = mediaIds.filter(
      id => mediaTypeFromKey(id) === DownloadType.Movie,
    )
    const showIds = mediaIds.filter(
      id => mediaTypeFromKey(id) === DownloadType.Show,
    )

    await Promise.all([
      movieIds.length > 0
        ? this.refreshEntries(this.movieLibrary, movieIds, tmdbId =>
            this.radarrService.getLibraryMovie(tmdbId),
          )
        : undefined,
      showIds.length > 0
        ? this.refreshEntries(this.showLibrary, showIds, tvdbId =>
            this.sonarrService.getLibraryShow(tvdbId),
          )
        : undefined,
    ])
  }

  /**
   * Registers `listener` for every title whose library entry changed
   * upstream, as seen by any read: the per-TTL read-through, a re-read after
   * `invalidate()`, `refreshLibrary()` or `refreshTitles()`. Each change is
   * reported by the read that first saw it, so a page load's read-through
   * can't swallow one before `LibraryWatchService` looks. Returns the
   * unsubscribe.
   */
  onLibraryChange(listener: LibraryChangeListener): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  /**
   * Every title the Radarr/Sonarr libraries hold a file for, from the same
   * caches `resolve()` reads - so listing costs upstream nothing extra within
   * the TTL. Unordered and unannotated (see `LibraryEntry`).
   *
   * The file signal is per type: a movie's `filePath`, and a show's
   * `episodeFileCount > 0` - **never** a show's `filePath`, which is the
   * series folder and is set for every library series, files or not.
   * `addedAt` is what the mappers already put on each: the movie file's
   * `dateAdded`, and the series' `added`.
   *
   * A source that can't be read is omitted and named in `degradedSources`,
   * never thrown - a list endpoint degrades to the other type rather than
   * 500ing, as with `resolve()`.
   */
  async listLibrary(): Promise<LibraryListing> {
    const degradedSources: DownloadType[] = []
    const [movies, shows] = await Promise.all([
      this.listSource(DownloadType.Movie, this.movieLibrary, () =>
        this.getMovieLibrary(),
      ),
      this.listSource(DownloadType.Show, this.showLibrary, () =>
        this.getShowLibrary(),
      ),
    ])

    const candidates: Array<Movie | Show> = []
    if (movies) {
      candidates.push(...movies.filter(movie => movie.filePath))
    } else {
      degradedSources.push(DownloadType.Movie)
    }
    if (shows) {
      candidates.push(...shows.filter(show => (show.episodeFileCount ?? 0) > 0))
    } else {
      degradedSources.push(DownloadType.Show)
    }

    const entries: LibraryEntry[] = []
    for (const media of candidates) {
      // The mappers set `addedAt` wherever the file signal above holds (both
      // come off the same `movieFile`, and every library series has an
      // `added`), so a miss here is malformed upstream data. Skipped rather
      // than dated "now" or the epoch - either would be an invented sort
      // position - and logged, since it hides a title that has a file.
      const addedAt = media.addedAt ? new Date(media.addedAt) : undefined
      if (!addedAt || Number.isNaN(addedAt.getTime())) {
        this.logger.warn(
          { action: 'listLibrary', mediaId: media.id },
          'Library title with a file has no addedAt - leaving it out',
        )
        continue
      }
      entries.push({ addedAt, media })
    }

    return { degradedSources, entries }
  }

  /**
   * One library's titles for `listLibrary()`, or `undefined` when the source
   * is degraded - on a failed fetch, and for the `FAILURE_TTL_MS` after one,
   * when the read returns the failure's empty stand-in rather than throwing.
   * That stand-in is told apart by identity, not emptiness, since an empty
   * library is a real answer.
   */
  private async listSource<T>(
    type: DownloadType,
    cache: LibraryCache<T>,
    read: () => Promise<Map<number, T>>,
  ): Promise<T[] | undefined> {
    try {
      const entries = await read()
      if (cache.current?.failed && cache.current.entries === entries) {
        return undefined
      }
      return [...entries.values()]
    } catch (err) {
      this.logger.warn(
        { action: 'listLibrary', error: getErrorMessage(err), type },
        'Library read failed - omitting that source from the listing',
      )
      return undefined
    }
  }

  private async fetchMovieLibrary(): Promise<Map<number, Movie>> {
    const movies = await this.radarrService.getLibrary()
    return new Map(movies.map(movie => [movie.tmdbId, movie]))
  }

  private async fetchShowLibrary(): Promise<Map<number, Show>> {
    const series = await this.sonarrService.getLibrary()
    return new Map(series.map(show => [show.tvdbId, show]))
  }

  /**
   * One library cache's read-through. A fetch stores its result only if no
   * `invalidate()` landed while it was in flight - otherwise a read that
   * started before the change would re-cache the copy the invalidation was
   * there to drop, for a whole TTL. `force` skips the cache hit, for
   * `refreshLibrary()`.
   */
  private async readLibrary<T extends Movie | Show>(
    cache: LibraryCache<T>,
    fetch: () => Promise<Map<number, T>>,
    { force = false }: { force?: boolean } = {},
  ): Promise<Map<number, T>> {
    const now = Date.now()
    if (!force && cache.current && cache.current.expiresAtMs > now) {
      return cache.current.entries
    }

    const epoch = cache.epoch
    try {
      const entries = await fetch()
      if (cache.epoch === epoch) {
        cache.current = {
          entries,
          expiresAtMs: now + MediaResolverService.TTL_MS,
          failed: false,
        }
        this.recordLibrary(cache, entries)
      }
      return entries
    } catch (err) {
      if (cache.epoch === epoch) {
        cache.current = {
          entries: new Map(),
          expiresAtMs: now + MediaResolverService.FAILURE_TTL_MS,
          failed: true,
        }
      }
      throw err
    }
  }

  /**
   * Diffs a good read against the previous one (`known`) and reports every
   * title that was added, removed or changed. The first read only sets the
   * baseline - on a fresh boot every title would otherwise read as added.
   */
  private recordLibrary<T extends Movie | Show>(
    cache: LibraryCache<T>,
    entries: ReadonlyMap<number, T>,
  ): void {
    const next = new Map<string, string>()
    for (const media of entries.values()) {
      next.set(media.id, libraryFingerprint(media))
    }

    const previous = cache.known
    cache.known = next
    if (!previous) return

    const changed: string[] = []
    for (const [id, fingerprint] of next) {
      if (previous.get(id) !== fingerprint) changed.push(id)
    }
    for (const id of previous.keys()) {
      if (!next.has(id)) changed.push(id)
    }
    this.emitLibraryChange(changed)
  }

  /**
   * `refreshTitles()` for one library. The patch is copy-on-write - a caller
   * may be iterating the map `getMovieLibrary()` handed it - and bumps the
   * epoch, so a whole-library read already in flight (started before these
   * changes) can't cache the older copy over them.
   */
  private async refreshEntries<T extends Movie | Show>(
    cache: LibraryCache<T>,
    mediaIds: readonly string[],
    fetch: (upstreamKey: number) => Promise<T | undefined>,
  ): Promise<void> {
    const known = cache.known
    if (!known) return
    const epoch = cache.epoch

    const results = await Promise.all(
      mediaIds.map(async mediaId => {
        const upstreamKey = Number(mediaIdSuffix(mediaId))
        try {
          return { entry: await fetch(upstreamKey), mediaId, upstreamKey }
        } catch (err) {
          this.logger.warn(
            { action: 'refreshTitles', error: getErrorMessage(err), mediaId },
            'Library title read failed - retrying on the next refresh',
          )
          return undefined
        }
      }),
    )

    if (cache.epoch !== epoch || cache.known !== known) return

    const changed = results.filter(
      (result): result is NonNullable<typeof result> =>
        result !== undefined &&
        (result.entry ? libraryFingerprint(result.entry) : undefined) !==
          known.get(result.mediaId),
    )
    if (changed.length === 0) return

    const nextKnown = new Map(known)
    const current = cache.current?.failed ? undefined : cache.current
    const entries = current ? new Map(current.entries) : undefined
    for (const { entry, mediaId, upstreamKey } of changed) {
      if (entry) {
        nextKnown.set(mediaId, libraryFingerprint(entry))
        entries?.set(upstreamKey, entry)
      } else {
        nextKnown.delete(mediaId)
        entries?.delete(upstreamKey)
      }
    }

    cache.known = nextKnown
    if (current && entries) cache.current = { ...current, entries }
    cache.epoch += 1
    this.emitLibraryChange(changed.map(({ mediaId }) => mediaId))
  }

  private emitLibraryChange(mediaIds: readonly string[]): void {
    if (mediaIds.length === 0) return

    for (const listener of this.changeListeners) {
      try {
        listener(mediaIds)
      } catch (err) {
        this.logger.warn(
          { action: 'emitLibraryChange', error: getErrorMessage(err) },
          'Library change listener threw',
        )
      }
    }
  }
}
