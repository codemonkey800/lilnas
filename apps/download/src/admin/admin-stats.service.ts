import type {
  AdminStatsQuery,
  AdminStatsResponse,
} from '@lilnas/utils/download/types'
import { Injectable } from '@nestjs/common'

import { DbService } from 'src/db/db.service'
import {
  countJobsByDay,
  countJobsByRequester,
  countJobsByStatus,
  countJobsByType,
  type JobListFilter,
} from 'src/db/jobs.repo'

/**
 * How many rows `topRequesters` is truncated to. A leaderboard, not a user
 * directory: the dashboard renders a fixed-height list, and an unbounded
 * array would grow with every person who ever used the service while adding
 * nothing to the panel.
 */
export const TOP_REQUESTERS_LIMIT = 20

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The aggregate half of the admin dashboard - `GET /download/admin/stats`.
 *
 * Two deliberate asymmetries, both spec'd rather than incidental:
 *
 * 1. **Only `jobsPerDay` is windowed.** `days` shapes the activity chart and
 *    nothing else; the totals and the "top downloaders" leaderboard are
 *    all-time, because a lifetime total that silently means "the last 30
 *    days" is the kind of number people quote wrongly. `windowDays` echoes
 *    the applied window so the response says which series it describes.
 *
 * 2. **No `excludeHiddenVideos`, anywhere.** Every other requester-facing
 *    aggregate passes that flag to keep a hidden uploader from being
 *    inferred (see `JobQueryService.getGalleryFacets`). This surface is the
 *    exception by design: it exists to show true attribution to admins, and
 *    `AdminGuard` on the controller is what makes that safe. Nothing here
 *    returns a job object either, so there is no `projectJobForViewer` mask
 *    to apply - only counts and, on the sibling route, audit rows.
 */
@Injectable()
export class AdminStatsService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Synchronous, like every other read that goes straight at the repos -
   * better-sqlite3's driver has no async surface, so a promise here would be
   * decoration.
   *
   * The four aggregates are returned exactly as the repos produce them:
   * **sparse**, never zero-filled. A status nobody has hit, or a
   * `(day, type)` pair with no jobs, is absent rather than `{ count: 0 }` -
   * which is what `AdminStatsResponse` documents ("a row that never occurred
   * in the window is simply absent"), and densifying here would mean
   * inventing rows the client would have to distinguish from real zeroes
   * anyway. Callers that need a continuous x-axis fill their own gaps.
   *
   * `totalJobs` is derived by summing `totalsByType` rather than issuing a
   * fifth `COUNT(*)`: both run over the same unfiltered set, so the sum is
   * the same number, and deriving it makes the panel's total and its type
   * breakdown incapable of disagreeing.
   */
  getStats(query: AdminStatsQuery): AdminStatsResponse {
    const { db } = this.dbService

    // Windows the activity chart only. `Date.now()` rather than a
    // midnight-aligned boundary: `days` is documented as "a rolling window
    // measured in whole days back from now" (AdminStatsQuerySchema), so the
    // oldest bucket is a partial UTC day and is expected to be.
    const windowFilter: JobListFilter = {
      createdFrom: new Date(Date.now() - query.days * MS_PER_DAY),
    }
    // Empty on purpose - see the class comment. Named so a future edit has
    // to say out loud that it is narrowing an all-time figure.
    const allTimeFilter: JobListFilter = {}

    const totalsByType = countJobsByType(db, allTimeFilter)

    return {
      jobsPerDay: countJobsByDay(db, windowFilter),
      topRequesters: this.rankRequesters(allTimeFilter),
      totalJobs: totalsByType.reduce((total, row) => total + row.count, 0),
      totalsByStatus: countJobsByStatus(db, allTimeFilter),
      totalsByType,
      windowDays: query.days,
    }
  }

  /**
   * `countJobsByRequester()` groups but does not order, so the ranking is
   * this layer's job. Sorted by count descending with the email as a
   * tiebreak, which keeps the cut at {@link TOP_REQUESTERS_LIMIT}
   * deterministic when several people sit on the same count - otherwise
   * whoever fell off the list would depend on SQLite's grouping order and
   * the panel would reshuffle between identical requests.
   *
   * Also renames `email` -> `requesterEmail` for the wire shape; service
   * jobs (a null requester) are already dropped by the repo rather than
   * bucketed as "unknown".
   */
  private rankRequesters(
    filter: JobListFilter,
  ): AdminStatsResponse['topRequesters'] {
    return countJobsByRequester(this.dbService.db, filter)
      .map(row => ({ count: row.count, requesterEmail: row.email }))
      .sort(
        (a, b) =>
          b.count - a.count || a.requesterEmail.localeCompare(b.requesterEmail),
      )
      .slice(0, TOP_REQUESTERS_LIMIT)
  }
}
