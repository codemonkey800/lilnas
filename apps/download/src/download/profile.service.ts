import type { ProfileResponse } from '@lilnas/utils/download/types'
import { Injectable } from '@nestjs/common'

import { DiscordLinkService } from 'src/auth/discord-link.service'
import { DbService } from 'src/db/db.service'
import {
  countJobsByDay,
  countJobsByStatus,
  countJobsByType,
  getRequesterActivityBounds,
  type JobListFilter,
  type RequesterScope,
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
 *    ⚠️ Plan 017 §E2 widened the scope from one email to
 *    `(email OR linked snowflake)`, which does **not** weaken that argument:
 *    the snowflake is resolved *from the subject's own email* below, so the
 *    widened filter still describes exactly the one person the 403 already
 *    authorized the caller to look at. It is not, and must never become, a
 *    second caller-controlled dimension.
 *
 * There is no `users` table - this is a computed view over `jobs`, so an
 * email with no jobs yields an empty profile (nulls and empty arrays),
 * never a 404.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly dbService: DbService,
    private readonly discordLinkService: DiscordLinkService,
  ) {}

  /**
   * Async as of plan 017 §E2 - the DB reads themselves are still synchronous
   * (better-sqlite3 has no async surface), but the Discord link that decides
   * *which* rows they see has to be fetched first.
   *
   * ⚠️ The link is resolved from the **profile's subject**, not from the
   * viewer. For a self view those are the same person, but an admin looking
   * at somebody else's profile must see *that* person's Discord jobs and not
   * their own - so the lookup is keyed by the `email` this method was asked
   * about, via the email keyspace that exists for exactly this reason.
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
  async getProfile(params: {
    email: string
    days: number
  }): Promise<ProfileResponse> {
    const { db } = this.dbService
    const { days, email } = params

    // Fails open to `null` (DiscordLinkService never rejects), which drops
    // the OR-arm and leaves the profile exactly as it read before this
    // feature - the email half is correct on its own.
    const linkedDiscordUserId =
      await this.discordLinkService.getLinkedDiscordUserIdByEmail(email)

    // The one place the subject's two identities are spelled out; every
    // filter below spreads this rather than re-deriving it, so none of them
    // can end up scoped to a different person than its siblings.
    const scope: RequesterScope = {
      requesterDiscordUserId: linkedDiscordUserId ?? undefined,
      requesterEmail: email,
    }

    // Windows the activity trend only. `Date.now()` rather than a
    // midnight-aligned boundary: `days` is a rolling window measured back
    // from now (ProfileQuerySchema), so the oldest bucket is a partial UTC
    // day and is expected to be.
    const windowFilter: JobListFilter = {
      ...scope,
      createdFrom: new Date(Date.now() - days * MS_PER_DAY),
    }
    // Scoped to the user but unwindowed - named so a future edit has to say
    // out loud that it is narrowing an all-time figure.
    const allTimeFilter: JobListFilter = { ...scope }

    const bounds = getRequesterActivityBounds(db, scope)

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
