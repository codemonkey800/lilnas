import type {
  CommandResourceWritable,
  MovieFileResource,
  MovieResource,
  QueueResource,
  ReleaseResource,
} from '@lilnas/media/radarr'
import {
  deleteApiV3MovieById,
  deleteApiV3MoviefileById,
  deleteApiV3QueueById,
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
import { toCommonRelease } from 'src/media/release-mapper.util'
import { checkSdkError, unwrapSdkResult } from 'src/media/sdk-result.util'
import { generateTitleSlug } from 'src/media/title-slug.util'

/**
 * Radarr's MoviesSearch command accepts movieIds but the generated SDK type
 * omits command-specific body parameters. We extend it locally so TypeScript
 * validates the extra field rather than silently ignoring it via a raw `as`.
 * (Mirrors apps/tdr-bot/src/media/services/radarr.service.ts.)
 */
type MoviesSearchCommand = CommandResourceWritable & { movieIds?: number[] }

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
 */
export function toMovie(movie: MovieResource): Movie {
  const posterUrl = movie.images?.find(img => img.coverType === 'poster')?.url
  const releaseDate = pickMovieReleaseDate(movie)
  const tmdbId = movie.tmdbId ?? 0

  return {
    certification: movie.certification ?? undefined,
    filePath: movie.hasFile ? (movie.movieFile?.path ?? undefined) : undefined,
    genres: movie.genres ?? [],
    id: mediaId({ tmdbId, type: DownloadType.Movie }),
    overview: movie.overview ?? undefined,
    posterUrl: posterUrl ?? undefined,
    // Radarr returns `id: 0` for a lookup result that isn't in the library
    // - falsy rather than absent - so `|| undefined` (not `?? undefined`)
    // is what keeps a non-library hit from claiming radarrId 0.
    radarrId: movie.id || undefined,
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

    return movies.map(toMovie)
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

    return movies.map(toMovie)
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

      return { movie: existing, radarrId: existing.id, wasMonitored }
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

    // `false`, not `true`: a movie that didn't exist a moment ago was not
    // monitored *before this call*, which is exactly what a caller restoring
    // borrowed monitoring needs to know.
    return { movie: added, radarrId: added.id, wasMonitored: false }
  }

  /**
   * Flips a movie's `monitored` flag. Radarr's `PUT /movie/{id}` replaces the
   * whole resource, so the current one is read back first and re-sent with
   * the single field changed - anything else would blank out the movie's
   * quality profile, root folder and tags.
   */
  async setMonitored(radarrId: number, monitored: boolean): Promise<void> {
    const movie = unwrapSdkResult(
      await getApiV3MovieById({ client: this.client, path: { id: radarrId } }),
      'getMovie',
    )

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
