import type { TimeRange } from '@lilnas/utils/download/types'
import { eq, inArray } from 'drizzle-orm'

import type { Db } from './db.service'
import { type VideoRow, videos } from './schema'

export function getVideoById(db: Db, id: string): VideoRow | undefined {
  return db.select().from(videos).where(eq(videos.id, id)).get()
}

export function getVideosByIds(db: Db, ids: readonly string[]): VideoRow[] {
  if (ids.length === 0) {
    return []
  }

  return db
    .select()
    .from(videos)
    .where(inArray(videos.id, [...ids]))
    .all()
}

export interface UpdateVideoPatch {
  downloadUrls?: string[]
  overview?: string
  posterUrl?: string
  runtime?: number
  title?: string
}

/**
 * Patches the fields the download pipeline learns as it goes - yt-dlp
 * reports the real title/description partway through, MinIO hands back the
 * download URLs at the end (plan §2.1). Only keys actually present in
 * `patch` are written, so a later step can't blank out an earlier one's
 * value by simply not knowing it.
 *
 * Returns the updated row, or `undefined` if no such video exists.
 */
export function updateVideoById(
  db: Db,
  id: string,
  patch: UpdateVideoPatch,
): VideoRow | undefined {
  const set: Partial<typeof videos.$inferInsert> = { updatedAt: new Date() }

  if (patch.downloadUrls !== undefined) set.downloadUrls = patch.downloadUrls
  if (patch.overview !== undefined) set.overview = patch.overview
  if (patch.posterUrl !== undefined) set.posterUrl = patch.posterUrl
  if (patch.runtime !== undefined) set.runtime = patch.runtime
  if (patch.title !== undefined) set.title = patch.title

  return db.update(videos).set(set).where(eq(videos.id, id)).returning().get()
}

export interface UpsertVideoInput {
  downloadUrls?: string[]
  // Minted by the caller (nanoid()) before the row exists - required even
  // though a conflict discards it, matching `jobs.id`'s convention
  // (schema.ts) of the app minting public ids rather than the DB.
  id: string
  naturalKey: string
  overview?: string
  posterUrl?: string
  runtime?: number
  sourceUrl: string
  timeRange?: TimeRange
  title: string
}

/**
 * Insert-or-update keyed on `videos_natural_key_idx`, not `id` - two calls
 * with the same `(sourceUrl, timeRange)` collapse onto one row, keeping
 * whichever `id` was minted first. `id` is deliberately absent from the
 * `set` clause so a conflicting call can never reassign an existing row's
 * public id.
 */
export function upsertVideoByNaturalKey(
  db: Db,
  input: UpsertVideoInput,
): VideoRow {
  const now = new Date()

  return db
    .insert(videos)
    .values({
      createdAt: now,
      downloadUrls: input.downloadUrls,
      id: input.id,
      naturalKey: input.naturalKey,
      overview: input.overview,
      posterUrl: input.posterUrl,
      runtime: input.runtime,
      sourceUrl: input.sourceUrl,
      timeRange: input.timeRange,
      title: input.title,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        downloadUrls: input.downloadUrls,
        overview: input.overview,
        posterUrl: input.posterUrl,
        runtime: input.runtime,
        title: input.title,
        updatedAt: now,
      },
      target: videos.naturalKey,
    })
    .returning()
    .get()!
}
