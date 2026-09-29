import type {
  CommandResource,
  CommandResourceWritable,
  CreditResource,
  HistoryResource,
  Language,
  ManualImportResource,
  MovieEditorResource,
  MovieFileResource,
  MovieResource,
  QualityModel,
  QualityProfileResource,
  QueueResource,
  ReleaseResource,
} from '@lilnas/media/radarr'
import {
  deleteApiV3MovieById,
  deleteApiV3MoviefileById,
  deleteApiV3QueueById,
  deleteApiV3ReleaseprofileById,
  getApiV3Command,
  getApiV3CommandById,
  getApiV3ConfigDownloadclient,
  getApiV3Credit,
  getApiV3Health,
  getApiV3History,
  getApiV3HistoryMovie,
  getApiV3HistorySince,
  getApiV3Manualimport,
  getApiV3Movie,
  getApiV3MovieById,
  getApiV3Moviefile,
  getApiV3MovieLookup,
  getApiV3MovieLookupTmdb,
  getApiV3Qualityprofile,
  getApiV3QualityprofileSchema,
  getApiV3Queue,
  getApiV3Release,
  getApiV3Releaseprofile,
  getApiV3Rootfolder,
  postApiV3Command,
  postApiV3Movie,
  postApiV3Qualityprofile,
  postApiV3Release,
  postApiV3Releaseprofile,
  putApiV3MovieEditor,
  putApiV3QualityprofileById,
  putApiV3ReleaseprofileById,
} from '@lilnas/media/radarr'
import {
  DownloadType,
  type MediaCredits,
  type Movie,
  QUALITY_TIERS,
  QualityTier,
  type Release,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { mediaId } from 'src/db/media-id'
import type { CommandRef, CommandSnapshot } from 'src/media/arr-command.types'
import type { RadarrMediaClient } from 'src/media/clients'
import { RADARR_CLIENT } from 'src/media/clients'
import {
  buildFlaggedTerms,
  FLAGGED_RELEASE_PROFILE_NAME,
  planFlaggedReleaseProfile,
} from 'src/media/flagged-release-terms.util'
import { mapCatalogueEntries } from 'src/media/map-media.util'
import {
  originalLanguageName,
  toMediaCredits,
  toMovieFile,
  toMovieRatings,
} from 'src/media/movie-metadata.util'
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
 * Radarr's MoviesSearch command accepts movieIds but the generated SDK type
 * omits command-specific body parameters. We extend it locally so TypeScript
 * validates the extra field rather than silently ignoring it via a raw `as`.
 * (Mirrors apps/tdr-bot/src/media/services/radarr.service.ts.)
 */
type MoviesSearchCommand = CommandResourceWritable & { movieIds?: number[] }

/**
 * Radarr's RefreshMovie command - same locally-typed trick as
 * `MoviesSearchCommand`. `isNewMovie` is only ever sent as `true` (see
 * `refreshMovie()` for why it must match Radarr's own add-time refresh
 * exactly); absent otherwise.
 */
type RefreshMovieCommand = CommandResourceWritable & {
  isNewMovie?: true
  movieIds: number[]
}

/**
 * The only two fields `editMovies()` lets a caller change. `PUT
 * /movie/editor` accepts more (root folder, tags, minimum availability, file
 * moves), none of which this app should ever be touching in bulk.
 */
export interface MovieEditorChanges {
  monitored?: boolean
  qualityProfileId?: number
}

/**
 * The health-check sources that speak for the download client. Any of them
 * at `warning` or `error` means Radarr can't reach or use it - either none is
 * configured/enabled (`DownloadClientCheck`) or the ones that are keep failing
 * (`DownloadClientStatusCheck`).
 */
const DOWNLOAD_CLIENT_HEALTH_SOURCES = new Set([
  'DownloadClientCheck',
  'DownloadClientStatusCheck',
])

/** Radarr's queue is small; a page this size is almost always the only one. */
const QUEUE_PAGE_SIZE = 1000

/** One download's history is a handful of rows; this is rarely exceeded. */
const HISTORY_PAGE_SIZE = 100

/**
 * The paging envelope every paged Radarr endpoint returns (`/queue`,
 * `/history`, ...), reduced to what `readAllPages()` needs.
 */
interface PagingEnvelope<T> {
  page?: number
  pageSize?: number
  records?: T[] | null
  totalRecords?: number
}

/**
 * Reads a paged endpoint to the end: page 1, 2, ... until `page * pageSize`
 * covers `totalRecords`. Stops early on an empty page too, so an envelope
 * that under-reports (or omits) its counters can't loop forever.
 */
async function readAllPages<T>(
  fetchPage: (page: number) => Promise<PagingEnvelope<T>>,
  pageSize: number,
): Promise<T[]> {
  const all: T[] = []

  for (let page = 1; ; page++) {
    const envelope = await fetchPage(page)
    const records = envelope.records ?? []
    all.push(...records)

    const readSoFar = (envelope.page ?? page) * (envelope.pageSize ?? pageSize)
    if (records.length === 0 || readSoFar >= (envelope.totalRecords ?? 0)) {
      return all
    }
  }
}

/**
 * Maps a Radarr command resource onto the app-agnostic snapshot. Returns
 * `undefined` for a resource missing the three fields every command has -
 * never seen in practice, but a snapshot without an id or status would be
 * useless to every caller.
 *
 * Radarr omits null fields from its JSON, so an absent `message`/`started`/
 * `ended` just means "none yet".
 */
function toCommandSnapshot(
  resource: CommandResource,
): CommandSnapshot | undefined {
  if (resource.id == null || resource.name == null || resource.status == null) {
    return undefined
  }

  return {
    body: { ...resource.body },
    ended: resource.ended ?? undefined,
    id: resource.id,
    message: resource.message ?? undefined,
    name: resource.name,
    queued: resource.queued ?? undefined,
    result: resource.result ?? undefined,
    started: resource.started ?? undefined,
    status: resource.status,
    trigger: resource.trigger ?? undefined,
  }
}

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

/**
 * What `ensureMovie()` hands back. `wasMonitored` is the state **before**
 * the call - `false` for a fresh add - so a caller can tell whether the
 * ensure changed anything its caches hold (see
 * `MediaResolverService.invalidateAfterEnsure`).
 *
 * `movie` rides along so a caller that needs the resource's
 * title/overview/poster doesn't re-fetch what `ensureMovie` already had in
 * hand.
 */
export interface EnsureMovieResult {
  movie: MovieResource
  radarrId: number
  /**
   * `true` when this call *added* the movie to Radarr, i.e. it was not in
   * the library at all beforehand.
   *
   * `wasMonitored: false` alone cannot express that: it is equally true of a
   * movie that was already in the library with monitoring off. The browse
   * path keys its wait for Radarr's add-time refresh on this - only a fresh
   * add has one.
   */
  wasAdded: boolean
  wasMonitored: boolean
}

/** What `ensureMovie()` is asked to leave behind. */
export interface EnsureMovieOptions {
  /**
   * `true` for a request: add the movie monitored, or turn monitoring on for
   * a library movie that has it off. `false` for browsing and grabbing: add
   * an absent movie **unmonitored** and never write to one that is already
   * there. Radarr's interactive search and its grab endpoint don't check
   * `monitored`, so neither needs it on - a grab turns it on itself, and only
   * once the grab has succeeded.
   */
  monitored: boolean
  /**
   * The quality profile an **add** gets - a request's tier profile. Absent
   * means the default tier's (`defaultQualityTier()`), so no add ever lands
   * on whatever profile Radarr lists first. A movie already in the library
   * keeps its profile: re-tiering one is the request path's call (see
   * `MediaDownloadService.requestMovie`), never a browse's.
   */
  qualityProfileId?: number
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
export function toMovie(
  movie: MovieResource,
  tierForProfileId: (profileId: number) => QualityTier | null = () => null,
): Movie {
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
    collection: movie.collection?.title
      ? {
          title: movie.collection.title,
          tmdbId: movie.collection.tmdbId || undefined,
        }
      : undefined,
    digitalRelease: movie.digitalRelease ?? undefined,
    // Gated on `hasFile` like `filePath`: a file Radarr has since lost
    // can linger as a stale `movieFile` on the resource.
    file: movie.hasFile ? toMovieFile(movie.movieFile) : undefined,
    filePath: movie.hasFile ? (movie.movieFile?.path ?? undefined) : undefined,
    genres: movie.genres ?? [],
    id: mediaId({ tmdbId, type: DownloadType.Movie }),
    imdbId: movie.imdbId || undefined,
    inCinemas: movie.inCinemas ?? undefined,
    isAvailable: movie.isAvailable ?? undefined,
    // A lookup hit outside the library still carries `monitored` (Radarr's
    // default for the add form), which says nothing about this title - so
    // only a library movie reports one.
    monitored: radarrId ? movie.monitored : undefined,
    originalLanguage: originalLanguageName(movie.originalLanguage),
    // Only when it differs - an English title's original title is itself.
    originalTitle:
      movie.originalTitle && movie.originalTitle !== movie.title
        ? movie.originalTitle
        : undefined,
    overview: movie.overview ?? undefined,
    physicalRelease: movie.physicalRelease ?? undefined,
    posterUrl: posterUrl ?? undefined,
    // Only a library movie has a profile of its own - a lookup hit's is the
    // add form's default.
    qualityTier:
      radarrId && movie.qualityProfileId != null
        ? tierForProfileId(movie.qualityProfileId)
        : null,
    radarrId,
    ratingValue: movie.ratings?.tmdb?.value ?? movie.ratings?.imdb?.value,
    ratings: toMovieRatings(movie.ratings),
    releaseDate,
    // Radarr reports minutes; `Media.runtime` is seconds (see MediaBaseSchema).
    runtime: movie.runtime != null ? movie.runtime * 60 : undefined,
    studio: movie.studio || undefined,
    title: movie.title ?? 'Unknown title',
    tmdbId,
    trailerYouTubeId: movie.youTubeTrailerId || undefined,
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

    return mapCatalogueEntries(movies, this.toMovie, {
      action: 'searchMovies',
      logger: this.logger,
    })
  }

  /**
   * The whole Radarr library, mapped to `Media` - `MediaResolverService`'s
   * library cache is built from this (one call per TTL window rather than
   * one per job). Same underlying call as `ensureMovie()`'s library-first
   * lookup (`getApiV3Movie`), unfiltered.
   */
  async getLibrary(): Promise<Movie[]> {
    const [movies] = await Promise.all([
      getApiV3Movie({ client: this.client }).then(result =>
        unwrapSdkResult(result, 'getMovies'),
      ),
      this.warmTierCache(),
    ])

    return mapCatalogueEntries(movies, this.toMovie, {
      action: 'getMovies',
      logger: this.logger,
    })
  }

  /**
   * Who made a library movie - Radarr's `/api/v3/credit`, keyed on Radarr's
   * own id. A movie outside the library has no Radarr id and so no credits
   * here; the caller skips the call rather than passing one in.
   */
  async getCredits(radarrId: number): Promise<MediaCredits> {
    const credits: unknown = unwrapSdkResult(
      await getApiV3Credit({
        client: this.client,
        query: { movieId: radarrId },
      }),
      'getCredits',
    )

    // Radarr's OpenAPI document leaves this response untyped, so the SDK
    // hands back `unknown`; the shape is checked rather than asserted.
    if (!Array.isArray(credits)) {
      throw new Error('getCredits returned a non-array body')
    }

    return toMediaCredits(credits as CreditResource[])
  }

  /**
   * One title's library entry, or `undefined` when Radarr's library doesn't
   * hold it. The same `getApiV3Movie` call as `getLibrary()`, filtered
   * upstream by `tmdbId` - a few KB against the whole library's megabytes, so
   * `MediaResolverService.refreshTitle()` can re-read an open page's title
   * every second.
   */
  async getLibraryMovie(tmdbId: number): Promise<Movie | undefined> {
    const [movies] = await Promise.all([
      getApiV3Movie({ client: this.client, query: { tmdbId } }).then(result =>
        unwrapSdkResult(result, 'getMovie'),
      ),
      this.warmTierCache(),
    ])

    const movie = movies.find(entry => entry.tmdbId === tmdbId)
    return movie ? this.toMovie(movie) : undefined
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

    return this.toMovie(lookup)
  }

  /**
   * Gets the movie into Radarr's library, so the endpoints that key on
   * Radarr's own `movieId` (release search, grab, files) have one.
   *
   * Three branches:
   *
   * - **absent**: added with `monitored: opts.monitored` and
   *   `searchForMovie: false` - the add never searches; a caller that wants
   *   a search layers the command on top. `wasAdded: true`.
   * - **present, `opts.monitored: false`**: nothing is written. Browsing a
   *   title someone has requested must not touch the monitoring that request
   *   depends on, and browsing one nobody has must not start Radarr looking
   *   for it.
   * - **present, `opts.monitored: true`**: monitoring is turned on if it was
   *   off (a plain search on an unmonitored movie would otherwise quietly
   *   no-op), and left strictly alone if it was already on.
   *
   * A `400 already been added` from the add (a concurrent add won the race
   * between the library read and the POST) re-reads the library and carries
   * on down the "present" branch rather than failing.
   */
  async ensureMovie(
    tmdbId: number,
    opts: EnsureMovieOptions,
  ): Promise<EnsureMovieResult> {
    const existing = await this.findLibraryMovie(tmdbId)

    if (existing) {
      return this.ensureExistingMovie(tmdbId, existing, opts)
    }

    const lookup = unwrapSdkResult(
      await getApiV3MovieLookupTmdb({
        client: this.client,
        query: { tmdbId },
      }),
      'lookupMovieByTmdbId',
    )

    const [qualityProfileId, { rootFolderPath }] = await Promise.all([
      opts.qualityProfileId ?? this.tierProfileId(defaultQualityTier()),
      this.getDefaultConfiguration(),
    ])

    const title = lookup.title ?? `Movie ${tmdbId}`

    let added: MovieResource
    try {
      added = unwrapSdkResult(
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
            monitored: opts.monitored,
            minimumAvailability: 'released',
            addOptions: { searchForMovie: false },
          } as unknown as MovieResource,
        }),
        'addMovie',
      )
    } catch (error) {
      const raced = isAlreadyAddedError(error)
        ? await this.findLibraryMovie(tmdbId)
        : undefined
      if (!raced) {
        throw error
      }

      this.logger.log(
        { action: 'ensureMovie', tmdbId },
        'Movie was added concurrently - continuing with the library entry',
      )
      return this.ensureExistingMovie(tmdbId, raced, opts)
    }

    if (added.id == null) {
      throw new Error(`Radarr did not return an id for movie tmdbId=${tmdbId}`)
    }

    // `wasMonitored: false` even when added monitored: a movie that didn't
    // exist a moment ago was not monitored *before this call*.
    return {
      movie: added,
      radarrId: added.id,
      wasAdded: true,
      wasMonitored: false,
    }
  }

  /** `ensureMovie()`'s "already in the library" branch. */
  private async ensureExistingMovie(
    tmdbId: number,
    existing: MovieResource,
    opts: EnsureMovieOptions,
  ): Promise<EnsureMovieResult> {
    if (existing.id == null) {
      throw new Error(`Radarr did not return an id for movie tmdbId=${tmdbId}`)
    }

    const wasMonitored = existing.monitored === true
    if (opts.monitored && !wasMonitored) {
      await this.setMonitored(existing.id, true)
    }

    return {
      movie: existing,
      radarrId: existing.id,
      wasAdded: false,
      wasMonitored,
    }
  }

  /**
   * The raw library resource for one `tmdbId`, or `undefined`. Filtered
   * upstream like `getLibraryMovie()` - a few KB rather than the whole
   * library - and still matched here, so an older Radarr that ignores the
   * filter can't hand back the wrong movie.
   */
  private async findLibraryMovie(
    tmdbId: number,
  ): Promise<MovieResource | undefined> {
    const movies = unwrapSdkResult(
      await getApiV3Movie({ client: this.client, query: { tmdbId } }),
      'getMovies',
    )

    return movies.find(m => m.tmdbId === tmdbId)
  }

  /**
   * Flips a movie's `monitored` flag, through the bulk editor rather than
   * `PUT /movie/{id}`: the editor changes only the fields it is sent, so
   * there is no read-back and no full-resource PUT (whose path validators
   * can reject an otherwise unchanged movie).
   */
  async setMonitored(radarrId: number, monitored: boolean): Promise<void> {
    await this.editMovies([radarrId], { monitored })
  }

  /**
   * Radarr's bulk movie editor (`PUT /movie/editor`): applies the given
   * changes to every listed movie and leaves every other field alone. Only
   * the keys actually present in `changes` are sent - an absent key means
   * "don't touch", and sending it as `undefined`/`null` would not.
   *
   * An empty id list is a no-op rather than a request Radarr would accept
   * and do nothing with.
   */
  async editMovies(
    movieIds: number[],
    changes: MovieEditorChanges,
  ): Promise<void> {
    if (movieIds.length === 0) {
      return
    }

    const body: MovieEditorResource = { movieIds }
    if (changes.monitored !== undefined) {
      body.monitored = changes.monitored
    }
    if (changes.qualityProfileId !== undefined) {
      body.qualityProfileId = changes.qualityProfileId
    }

    checkSdkError(
      await putApiV3MovieEditor({ client: this.client, body }),
      'editMovies',
    )
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

    await this.editMovies([radarrId], { monitored: false })
    return true
  }

  private async getMovieResource(radarrId: number): Promise<MovieResource> {
    return unwrapSdkResult(
      await getApiV3MovieById({ client: this.client, path: { id: radarrId } }),
      'getMovie',
    )
  }

  /**
   * Radarr's interactive indexer search for one movie, mapped to the shared
   * `Release` DTO. Every result comes back with `flaggedBad: false` -
   * annotation against `bad_files` happens in `ReleaseService`, which is the
   * only layer that has a DB.
   *
   * The movie must be in the library first (see `ensureMovie()`) - Radarr
   * keys the search on its own id. It need not be monitored: the
   * interactive search never checks.
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
   * Radarr's generic "go find something for this movie" command - the
   * unflagged auto-select path. When a title *does* have flagged releases,
   * `MediaDownloadService` fetches and picks itself instead, because this
   * command gives the app no say in what Radarr grabs.
   *
   * Returns the queued command so a caller can follow it with
   * `getCommand()`; one that doesn't care can ignore it.
   */
  async triggerSearch(radarrId: number): Promise<CommandRef> {
    const command: MoviesSearchCommand = {
      name: 'MoviesSearch',
      movieIds: [radarrId],
    }

    return this.postCommand(command, 'triggerMovieSearch')
  }

  /**
   * Queues a RefreshMovie for one movie - Radarr re-reads its metadata and
   * rescans its folder on disk.
   *
   * `isNew` exists for the add flow. Adding a movie makes Radarr queue its
   * own refresh with body `{ movieIds: [id], isNewMovie: true }`, and Radarr
   * de-dupes a POST whose body matches a queued command (trigger ignored) by
   * returning that existing command. Sending exactly the same body is
   * therefore how a caller gets the id of the refresh Radarr already queued,
   * instead of queueing a second one - so `isNewMovie` is sent only when
   * asked for, and omitted (never `false`) otherwise.
   */
  async refreshMovie(
    radarrId: number,
    opts: { isNew?: boolean } = {},
  ): Promise<CommandRef> {
    const command: RefreshMovieCommand = {
      name: 'RefreshMovie',
      movieIds: [radarrId],
      ...(opts.isNew ? { isNewMovie: true as const } : {}),
    }

    return this.postCommand(command, 'refreshMovie')
  }

  /**
   * One command by id, or `null` when Radarr has no record of it (404).
   *
   * A command stays in memory for ~5 minutes after it ends; past that the
   * lookup falls back to Radarr's database (kept ~1 day), which reports
   * `result: 'unknown'` and no `message` whatever actually happened. Any
   * other failure still throws.
   */
  async getCommand(id: number): Promise<CommandSnapshot | null> {
    const res = await getApiV3CommandById({
      client: this.client,
      path: { id },
    })

    let resource: CommandResource
    try {
      resource = unwrapSdkResult(res, 'getCommand')
    } catch (error) {
      if (error instanceof SdkHttpError && error.status === 404) {
        return null
      }
      throw error
    }

    const snapshot = toCommandSnapshot(resource)
    if (!snapshot) {
      throw new Error(`getCommand returned a malformed command (id=${id})`)
    }
    return snapshot
  }

  /**
   * Every command Radarr still holds in memory - queued, running, and those
   * that ended within the last ~5 minutes. Older ones are only reachable
   * one at a time through `getCommand()`.
   */
  async listCommands(): Promise<CommandSnapshot[]> {
    const resources = unwrapSdkResult(
      await getApiV3Command({ client: this.client }),
      'listCommands',
    )

    return resources.flatMap(resource => {
      const snapshot = toCommandSnapshot(resource)
      if (!snapshot) {
        this.logger.warn(
          { id: resource.id, name: resource.name },
          'Skipping a malformed Radarr command',
        )
        return []
      }
      return [snapshot]
    })
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
   * Fetches the whole Radarr queue - every page - optionally scoped to
   * specific movie IDs. Used by MediaPollerService (no filter -> all tracked
   * jobs matched client-side) and by unmonitorAndDelete (filtered to one
   * movie).
   *
   * Records come back raw, `errorMessage` included - often the download
   * client's only explanation for a failed item. Two kinds of row are kept
   * on purpose:
   * - pending releases (`delay`, `downloadClientUnavailable`, `fallback`),
   *   which have no `downloadId` yet.
   * - unknown items (`movieId` absent) - a download Radarr can't match to a
   *   library movie. Requested with `includeUnknownMovieItems`, but only on
   *   the unfiltered read: a caller scoping to movie ids wants that movie's
   *   rows, and `unmonitorAndDelete` would otherwise cancel strangers.
   */
  async getQueue(movieIds?: number[]): Promise<QueueResource[]> {
    const filtered = movieIds != null && movieIds.length > 0

    return readAllPages(
      async page =>
        unwrapSdkResult(
          await getApiV3Queue({
            client: this.client,
            query: {
              includeMovie: false,
              page,
              pageSize: QUEUE_PAGE_SIZE,
              ...(filtered ? { movieIds } : { includeUnknownMovieItems: true }),
            },
          }),
          'getQueue',
        ),
      QUEUE_PAGE_SIZE,
    )
  }

  /**
   * Every history record since `date`, oldest first. `/history/since` is
   * unpaged - one call returns the full list - and its `eventType` is the
   * camelCase string (`grabbed`, `downloadFailed`, ...).
   *
   * Never log a record's `data` wholesale: `data.downloadUrl` carries the
   * indexer's API key.
   */
  async getHistorySince(date: Date): Promise<HistoryResource[]> {
    return unwrapSdkResult(
      await getApiV3HistorySince({
        client: this.client,
        query: { date: date.toISOString() },
      }),
      'getHistorySince',
    )
  }

  /**
   * Every history record for one download (the download client's id -
   * the grab, the import, a failure, ...), newest first as Radarr sorts
   * them. Paged upstream; this reads every page.
   *
   * Same caution as `getHistorySince()`: `data.downloadUrl` holds the
   * indexer API key.
   */
  async getHistoryByDownloadId(downloadId: string): Promise<HistoryResource[]> {
    return readAllPages(
      async page =>
        unwrapSdkResult(
          await getApiV3History({
            client: this.client,
            query: { downloadId, page, pageSize: HISTORY_PAGE_SIZE },
          }),
          'getHistoryByDownloadId',
        ),
      HISTORY_PAGE_SIZE,
    )
  }

  /**
   * Whether Radarr can currently use its download client, per its own
   * health checks. Unhealthy means any `DownloadClientCheck` or
   * `DownloadClientStatusCheck` entry at `warning` or `error`; every other
   * health source (indexers, disk space, updates, ...) is ignored here.
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
   * Radarr's own settings for what happens after a failed download:
   * - `autoRedownloadFailed`: it searches for another release by itself.
   * - `fromInteractive`: it does so even when the failed grab was picked by
   *   hand (interactive search).
   *
   * A missing key falls back to Radarr's own default, `true` - the choice
   * that keeps a caller from racing Radarr with a second search.
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
      autoRedownloadFailed: config.autoRedownloadFailed ?? true,
      fromInteractive: config.autoRedownloadFailedFromInteractiveSearch ?? true,
    }
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
   * Rejects - naming the profile - when that run fails, rather than let a
   * caller fall back to some other profile: a request that can't get its
   * tier fails outright.
   */
  async tierProfileId(tier: QualityTier): Promise<number> {
    const cached = this.tierProfileIds.get(tier)
    if (cached != null) return cached

    try {
      await this.ensureTierProfiles()
    } catch (error) {
      throw new Error(
        `Could not set up Radarr's "${tierProfileName(tier)}" quality profile: ${getErrorMessage(error)}`,
      )
    }
    const id = this.tierProfileIds.get(tier)
    if (id == null) {
      throw new Error(`Radarr has no "${tierProfileName(tier)}" profile`)
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
   * Makes sure `tierForProfileId()` has something to answer from before a
   * library read maps its movies. A no-op once every tier is cached - the
   * normal case, boot having filled it. Otherwise it joins (or starts) one
   * `ensureTierProfiles()` run, **once**: a failure is logged and the read
   * goes on with the tiers it has (`null` for the rest), and the read path
   * never retries it - a request's `tierProfileId()` does that lazily, into
   * the same cache. So a page view costs Radarr at most one extra round,
   * ever.
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

  /** `toMovie()` with this service's tier cache behind `qualityTier`. */
  private readonly toMovie = (movie: MovieResource): Movie =>
    toMovie(movie, id => this.tierForProfileId(id))

  private async reconcileTierProfiles(): Promise<void> {
    const [profilesResult, schemaResult] = await Promise.all([
      getApiV3Qualityprofile({ client: this.client }),
      getApiV3QualityprofileSchema({ client: this.client }),
    ])
    const plans = planTierProfiles(
      'radarr',
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
   * the `lilnas · Flagged releases` release profile, so Radarr's own RSS
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
        `Not mirroring ${unreported.length} flagged release title(s) into Radarr: a "/" would make Radarr read the term as a regex: ${unreported.join(', ')}`,
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
   * Posts a command and returns a reference to it. Radarr answers 201 with
   * the command resource - possibly one it already had queued (see
   * `refreshMovie()`) - and its `id` is the handle `getCommand()` takes.
   */
  private async postCommand(
    command: CommandResourceWritable,
    context: string,
  ): Promise<CommandRef> {
    const resource = unwrapSdkResult(
      await postApiV3Command({ client: this.client, body: command }),
      context,
    )

    if (resource.id == null) {
      throw new Error(`${context} returned a command without an id`)
    }

    return {
      id: resource.id,
      name: resource.name ?? command.name ?? '',
      // Radarr always stamps `queued`; the fallback only keeps the type
      // honest if a response ever omits it.
      queuedAt: resource.queued ?? new Date().toISOString(),
    }
  }

  /**
   * Where an add goes. The root folder only - the quality profile is the
   * requested tier's (see `EnsureMovieOptions.qualityProfileId`).
   */
  private async getDefaultConfiguration(): Promise<{
    rootFolderPath: string
  }> {
    const folders = unwrapSdkResult(
      await getApiV3Rootfolder({ client: this.client }),
      'getRootFolders',
    )

    const folder = folders.find(f => f.accessible)
    if (!folder || folder.path == null) {
      throw new Error('No accessible root folders available in Radarr')
    }

    return { rootFolderPath: folder.path }
  }
}
