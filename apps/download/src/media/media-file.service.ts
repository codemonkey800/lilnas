import {
  DownloadType,
  type GetMediaFileQuery,
  isMovie,
  isShow,
  type Media,
} from '@lilnas/utils/download/types'
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import * as mime from 'mime-types'
import { Client } from 'minio'
import { MINIO_CONNECTION } from 'nestjs-minio'
import path from 'path'
import type { Readable } from 'stream'

import { DbService } from 'src/db/db.service'
import { mediaIdSuffix, mediaTypeFromKey } from 'src/db/media-id'
import { getVideoById } from 'src/db/videos.repo'

import { MediaResolverService } from './media-resolver.service'
import { SonarrService } from './sonarr.service'

/** The public bucket every completed video download is uploaded to. */
const VIDEO_BUCKET = 'videos'

/**
 * The path segment a stored download URL carries in front of the object key:
 * `DownloadVideoService.upload()` writes
 * `${MINIO_PUBLIC_URL}/videos/${jobId}/part0.mp4`.
 */
const VIDEO_URL_PREFIX = `/${VIDEO_BUCKET}/`

/**
 * The only two roots a disk-backed file may live under - `/movies` is
 * Radarr's library mount and `/tv` is Sonarr's, both mounted read-only into
 * this service (`apps/download/deploy.yml`).
 */
const ALLOWED_DISK_ROOTS = ['/movies/', '/tv/']

const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/**
 * Where a title's bytes actually are - the two storage shapes this service
 * has ever had. A `disk` source is a path the process can open directly; an
 * `object` source has to be streamed back out of MinIO
 * (`getObjectStream()`), which is why it carries the size and content type
 * the stat already cost us rather than making the caller ask twice.
 */
export type MediaFileSource =
  | { fileName: string; kind: 'disk'; path: string }
  | {
      bucket: string
      contentType: string
      fileName: string
      key: string
      kind: 'object'
      size: number
    }

/**
 * The scope a `GET .../file` request resolves to once the key prefix and the
 * query params have been checked against each other - a movie is one file, a
 * show is one *episode's* file, a video is one part of a possibly multi-part
 * post.
 */
type FileScope =
  | { episodeId: number; type: DownloadType.Show }
  | { part: number; type: DownloadType.Video }
  | { type: DownloadType.Movie }

/**
 * The one place the cross-field query rules live. Which rule applies depends
 * on the key prefix, which the Zod schema never sees
 * (`GetMediaFileQuerySchema`), so the check has to happen here - and doing it
 * once, up front, means a malformed request is rejected before it can cost a
 * Radarr/Sonarr round trip.
 */
function parseScope(mediaId: string, query: GetMediaFileQuery): FileScope {
  const type = mediaTypeFromKey(mediaId)

  if (type === undefined) {
    throw new NotFoundException(`No media found for '${mediaId}'`)
  }

  if (type !== DownloadType.Show && query.episodeId != null) {
    throw new BadRequestException(
      `'${mediaId}' is not a show, so 'episodeId' does not scope anything on it`,
    )
  }

  if (type !== DownloadType.Video && query.part != null) {
    throw new BadRequestException(
      `'${mediaId}' is not a video, so 'part' does not scope anything on it`,
    )
  }

  switch (type) {
    case DownloadType.Movie:
      return { type }
    case DownloadType.Show:
      // A series is a folder, not a file - there is no "the show's file" to
      // fall back to, so the episode has to be named explicitly.
      if (query.episodeId == null) {
        throw new BadRequestException(
          `Show '${mediaId}' is not a single file - pass 'episodeId' to save one episode`,
        )
      }
      return { episodeId: query.episodeId, type }
    case DownloadType.Video:
      return { part: query.part ?? 0, type }
  }
}

/**
 * The `videos` object key a stored download URL points at, or `undefined`
 * for a URL this app can no longer read.
 *
 * Recovered from the URL's own pathname rather than by stripping the
 * configured `MINIO_PUBLIC_URL`: that base URL is env-driven and can change
 * (or gain a path segment) between the day a row was written and the day
 * someone saves it, and a key taken from the path survives that where a
 * prefix match would not.
 */
function objectKeyFromUrl(url: string): string | undefined {
  let pathname: string

  try {
    pathname = new URL(url).pathname
  } catch {
    return undefined
  }

  if (!pathname.startsWith(VIDEO_URL_PREFIX)) {
    return undefined
  }

  try {
    // Percent-decoded, because the upload wrote a raw key and the URL is its
    // encoded form - `decodeURIComponent` throws on a lone `%`, hence the
    // try rather than a bare call.
    const key = decodeURIComponent(pathname.slice(VIDEO_URL_PREFIX.length))
    return key === '' ? undefined : key
  } catch {
    return undefined
  }
}

/**
 * Strips the characters that would let a title escape its own filename -
 * both separators and the control range (a `\r\n` in a title would otherwise
 * become header injection the moment the controller writes
 * `Content-Disposition`).
 *
 * Written as a code-point filter rather than a regex on purpose: the regex
 * form needs a `no-control-regex` suppression, and the escape hatch is worth
 * more elsewhere.
 */
function sanitizeFileName(title: string): string {
  return [...title]
    .filter(char => {
      if (char === '/' || char === '\\') return false
      const code = char.codePointAt(0) ?? 0
      return code > 0x1f && code !== 0x7f
    })
    .join('')
    .trim()
}

/**
 * Turns a media id into a concrete, servable file source (plan §7) - the one
 * place that knows *where* a finished download physically ended up.
 *
 * File locations are derived live, never stored: a movie's path comes from
 * Radarr, an episode's from Sonarr, and a video's object key from the
 * `videos` row's own download URL. Nothing here is cached and nothing is
 * written back, so a title deleted upstream stops being savable the moment
 * the resolver's TTL expires rather than the moment someone notices a stale
 * column.
 *
 * Deliberately does **not** open, stat or send the file for the disk cases -
 * existence is proven at open time by the route that streams it, and a stat
 * here would only add a TOCTOU-shaped second answer to the same question.
 */
@Injectable()
export class MediaFileService {
  private readonly logger = new Logger(MediaFileService.name)

  constructor(
    @Inject(MINIO_CONNECTION) private readonly minioClient: Client,
    private readonly dbService: DbService,
    private readonly mediaResolverService: MediaResolverService,
    private readonly sonarrService: SonarrService,
  ) {}

  async resolveFileSource(
    mediaId: string,
    query: GetMediaFileQuery,
  ): Promise<MediaFileSource> {
    const scope = parseScope(mediaId, query)

    switch (scope.type) {
      case DownloadType.Movie:
        return this.resolveMovieSource(mediaId)
      case DownloadType.Show:
        return this.resolveEpisodeSource(mediaId, scope.episodeId)
      case DownloadType.Video:
        return this.resolveVideoSource(mediaId, scope.part)
    }
  }

  /**
   * Opens the object behind an `object` source. A thin wrapper on purpose:
   * it is the only reason the route needs to know MinIO exists, and keeping
   * the client injected here means the route never holds one.
   */
  getObjectStream(
    source: MediaFileSource & { kind: 'object' },
  ): Promise<Readable> {
    return this.minioClient.getObject(source.bucket, source.key)
  }

  private async resolveVideoSource(
    mediaId: string,
    part: number,
  ): Promise<MediaFileSource> {
    const row = getVideoById(this.dbService.db, mediaIdSuffix(mediaId))

    if (!row) {
      throw new NotFoundException(`No media found for '${mediaId}'`)
    }

    const urls = row.downloadUrls ?? []

    if (urls.length === 0) {
      throw new NotFoundException(`Media '${mediaId}' has no file to save`)
    }

    const url = urls[part]

    if (url === undefined) {
      throw new NotFoundException(`Media '${mediaId}' has no part ${part}`)
    }

    const key = objectKeyFromUrl(url)

    if (key === undefined) {
      // Data this app wrote itself and can no longer honour. A 500 would be
      // technically honest and operationally useless - the row is broken,
      // and no retry fixes it.
      this.logger.warn(
        { action: 'resolveFileSource', mediaId, part },
        'Stored download URL is not a readable videos object URL',
      )
      throw new NotFoundException(`Media '${mediaId}' has no file to save`)
    }

    const stat = await this.statVideoObject(mediaId, key)

    // MinIO lowercases response header names, so this is the only casing the
    // stat can come back under. An object uploaded before the pipeline set a
    // content type still needs one, hence the extension fallback.
    const storedContentType = stat.metaData?.['content-type']
    const contentType =
      typeof storedContentType === 'string' && storedContentType !== ''
        ? storedContentType
        : mime.lookup(key) || DEFAULT_CONTENT_TYPE

    // The saved file is named after the *title*, not the key: the objects are
    // keyed `<jobId>/part0.mp4`, which says nothing to whoever ends up with
    // the file. The part suffix only appears when there is more than one part
    // to tell apart, and it carries the same index the caller asked for.
    const base = sanitizeFileName(row.title) || row.id
    const partSuffix = urls.length > 1 ? ` (part ${part})` : ''

    return {
      bucket: VIDEO_BUCKET,
      contentType,
      fileName: `${base}${partSuffix}${path.extname(key)}`,
      key,
      kind: 'object',
      size: stat.size,
    }
  }

  private async resolveMovieSource(mediaId: string): Promise<MediaFileSource> {
    const resolved = await this.resolveOne(mediaId, DownloadType.Movie)

    // `Movie.filePath` is the movie *file*, and Radarr only populates it once
    // `hasFile` - so "absent" covers both "not in the library" and "requested
    // but not downloaded yet", which are the same answer to this question.
    const filePath = isMovie(resolved) ? resolved.filePath : undefined

    if (!filePath) {
      throw new NotFoundException(`Media '${mediaId}' has no file to save`)
    }

    return this.diskSource(mediaId, filePath)
  }

  private async resolveEpisodeSource(
    mediaId: string,
    episodeId: number,
  ): Promise<MediaFileSource> {
    const resolved = await this.resolveOne(mediaId, DownloadType.Show)

    // NB: `Show.filePath` is the *series folder*, not a file - it is never a
    // valid answer here and is deliberately not consulted. The saveable unit
    // is the episode file, which only Sonarr knows about.
    const sonarrId = isShow(resolved) ? resolved.sonarrId : undefined

    if (sonarrId == null) {
      // A show with no Sonarr id is the degraded placeholder `resolve()`
      // emits when Sonarr is unreachable - the same outage as an entry in
      // `degradedSources`, so it gets the same answer.
      throw this.unavailable(mediaId, DownloadType.Show)
    }

    const episodes = await this.sonarrService.getEpisodes(sonarrId)
    const episode = episodes.find(candidate => candidate.id === episodeId)

    if (!episode) {
      throw new NotFoundException(
        `Media '${mediaId}' has no episode ${episodeId}`,
      )
    }

    // `episodeFileId: 0` is Sonarr's "no file", so truthiness is the right
    // check here rather than a null guard (same rule as
    // `resolveEpisodeFileIds`).
    const episodeFileId = episode.episodeFileId

    if (!episodeFileId) {
      throw new NotFoundException(
        `Episode ${episodeId} of '${mediaId}' has no file to save`,
      )
    }

    const files = await this.sonarrService.getEpisodeFiles(sonarrId)
    const filePath = files.find(file => file.id === episodeFileId)?.path

    if (!filePath) {
      throw new NotFoundException(
        `Episode ${episodeId} of '${mediaId}' has no file to save`,
      )
    }

    return this.diskSource(mediaId, filePath)
  }

  /**
   * The resolved `Media` for one key, or a thrown 503 when the source it
   * comes from is degraded.
   *
   * Degradation is checked *before* the payload is read rather than after:
   * the placeholder `resolve()` emits for an unreachable source is
   * indistinguishable from a real title with nothing downloaded, and
   * answering "there is no file" while Radarr is simply down would send the
   * user off to re-request something they already have.
   */
  private async resolveOne(
    mediaId: string,
    type: DownloadType,
  ): Promise<Media> {
    const { degradedSources, media } = await this.mediaResolverService.resolve([
      { mediaId, type },
    ])

    if (degradedSources.includes(type)) {
      throw this.unavailable(mediaId, type)
    }

    const resolved = media.get(mediaId)

    if (!resolved) {
      throw new NotFoundException(`No media found for '${mediaId}'`)
    }

    return resolved
  }

  private unavailable(
    mediaId: string,
    type: DownloadType,
  ): ServiceUnavailableException {
    this.logger.warn(
      { action: 'resolveFileSource', mediaId, type },
      'Media source is degraded - cannot say where the file is',
    )

    return new ServiceUnavailableException(
      `Can't reach the library for '${mediaId}' right now - try again shortly`,
    )
  }

  /**
   * Defense in depth around the two paths this service does not own. No
   * client ever supplies one - the id is prefix-parsed and the query params
   * are coerced integers - but Radarr and Sonarr are external services, and
   * this app has an RCE-probing incident in its history. A path that
   * normalizes to somewhere outside the library mounts is refused and
   * logged; it is never opened, and the caller learns nothing beyond "no
   * file".
   */
  private diskSource(mediaId: string, candidate: string): MediaFileSource {
    const resolved = path.resolve(candidate)

    if (!ALLOWED_DISK_ROOTS.some(root => resolved.startsWith(root))) {
      this.logger.warn(
        { action: 'resolveFileSource', mediaId, path: resolved },
        'Refusing a media file path outside the allowed library roots',
      )
      throw new NotFoundException(`Media '${mediaId}' has no file to save`)
    }

    return { fileName: path.basename(resolved), kind: 'disk', path: resolved }
  }

  /**
   * Stats the object so the route can send a `Content-Length` without
   * buffering the body.
   *
   * A missing object becomes a 404 - a `videos` row outlives the object it
   * points at whenever a bucket lifecycle rule or a manual cleanup runs, and
   * that is a "gone", not a fault. Every other MinIO failure is re-thrown
   * untouched, so an outage never gets mislabelled as a deleted file.
   */
  private async statVideoObject(mediaId: string, key: string) {
    try {
      return await this.minioClient.statObject(VIDEO_BUCKET, key)
    } catch (err) {
      if (!isMissingObjectError(err)) {
        throw err
      }

      this.logger.warn(
        { action: 'resolveFileSource', key, mediaId },
        'Video object is gone from MinIO but the row still points at it',
      )
      throw new NotFoundException(`Media '${mediaId}' has no file to save`)
    }
  }
}

/**
 * Whether a MinIO error means "that object isn't there" as opposed to "MinIO
 * couldn't be reached". The S3 error surfaces as `NoSuchKey` on a HEAD and
 * `NotFound` on some gateway configurations, and minio-js puts it on either
 * `code` or `name` depending on the path that threw.
 */
function isMissingObjectError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false

  const { code, name } = err as { code?: unknown; name?: unknown }

  return [code, name].some(
    value => value === 'NoSuchKey' || value === 'NotFound',
  )
}
