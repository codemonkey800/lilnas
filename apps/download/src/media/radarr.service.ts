import type {
  CommandResourceWritable,
  HistoryResource,
  Language,
  ManualImportResource,
  MovieFileResource,
  MovieResource,
  QualityModel,
  QueueResource,
  ReleaseResource,
} from '@lilnas/media/radarr'
import {
  deleteApiV3MovieById,
  deleteApiV3MoviefileById,
  deleteApiV3QueueById,
  getApiV3HistoryMovie,
  getApiV3Manualimport,
  getApiV3Movie,
  getApiV3MovieById,
  getApiV3Moviefile,
  getApiV3MovieLookup,
  getApiV3MovieLookupTmdb,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3Release,
  getApiV3Rootfolder,
  postApiV3Command,
  postApiV3Movie,
  postApiV3Release,
  putApiV3MovieById,
} from '@lilnas/media/radarr'
import {
  DownloadType,
  type Movie,
  type Release,
} from '@lilnas/utils/download/types'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { mediaId } from 'src/db/media-id'
import type { RadarrMediaClient } from 'src/media/clients'
import { RADARR_CLIENT } from 'src/media/clients'
import { mapCatalogueEntries } from 'src/media/map-media.util'
import { toCommonRelease } from 'src/media/release-mapper.util'
import { checkSdkError, unwrapSdkResult } from 'src/media/sdk-result.util'
import { generateTitleSlug } from 'src/media/title-slug.util'
import { toUpstreamIsoDateTime } from 'src/media/upstream-date.util'

/**
 * Radarr's MoviesSearch command accepts movieIds but the generated SDK type
 * omits command-specific body parameters. We extend it locally so TypeScript
 * validates the extra field rather than silently ignoring it via a raw `as`.
 * (Mirrors apps/tdr-bot/src/media/services/radarr.service.ts.)
 */
type MoviesSearchCommand = CommandResourceWritable & { movieIds?: number[] }

/**
 * One file in a ManualImport command body - what Radarr's own manual-import
 * dialog sends per row once the user has confirmed it.
 *
 * `path` and `movieId` are the only required fields: the path is the file on
 * disk Radarr refused to import automatically, and `movieId` is the library
 * entry it should be imported into. Everything else is carried over from the
 * `ManualImportResource` candidate so Radarr keeps the quality, languages and
 * release group it already parsed instead of re-deriving them from the
 * filename - `downloadId` in particular is what lets Radarr tie the import
 * back to the queue item that produced it.
 *
 * Built by the caller from `getManualImportCandidates()` output; exported
 * because the mapping from candidate to file lives outside this service.
 */
export type RadarrManualImportFile = {
  downloadId?: string | null
  folderName?: string | null
  indexerFlags?: number
  languages?: Language[] | null
  movieId: number
  path: string
  quality?: QualityModel
  releaseGroup?: string | null
}

/**
 * The ManualImport command body. Neither SDK types command-specific fields -
 * `CommandResourceWritable` carries only `name` - so this is the same
 * locally-typed intersection trick `MoviesSearchCommand` above uses, posted
 * through `postApiV3Command`.
 */
type ManualImportCommand = CommandResourceWritable & {
  files: RadarrManualImportFile[]
  importMode: 'auto' | 'copy' | 'move'
}

export interface RequestMovieResult {
  overview?: string
  posterUrl?: string
  radarrId: number
  title: string
}

/**
 * What `ensureMovie()` hands back. `wasMonitored` is the state **before**
 * the call - `false` for a fresh add - and is the whole point of the return
 * shape: `ReleaseService.withMonitoring()` needs to know whether it borrowed
 * monitoring (and must therefore put it back) or found it already on (and
 * must leave it strictly alone, since a pending request depends on it).
 *
 * `movie` rides along because `requestMovie()` needs the resource's
 * title/overview/poster for its own result, and re-fetching what
 * `ensureMovie` already had in hand would be a wasted round trip.
 */
export interface EnsureMovieResult {
  movie: MovieResource
  radarrId: number
  /**
   * `true` when this call *added* the movie to Radarr, i.e. it was not in
   * the library at all beforehand.
   *
   * `wasMonitored: false` alone cannot express that: it is equally true of a
   * movie that was already in the library with monitoring off, where
   * restoring means flipping one flag back. A caller borrowing the library
   * entry for a read has to be able to tell "put the flag back" from "take
   * the entry out again", and this is that distinction.
   */
  wasAdded: boolean
  wasMonitored: boolean
}

/**
 * Radarr's half of the shared `Release` mapper. Radarr adds nothing to the
 * common shape - `fullSeason`/`seasonNumber`/`episodeNumbers` are Sonarr-only
 * - so this is a pass-through, kept as a named export purely so both
 * services expose the same mapper name.
 */
export function toRelease(resource: ReleaseResource): Release {
  return toCommonRelease(resource)
}

// Radarr surfaces up to four release-date-shaped fields depending on the
// movie's lifecycle stage (announced -> in cinemas -> digital -> physical) -
// none of them are guaranteed present, so the first one that is wins.
function pickMovieReleaseDate(movie: MovieResource): string | undefined {
  return (
    movie.releaseDate ??
    movie.inCinemas ??
    movie.digitalRelease ??
    movie.physicalRelease ??
    undefined
  )
}

/**
 * The single Radarr -> `Media` mapper (plan §4.1/§4.2). Everything that
 * turns a Radarr payload into a domain object goes through here: the
 * resolver's library cache and per-id fallback, `/movies/search`,
 * `/discover`, and `/media/:id`. A search hit, a discovery hit and a
 * library item are now literally the same type, differing only in which
 * optional fields are populated - which is what let three near-identical
 * mappers collapse into this one.
 *
 * Throws on a missing `tmdbId`, the same way `toEpisode()` throws on a
 * missing episode number: TMDB's id is what every downstream reference to
 * this title is keyed on, and defaulting it to `0` would mint a `tmdb:0`
 * key that fails `MovieSchema`'s own `z.number().int().positive()` - a
 * record the backend serialises happily and the frontend's `safeParse()`
 * discards without a word. List call sites go through
 * `mapCatalogueEntries()`, which turns that throw into one dropped record
 * and a warning instead of a failed listing.
 */
export function toMovie(movie: MovieResource): Movie {
  const posterUrl = movie.images?.find(
    img => img.coverType === 'poster',
  )?.remoteUrl
  const releaseDate = pickMovieReleaseDate(movie)
  const tmdbId = movie.tmdbId

  if (tmdbId == null || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    throw new Error(
      `Radarr returned a movie without a usable tmdbId ` +
        `(tmdbId=${tmdbId}, title=${movie.title ?? 'unknown'})`,
    )
  }

  // Radarr returns `id: 0` for a lookup result that isn't in the library
  // - falsy rather than absent - so `|| undefined` (not `?? undefined`)
  // is what keeps a non-library hit from claiming radarrId 0.
  const radarrId = movie.id || undefined

  return {
    // Gated on `hasFile` exactly like `filePath`: the file's own
    // `dateAdded`, not the movie's `added` (when it entered the library).
    addedAt: movie.hasFile
      ? toUpstreamIsoDateTime(movie.movieFile?.dateAdded)
      : undefined,
    certification: movie.certification ?? undefined,
    filePath: movie.hasFile ? (movie.movieFile?.path ?? undefined) : undefined,
    genres: movie.genres ?? [],
    id: mediaId({ tmdbId, type: DownloadType.Movie }),
    // A lookup hit outside the library still carries `monitored` (Radarr's
    // default for the add form), which says nothing about this title - so
    // only a library movie reports one.
    monitored: radarrId ? movie.monitored : undefined,
    overview: movie.overview ?? undefined,
    posterUrl: posterUrl ?? undefined,
    radarrId,
    ratingValue: movie.ratings?.tmdb?.value ?? movie.ratings?.imdb?.value,
    releaseDate,
    // Radarr reports minutes; `Media.runtime` is seconds (see MediaBaseSchema).
    runtime: movie.runtime != null ? movie.runtime * 60 : undefined,
    title: movie.title ?? 'Unknown title',
    tmdbId,
    type: DownloadType.Movie,
    year: movie.year,
  }
}

@Injectable()
export class RadarrService {
  private logger = new Logger(RadarrService.name)

  constructor(
    @Inject(RADARR_CLIENT) private readonly client: RadarrMediaClient,
  ) {}

  /**
   * Radarr's lookup, mapped to `Media`. Backs both `/movies/search` and
   * `/discover` - they were two methods and two mappers over the identical
   * upstream call purely because their response types differed, and the
   * search mapper dropped genres/ratings/runtime/certification on the floor
   * even though the same response carried them.
   */
  async search(query: string): Promise<Movie[]> {
    const movies = unwrapSdkResult(
      await getApiV3MovieLookup({
        client: this.client,
        query: { term: query },
      }),
      'searchMovies',
    )

    return mapCatalogueEntries(movies, toMovie, {
      action: 'searchMovies',
      logger: this.logger,
    })
  }

  /**
   * The whole Radarr library, mapped to `Media` - `MediaResolverService`'s
   * library cache is built from this (one call per TTL window rather than
   * one per job). Same underlying call as `requestMovie()`'s existing
   * library-first lookup (`getApiV3Movie`).
   */
  async getLibrary(): Promise<Movie[]> {
    const movies = unwrapSdkResult(
      await getApiV3Movie({ client: this.client }),
      'getMovies',
    )

    return mapCatalogueEntries(movies, toMovie, {
      action: 'getMovies',
      logger: this.logger,
    })
  }

  /**
   * One title's library entry, or `undefined` when Radarr's library doesn't
   * hold it. The same `getApiV3Movie` call as `getLibrary()`, filtered
   * upstream by `tmdbId` - a few KB against the whole library's megabytes, so
   * `MediaResolverService.refreshTitle()` can re-read an open page's title
   * every second.
   */
  async getLibraryMovie(tmdbId: number): Promise<Movie | undefined> {
    const movies = unwrapSdkResult(
      await getApiV3Movie({ client: this.client, query: { tmdbId } }),
      'getMovie',
    )

    const movie = movies.find(entry => entry.tmdbId === tmdbId)
    return movie ? toMovie(movie) : undefined
  }

  /**
   * Per-id fallback for `MediaResolverService` when a tmdbId isn't in the
   * library cache - metadata-only, no `radarrId`/`filePath` (this is the
   * *discover* lookup, not a library query, so a title requested but since
   * removed from Radarr still resolves).
   */
  async lookupByTmdbId(tmdbId: number): Promise<Movie> {
    const lookup = unwrapSdkResult(
      await getApiV3MovieLookupTmdb({
        client: this.client,
        query: { tmdbId },
      }),
      'lookupMovieByTmdbId',
    )

    return toMovie(lookup)
  }

  /**
   * Gets the movie into a state where Radarr will actually surface and grab
   * releases for it: present in the library **and** monitored. Radarr's
   * release endpoint keys on `movieId`, so a title nobody has requested yet
   * has to be added before its releases can even be listed.
   *
   * Three branches, and `wasMonitored` distinguishes them for the caller:
   * absent (add it, `false`), present-but-unmonitored (flip it on, `false`),
   * present-and-monitored (**touch nothing**, `true`). That last branch is
   * load-bearing: a title with a pending `requestMovie` is monitored on
   * purpose, and a caller that later "restored" it to unmonitored would
   * silently kill that request.
   *
   * `wasAdded` reports the first branch separately, because unmonitoring a
   * movie this call added is *not* a restore - it leaves a library entry
   * nobody asked for. See `ReleaseService.withMonitoring()`, which deletes
   * on that branch instead.
   *
   * Extracted verbatim from `requestMovie()`'s add-if-missing half - the one
   * new behaviour is the monitoring flip, which a plain search on an
   * unmonitored movie would otherwise have quietly no-op'd.
   */
  async ensureMovie(tmdbId: number): Promise<EnsureMovieResult> {
    const existingMovies = unwrapSdkResult(
      await getApiV3Movie({ client: this.client }),
      'getMovies',
    )

    const existing = existingMovies.find(m => m.tmdbId === tmdbId)

    if (existing) {
      if (existing.id == null) {
        throw new Error(
          `Radarr did not return an id for movie tmdbId=${tmdbId}`,
        )
      }

      const wasMonitored = existing.monitored === true
      if (!wasMonitored) {
        await this.setMonitored(existing.id, true)
      }

      return {
        movie: existing,
        radarrId: existing.id,
        wasAdded: false,
        wasMonitored,
      }
    }

    const lookup = unwrapSdkResult(
      await getApiV3MovieLookupTmdb({
        client: this.client,
        query: { tmdbId },
      }),
      'lookupMovieByTmdbId',
    )

    const { qualityProfileId, rootFolderPath } =
      await this.getDefaultConfiguration()

    const title = lookup.title ?? `Movie ${tmdbId}`

    const added = unwrapSdkResult(
      await postApiV3Movie({
        client: this.client,
        // Domain fields line up 1:1 with MovieResource; addOptions is the
        // only nested writable-only shape, so a targeted cast covers it.
        body: {
          tmdbId,
          title,
          titleSlug: generateTitleSlug(title),
          year: lookup.year,
          qualityProfileId,
          rootFolderPath,
          monitored: true,
          minimumAvailability: 'released',
          addOptions: { searchForMovie: false },
        } as unknown as MovieResource,
      }),
      'addMovie',
    )

    if (added.id == null) {
      throw new Error(`Radarr did not return an id for movie tmdbId=${tmdbId}`)
    }

    // `wasMonitored: false`, not `true`: a movie that didn't exist a moment
    // ago was not monitored *before this call*, which is exactly what a
    // caller restoring borrowed monitoring needs to know. `wasAdded` is what
    // tells that caller the entry itself is also this call's doing.
    return {
      movie: added,
      radarrId: added.id,
      wasAdded: true,
      wasMonitored: false,
    }
  }

  /**
   * Flips a movie's `monitored` flag. Radarr's `PUT /movie/{id}` replaces the
   * whole resource, so the current one is read back first and re-sent with
   * the single field changed - anything else would blank out the movie's
   * quality profile, root folder and tags.
   */
  async setMonitored(radarrId: number, monitored: boolean): Promise<void> {
    const movie = await this.getMovieResource(radarrId)
    await this.putMonitored(radarrId, movie, monitored)
  }

  /**
   * Turns monitoring **off** for a movie only when it has no file, and
   * reports whether it wrote anything.
   *
   * To Radarr a monitored movie with no file is a *missing* movie, so the
   * next RSS sync would re-grab a download the user just cancelled. A movie
   * that already has a file is left monitored - cancelling a replacement
   * must not quietly stop Radarr looking after the copy already on disk.
   *
   * Reads the raw resource fresh rather than the app-level `Movie`, whose
   * file signal (`filePath`) is derived; `hasFile` is Radarr's own answer.
   * An already-unmonitored movie is skipped, so `true` means this call
   * changed something.
   */
  async unmonitorIfMissing(radarrId: number): Promise<boolean> {
    const movie = await this.getMovieResource(radarrId)

    if (movie.hasFile || movie.monitored === false) {
      return false
    }

    await this.putMonitored(radarrId, movie, false)
    return true
  }

  private async getMovieResource(radarrId: number): Promise<MovieResource> {
    return unwrapSdkResult(
      await getApiV3MovieById({ client: this.client, path: { id: radarrId } }),
      'getMovie',
    )
  }

  private async putMonitored(
    radarrId: number,
    movie: MovieResource,
    monitored: boolean,
  ): Promise<void> {
    checkSdkError(
      await putApiV3MovieById({
        client: this.client,
        // The generated path type is a string here (unlike the GET above,
        // which takes a number) - an inconsistency in Radarr's spec, not a
        // choice on this side.
        path: { id: String(radarrId) },
        body: { ...movie, monitored },
      }),
      'setMovieMonitored',
    )
  }

  /**
   * Radarr's interactive indexer search for one movie, mapped to the shared
   * `Release` DTO. Every result comes back with `flaggedBad: false` -
   * annotation against `bad_files` happens in `ReleaseService`, which is the
   * only layer that has a DB.
   *
   * The movie must be in the library and monitored first (see
   * `ensureMovie()`), otherwise Radarr has nothing to search for.
   */
  async getReleases(radarrId: number): Promise<Release[]> {
    const releases = unwrapSdkResult(
      await getApiV3Release({
        client: this.client,
        query: { movieId: radarrId },
      }),
      'getReleases',
    )

    return releases.map(toRelease)
  }

  /**
   * Hands one specific release to Radarr to download. `postApiV3Release`
   * takes a whole `ReleaseResource` body upstream, but `{ guid, indexerId }`
   * is all Radarr actually needs to re-find and grab it - so the caller
   * sends the identity of its pick rather than round-tripping the entire
   * release it was handed.
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

  /** Every file Radarr currently holds for a movie - the replace path's input. */
  async getMovieFiles(radarrId: number): Promise<MovieFileResource[]> {
    return unwrapSdkResult(
      await getApiV3Moviefile({
        client: this.client,
        query: { movieId: [radarrId] },
      }),
      'getMovieFiles',
    )
  }

  /**
   * Deletes one movie file, leaving the movie itself in the library and
   * **monitored**. Deliberately not `unmonitorAndDelete`, which removes the
   * whole movie - a replace has to keep the title so the replacement release
   * has somewhere to import to.
   */
  async deleteMovieFile(fileId: number): Promise<void> {
    checkSdkError(
      await deleteApiV3MoviefileById({
        client: this.client,
        path: { id: fileId },
      }),
      'deleteMovieFile',
    )
  }

  /**
   * Every history record Radarr holds for one movie - grabs, imports,
   * upgrades, deletions, all of it. `mapFilesToReleases()` walks
   * these to join a file on disk back to the indexer release that produced
   * it, since history is the only place either *arr remembers the guid.
   *
   * Unpaged, unlike `getQueue()`: `/history/movie` returns a bare array with
   * each record's `data` bag already populated, so there is nothing to
   * unwrap past `unwrapSdkResult`.
   *
   * Deliberately **unfiltered**. The endpoint does take an `eventType` query
   * param, but the SDK's `MovieHistoryEventType` union (`'unknown' |
   * 'grabbed' | 'downloadFolderImported' | ...`) is *not* positional with
   * the numeric values the wire expects - `downloadFolderImported` is `3`,
   * not the `2` its index implies - so filtering here would silently fetch
   * the wrong event type. Callers match on the string `eventType` off the
   * records instead; see `release-history.util.ts`.
   *
   * Radarr's grabbed records carry `data.indexerId` alongside the indexer
   * name, so nothing on this side needs a follow-up indexer lookup the way
   * Sonarr's do.
   */
  async getMovieHistory(radarrId: number): Promise<HistoryResource[]> {
    return unwrapSdkResult(
      await getApiV3HistoryMovie({
        client: this.client,
        query: { movieId: radarrId },
      }),
      'getMovieHistory',
    )
  }

  /**
   * Adds (if needed) and triggers a search for a movie by TMDB ID.
   * Simplified relative to tdr-bot's monitorAndDownloadMovie: no
   * retry/circuit-breaker wrapper, no granular options, just enough to get
   * the movie monitored in Radarr and a search command queued.
   *
   * Now literally `ensureMovie()` + the search command - the add-if-missing
   * half moved out so `ReleaseService` can reach it without also triggering
   * a search it doesn't want.
   */
  async requestMovie(tmdbId: number): Promise<RequestMovieResult> {
    const { movie, radarrId } = await this.ensureMovie(tmdbId)

    await this.triggerSearch(radarrId)

    const posterUrl = movie.images?.find(
      img => img.coverType === 'poster',
    )?.remoteUrl

    return {
      overview: movie.overview ?? undefined,
      posterUrl: posterUrl ?? undefined,
      radarrId,
      title: movie.title ?? `Movie ${tmdbId}`,
    }
  }

  /**
   * Radarr's generic "go find something for this movie" command - the
   * unflagged auto-select path. When a title *does* have flagged releases,
   * `MediaDownloadService` fetches and picks itself instead, because this
   * command gives the app no say in what Radarr grabs.
   */
  async triggerSearch(radarrId: number): Promise<void> {
    const command: MoviesSearchCommand = {
      name: 'MoviesSearch',
      movieIds: [radarrId],
    }

    checkSdkError(
      await postApiV3Command({ client: this.client, body: command }),
      'triggerMovieSearch',
    )
  }

  /**
   * Asks Radarr to re-read its download client now rather than on its own
   * once-a-minute schedule. Its queue endpoint serves a cache that only that
   * task updates, so without this the poller reads the same stale snapshot
   * for up to a minute however often it asks.
   *
   * Queued, not awaited: Radarr runs it in the background (~20ms of work,
   * done well inside a poll tick), so the refresh lands in time for the next
   * read. Radarr de-duplicates an identical queued command, so a slow run
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
   * Fetches the current Radarr queue, optionally scoped to specific movie
   * IDs. Used by MediaPollerService (no filter -> all tracked jobs matched
   * client-side) and by unmonitorAndDelete (filtered to one movie).
   */
  async getQueue(movieIds?: number[]): Promise<QueueResource[]> {
    const paging = unwrapSdkResult(
      await getApiV3Queue({
        client: this.client,
        query: {
          includeMovie: false,
          pageSize: 1000,
          ...(movieIds && movieIds.length > 0 ? { movieIds } : {}),
        },
      }),
      'getQueue',
    )

    return paging.records ?? []
  }

  /**
   * The files Radarr found for a stuck download, as *manual-import
   * candidates* - the same list its manual-import dialog shows when a
   * download finished but Radarr refused to import it ("Downloaded - Waiting
   * to Import").
   *
   * `filterExistingFiles: true` matches what the dialog itself sends: files
   * Radarr already holds for the movie are dropped, so the list is only what
   * is genuinely still outside the library.
   *
   * Returned **raw and unmapped** on purpose. A candidate carries the quality,
   * languages, release group and indexer flags Radarr parsed, and the caller
   * has to hand all of them straight back in the import command - mapping to
   * a domain shape here would mean reconstructing them afterwards.
   *
   * An empty list is a legitimate answer (nothing left to import), so it is
   * returned as `[]` rather than treated as an error; the caller decides what
   * that means. An upstream failure still throws, via `unwrapSdkResult`.
   *
   * A candidate's `rejections` are informational. They explain why the
   * *automatic* import was refused - typically that the folder name did not
   * match the grabbed release - but Radarr's `ManualImportService` builds a
   * fresh import decision with no rejections for each file it is handed, so
   * even a `permanent` rejection does not block the manual import below.
   */
  async getManualImportCandidates(
    downloadId: string,
    radarrId: number,
  ): Promise<ManualImportResource[]> {
    return unwrapSdkResult(
      await getApiV3Manualimport({
        client: this.client,
        query: {
          downloadId,
          filterExistingFiles: true,
          movieId: radarrId,
        },
      }),
      'getManualImportCandidates',
    )
  }

  /**
   * Actually performs the import of files picked out of
   * `getManualImportCandidates()`.
   *
   * Note which endpoint this is **not**: `postApiV3Manualimport` (`POST
   * /api/v3/manualimport`) is Radarr's *reprocess* endpoint. It re-evaluates
   * candidates after a user edits a field in the dialog - changing the movie,
   * the quality, the languages - and hands back updated candidates. It
   * imports nothing, so it is deliberately unused here.
   *
   * The import is a Radarr *command*, posted through `postApiV3Command` like
   * every other command this service sends.
   *
   * `importMode: 'auto'` is what Radarr's own UI sends: it lets Radarr pick
   * move-vs-copy from the download client's settings, rather than this app
   * overriding a choice the user already made there (hardlink-friendly copy
   * for a still-seeding torrent, move for a finished usenet grab).
   *
   * Throws on an empty list before touching Radarr - a command with no files
   * is a caller bug, and Radarr would accept it and silently do nothing.
   */
  async commitManualImport(files: RadarrManualImportFile[]): Promise<void> {
    if (files.length === 0) {
      throw new Error('commitManualImport requires at least one file')
    }

    const command: ManualImportCommand = {
      name: 'ManualImport',
      importMode: 'auto',
      files,
    }

    checkSdkError(
      await postApiV3Command({ client: this.client, body: command }),
      'commitManualImport',
    )
  }

  /**
   * Drops one row from Radarr's queue - the *discard* path, where the user
   * gives the download back instead of importing it. This is not the tail of
   * an import: Radarr clears the row itself once a ManualImport command
   * succeeds.
   *
   * The three flags are all deliberate:
   * - `removeFromClient: true` because giving the download back means the
   *   download client should drop its copy too, not sit on it forever.
   * - `blocklist: false` because the release was never the problem - the
   *   folder name was. Blocklisting it would stop Radarr from picking the
   *   same (perfectly good) release the next time it searches.
   * - `skipRedownload: true` because the user asked to be rid of this one;
   *   without it Radarr would immediately go searching for a replacement
   *   nobody asked for.
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

  /**
   * Cancels any in-progress downloads for the movie, then unmonitors and
   * deletes it. Mirrors apps/tdr-bot/src/media/services/radarr.service.ts's
   * unmonitorAndDeleteMovie operation order (cancel queue items, then
   * delete) without the retry/warnings apparatus.
   */
  async unmonitorAndDelete(
    radarrId: number,
    deleteFiles = true,
  ): Promise<void> {
    const queueItems = await this.getQueue([radarrId])

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
          { radarrId, error: String(result.reason) },
          'Failed to cancel an in-progress queue item before deleting movie',
        )
      }
    }

    checkSdkError(
      await deleteApiV3MovieById({
        client: this.client,
        path: { id: radarrId },
        query: { deleteFiles },
      }),
      'deleteMovie',
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

    const profile = profiles[0]
    if (!profile || profile.id == null) {
      throw new Error('No quality profiles available in Radarr')
    }

    const folder = folders.find(f => f.accessible)
    if (!folder || folder.path == null) {
      throw new Error('No accessible root folders available in Radarr')
    }

    return { qualityProfileId: profile.id, rootFolderPath: folder.path }
  }
}
