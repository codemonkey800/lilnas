import type { ProfileResponse } from '@lilnas/utils/download/types'
import { Injectable } from '@nestjs/common'

import { DbService } from 'src/db/db.service'
import {
  countJobsByDay,
  countJobsByStatus,
  countJobsByType,
  getRequesterActivityBounds,
  type JobListFilter,
} from 'src/db/jobs.repo'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The aggregate half of the user profile page - `GET /download/profile`.
 * Modeled on `AdminStatsService`, with the same two deliberate asymmetries:
 *
 * 1. **Only `jobsPerDay` is windowed.** `days` shapes the activity trend and
 *    nothing else; the totals and the first/last timestamps are all-time.
 *    `windowDays` echoes the applied window so the response says which
 *    series it describes.
 *
 * 2. **No `excludeHiddenVideos`, anywhere.** The route's self-or-admin 403
 *    (see `DownloadController.getProfile`) is what satisfies plan 012's
 *    attribution-oracle guard: a non-admin can never aim these aggregates at
 *    another user, so there is no cross-user surface for a hidden video's
 *    count to leak through - and the self view deliberately includes the
 *    caller's own hidden videos, which are only hidden from *other* people.
 *    If access ever widens beyond self-or-admin, every aggregate here must
 *    gain the flag (see `JobQueryService.listGallery` for the pattern).
 *
 * There is no `users` table - this is a computed view over `jobs`, so an
 * email with no jobs yields an empty profile (nulls and empty arrays),
 * never a 404.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Synchronous, like every read that goes straight at the repos -
   * better-sqlite3's driver has no async surface.
   *
   * `email` is passed to the filters verbatim: `buildJobWhere()` already
   * matches requester emails case-insensitively, so lowering it here would
   * be a second, redundant normalization. It is also echoed verbatim into
   * `user.email` - the response names the target the controller resolved,
   * in the casing it resolved it.
   *
   * Aggregates are **sparse**, never zero-filled - the same contract as
   * `AdminStatsResponse`; callers densify their own series.
   */
  getProfile(params: { email: string; days: number }): ProfileResponse {
    const { db } = this.dbService
    const { days, email } = params

    // Windows the activity trend only. `Date.now()` rather than a
    // midnight-aligned boundary: `days` is a rolling window measured back
    // from now (ProfileQuerySchema), so the oldest bucket is a partial UTC
    // day and is expected to be.
    const windowFilter: JobListFilter = {
      createdFrom: new Date(Date.now() - days * MS_PER_DAY),
      requesterEmail: email,
    }
    // Scoped to the user but unwindowed - named so a future edit has to say
    // out loud that it is narrowing an all-time figure.
    const allTimeFilter: JobListFilter = { requesterEmail: email }

    const bounds = getRequesterActivityBounds(db, email)

    return {
      user: { email },
      firstDownloadAt: toIso(bounds.firstCreatedAtMs),
      lastDownloadAt: toIso(bounds.lastCreatedAtMs),
      jobsPerDay: countJobsByDay(db, windowFilter),
      totalsByStatus: countJobsByStatus(db, allTimeFilter),
      totalsByType: countJobsByType(db, allTimeFilter),
      windowDays: days,
    }
  }
}

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}
