import type { DownloadType } from '@lilnas/utils/download/types'
import { and, desc, eq } from 'drizzle-orm'

import type { Db } from './db.service'
import { type BadFileRow, badFiles } from './schema'

export interface InsertBadFileInput {
  flaggedByEmail: string
  flaggedByUserId: string
  indexerId?: number
  mediaId: string
  mediaType: DownloadType
  reason?: string
  releaseGuid: string
  releaseTitle?: string
}

/**
 * Records a release as bad. Idempotent on `bad_files_media_id_release_guid_idx`
 * via `onConflictDoNothing` rather than a read-then-write check: two
 * concurrent flags of the same release both succeed, and the first one's
 * flagger identity is the one that sticks.
 *
 * Because a conflicting insert returns no row, the existing row is read back
 * on that path - so the caller always gets the row that's actually in the
 * table, never `undefined` for "someone beat you to it".
 */
export function insertBadFile(db: Db, input: InsertBadFileInput): BadFileRow {
  const inserted = db
    .insert(badFiles)
    .values({
      createdAt: new Date(),
      flaggedByEmail: input.flaggedByEmail,
      flaggedByUserId: input.flaggedByUserId,
      indexerId: input.indexerId,
      mediaId: input.mediaId,
      mediaType: input.mediaType,
      reason: input.reason,
      releaseGuid: input.releaseGuid,
      releaseTitle: input.releaseTitle,
    })
    .onConflictDoNothing({
      target: [badFiles.mediaId, badFiles.releaseGuid],
    })
    .returning()
    .get()

  return inserted ?? getBadFileByGuid(db, input.mediaId, input.releaseGuid)!
}

/**
 * Every flag for one title, newest first. The whole read path - both the
 * `flaggedBad` annotation on a release list and the exclusion filter in
 * `MediaDownloadService`'s auto-select branch - goes through this one query,
 * so a title's flags are fetched once per request rather than per release.
 */
export function listBadFilesByMediaId(db: Db, mediaId: string): BadFileRow[] {
  return db
    .select()
    .from(badFiles)
    .where(eq(badFiles.mediaId, mediaId))
    .orderBy(desc(badFiles.createdAt), desc(badFiles.id))
    .all()
}

/**
 * One flag by its natural key. Used by the grab path's refusal check, where
 * only a single guid is in question and listing every flag for the title
 * would be wasted work.
 */
export function getBadFileByGuid(
  db: Db,
  mediaId: string,
  releaseGuid: string,
): BadFileRow | undefined {
  return db
    .select()
    .from(badFiles)
    .where(
      and(eq(badFiles.mediaId, mediaId), eq(badFiles.releaseGuid, releaseGuid)),
    )
    .get()
}

/**
 * Removes a flag by its primary key, scoped to the media id it was raised
 * against. The scope is load-bearing, not defensive dressing: without it, a
 * caller on `/media/:id/bad-files/:flagId` could delete a flag that belongs
 * to a *different* title by guessing its id, since `id` alone is globally
 * unique across every title's flags. Matching both columns in one query
 * means a mismatched id 404s without ever touching the wrong row. Returns
 * the deleted row, or `undefined` if no such flag existed for that media id.
 */
export function deleteBadFile(
  db: Db,
  mediaId: string,
  id: number,
): BadFileRow | undefined {
  return db
    .delete(badFiles)
    .where(and(eq(badFiles.id, id), eq(badFiles.mediaId, mediaId)))
    .returning()
    .get()
}
