import { DownloadType } from '@lilnas/utils/download/types'
import type { Logger } from '@nestjs/common'

import { listFlaggedReleaseTitles } from 'src/db/bad-files.repo'
import type { Db } from 'src/db/db.service'

import { KeyedMutex } from './keyed-mutex.util'

/** What `RadarrService`/`SonarrService` offer for the flagged profile. */
export interface FlaggedReleaseProfileOwner {
  syncFlaggedReleaseProfile(titles: string[]): Promise<void>
}

// - One sync per app at a time, each reading `bad_files` only once it holds
//   the lock: two flags in quick succession can't PUT out of order and leave
//   the older list standing, and two first-ever flags can't both create the
//   profile. A module singleton for the same reason as `mediaMutex`.
const flaggedReleaseMutex = new KeyedMutex()

// - `mediaId`/guid of every untitled flag already warned about, so each is
//   logged once per process rather than on every sync
const reportedUntitled = new Set<string>()

/**
 * Plan 024. Mirrors every flag of `mediaType` into its app's "flagged
 * releases" profile (see `FLAGGED_RELEASE_PROFILE_NAME`): reads the full
 * current title list and hands it to `owner`. Flags with no title anywhere
 * are skipped - logged once each.
 *
 * Rejects when the app does; callers decide how loud that is.
 */
export function syncFlaggedReleases(
  db: Db,
  mediaType: DownloadType,
  owner: FlaggedReleaseProfileOwner,
  logger: Logger,
): Promise<void> {
  return flaggedReleaseMutex.run(mediaType, async () => {
    const { titles, untitled } = listFlaggedReleaseTitles(db, mediaType)

    const fresh = untitled.filter(row => {
      const key = `${row.mediaId}|${row.releaseGuid}`
      if (reportedUntitled.has(key)) return false
      reportedUntitled.add(key)
      return true
    })

    if (fresh.length > 0) {
      logger.warn(
        `${fresh.length} flagged ${mediaType} release(s) have no title, so ${appName(mediaType)} can't be told to reject them: ${fresh
          .map(row => `${row.mediaId} ${row.releaseGuid}`)
          .join(', ')}`,
      )
    }

    await owner.syncFlaggedReleaseProfile(titles)
  })
}

function appName(mediaType: DownloadType): string {
  return mediaType === DownloadType.Movie ? 'Radarr' : 'Sonarr'
}
