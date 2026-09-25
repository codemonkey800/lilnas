import type { DownloadType } from '@lilnas/utils/download/types'
import { and, eq, inArray } from 'drizzle-orm'

import type { Db } from './db.service'
import { type MediaFileReleaseRow, mediaFileReleases } from './schema'

export interface UpsertMediaFileReleaseInput {
  downloadId?: string
  episodeId?: number
  indexer?: string
  indexerId?: number
  mediaId: string
  mediaType: DownloadType
  protocol?: string
  publishDate?: Date
  releaseGroup?: string
  releaseGuid: string
  releaseTitle?: string
  size?: number
  upstreamFileId: number
}

/**
 * Caches the release that produced one upstream file. Idempotent on
 * `media_file_releases_type_file_idx` via `onConflictDoUpdate` - and the
 * choice of `DoUpdate` over `bad_files`' `DoNothing` is the whole difference
 * between the two tables: a flag records who said what and the first
 * flagger's identity has to stick, whereas this row is a derived cache
 * entry, so a re-resolve is a *correction* and the newer answer wins.
 *
 * The `set` clause coalesces every optional field to `null` rather than
 * passing `undefined` through. Drizzle drops undefined keys from an update
 * set, which would leave a field the new resolve no longer knows about
 * sitting at its stale value - half the old answer fused onto half the new
 * one. Writing the nulls explicitly makes a re-resolve a genuine replace.
 *
 * `mediaType`/`upstreamFileId` are absent from the set for the opposite
 * reason to `videos.id`: they aren't protected, they're the conflict target,
 * so by construction they already hold the values being written.
 */
export function upsertMediaFileRelease(
  db: Db,
  input: UpsertMediaFileReleaseInput,
): MediaFileReleaseRow {
  const resolvedAt = new Date()

  return db
    .insert(mediaFileReleases)
    .values({
      downloadId: input.downloadId,
      episodeId: input.episodeId,
      indexer: input.indexer,
      indexerId: input.indexerId,
      mediaId: input.mediaId,
      mediaType: input.mediaType,
      protocol: input.protocol,
      publishDate: input.publishDate,
      releaseGroup: input.releaseGroup,
      releaseGuid: input.releaseGuid,
      releaseTitle: input.releaseTitle,
      resolvedAt,
      size: input.size,
      upstreamFileId: input.upstreamFileId,
    })
    .onConflictDoUpdate({
      set: {
        downloadId: input.downloadId ?? null,
        episodeId: input.episodeId ?? null,
        indexer: input.indexer ?? null,
        indexerId: input.indexerId ?? null,
        mediaId: input.mediaId,
        protocol: input.protocol ?? null,
        publishDate: input.publishDate ?? null,
        releaseGroup: input.releaseGroup ?? null,
        releaseGuid: input.releaseGuid,
        releaseTitle: input.releaseTitle ?? null,
        // This row is a cache entry and `resolvedAt` is its age, so a
        // re-resolve has to restamp it - otherwise a refreshed row would
        // keep advertising the staleness of the answer it just replaced.
        resolvedAt,
        size: input.size ?? null,
      },
      target: [mediaFileReleases.mediaType, mediaFileReleases.upstreamFileId],
    })
    .returning()
    .get()!
}

/**
 * The cached release for one file, or `undefined` when it has never been
 * resolved. This is the cache-hit read path: a miss is the caller's cue to
 * go ask Radarr/Sonarr's history and write the answer back.
 *
 * Both halves of the unique index are matched because `upstreamFileId`
 * collides across the two services - Radarr's file 42 and Sonarr's file 42
 * are different files (see the column's comment in schema.ts).
 */
export function getMediaFileRelease(
  db: Db,
  mediaType: DownloadType,
  upstreamFileId: number,
): MediaFileReleaseRow | undefined {
  return db
    .select()
    .from(mediaFileReleases)
    .where(
      and(
        eq(mediaFileReleases.mediaType, mediaType),
        eq(mediaFileReleases.upstreamFileId, upstreamFileId),
      ),
    )
    .get()
}

/**
 * The cached releases for a batch of files, in one query. The season list is
 * the reason this exists: a series page asks about every episode file it is
 * about to render at once, so the alternative is N `getMediaFileRelease`
 * round-trips for a single page view.
 *
 * Rows come back in no particular order and ids with no cached release are
 * simply absent, so callers should index the result by `upstreamFileId`
 * rather than zip it against the input.
 *
 * The empty-array short circuit isn't a micro-optimization: `inArray` with
 * an empty list compiles to invalid SQL on some drivers, so this has to not
 * reach the database at all.
 */
export function listMediaFileReleasesByFileIds(
  db: Db,
  mediaType: DownloadType,
  upstreamFileIds: readonly number[],
): MediaFileReleaseRow[] {
  if (upstreamFileIds.length === 0) {
    return []
  }

  return db
    .select()
    .from(mediaFileReleases)
    .where(
      and(
        eq(mediaFileReleases.mediaType, mediaType),
        inArray(mediaFileReleases.upstreamFileId, [...upstreamFileIds]),
      ),
    )
    .all()
}
