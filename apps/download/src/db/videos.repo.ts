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
