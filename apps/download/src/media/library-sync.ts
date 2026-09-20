import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import type { Logger } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'

import type { Db } from 'src/db/db.service'
import { jobs } from 'src/db/schema'

import type { RadarrService } from './radarr.service'
import type { SonarrService } from './sonarr.service'

export interface LibrarySyncResult {
  moviesAdded: number
  showsAdded: number
}

interface BackfillEntry {
  addedAt: Date
  mediaId: string
}

/**
 * Backfills a `completed` job for every Radarr/Sonarr title that already has
 * a file on disk but no `completed` job of its own - everything present
 * before this app existed, or added directly in Radarr/Sonarr rather than
 * through a request here.
 *
 * The gallery (`job-query.service.ts`, plan §3.2) is built entirely by
 * grouping `jobs` rows - there is deliberately no media table - so without
 * this, "Browse movies/shows" only ever shows titles requested *through this
 * app*, even though Radarr/Sonarr's libraries are the real record of what's
 * downloaded.
 *
 * Run once at boot (see bootstrap.ts), same slot `reconcileInterruptedJobs()`
 * occupies. Idempotent: only inserts a row for a `(type, mediaId)` that has
 * no `completed` job yet, so a rerun on every restart - required for
 * dev-remote's tmpfs `jobs` table, which is rebuilt from scratch every
 * start - never duplicates a title.
 *
 * Best-effort: a Radarr or Sonarr outage at boot must not stop the app from
 * serving anything else, so each upstream fetch is caught and logged rather
 * than thrown.
 */
export async function syncDownloadedLibrary(
  db: Db,
  radarrService: RadarrService,
  sonarrService: SonarrService,
  logger: Logger,
): Promise<LibrarySyncResult> {
  const [movies, shows] = await Promise.all([
    radarrService.getDownloadedMovies().catch((err: unknown) => {
      logger.warn(
        { error: err },
        'Radarr library sync failed at boot; skipping',
      )
      return []
    }),
    sonarrService.getDownloadedSeries().catch((err: unknown) => {
      logger.warn(
        { error: err },
        'Sonarr library sync failed at boot; skipping',
      )
      return []
    }),
  ])

  const moviesAdded = backfillCompletedJobs(
    db,
    DownloadType.Movie,
    movies.map(({ addedAt, movie }) => ({ addedAt, mediaId: movie.id })),
  )
  const showsAdded = backfillCompletedJobs(
    db,
    DownloadType.Show,
    shows.map(({ addedAt, show }) => ({ addedAt, mediaId: show.id })),
  )

  return { moviesAdded, showsAdded }
}

function backfillCompletedJobs(
  db: Db,
  type: DownloadType,
  entries: readonly BackfillEntry[],
): number {
  if (entries.length === 0) return 0

  const alreadyCompleted = new Set(
    db
      .select({ mediaId: jobs.mediaId })
      .from(jobs)
      .where(
        and(
          eq(jobs.type, type),
          eq(jobs.status, DownloadJobStatus.Completed),
          inArray(
            jobs.mediaId,
            entries.map(entry => entry.mediaId),
          ),
        ),
      )
      .all()
      .map(row => row.mediaId),
  )

  const missing = entries.filter(entry => !alreadyCompleted.has(entry.mediaId))
  if (missing.length === 0) return 0

  const now = new Date()

  db.insert(jobs)
    .values(
      missing.map(entry => ({
        completedAt: entry.addedAt,
        createdAt: entry.addedAt,
        error: null,
        hiddenAttribution: false,
        id: nanoid(),
        mediaId: entry.mediaId,
        origin: 'service' as const,
        requesterEmail: null,
        requesterUserId: null,
        scope: null,
        status: DownloadJobStatus.Completed,
        type,
        updatedAt: now,
      })),
    )
    .run()

  return missing.length
}
