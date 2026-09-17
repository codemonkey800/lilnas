'use server'

import { loadAdminHistory } from 'src/lib/admin-data'
import type { LoadAdminHistoryResult } from 'src/lib/admin-filters'
import {
  ADMIN_HISTORY_FORBIDDEN,
  parseAdminFilters,
} from 'src/lib/admin-filters'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { getViewer } from 'src/lib/viewer'

/**
 * Appends one page to the admin dashboard's history table.
 *
 * A server action rather than a `fetch` from the browser, for the same reason
 * every other read-with-identity in this app is one: the backend answers
 * `GET /download/history` against `X-Forwarded-User`, and only the server side
 * of Next holds that header. A direct call from the browser would arrive
 * unattributed and 401.
 *
 * ⚠️ **The admin gate is re-checked here, not inherited from the page.** A
 * server action is a real public endpoint — the page component's
 * `getViewer()?.isAdmin` branch says nothing about who may call this. The
 * backend gates it too (`getHistory` 403s a non-admin asking for somebody else
 * *or* for `scope=all`), so this check is not the only thing standing between a
 * non-admin and other people's data; it is what stops this action from being a
 * quieter way to ask the same question.
 *
 * The filter arrives as the raw query string the page is currently at and is
 * re-parsed here rather than accepted as a structured object, so a crafted call
 * can only ever describe a filter the URL could have described anyway.
 */
export async function loadAdminHistoryPage(
  search: string,
  cursor: string,
): Promise<LoadAdminHistoryResult> {
  const filters = parseAdminFilters(new URLSearchParams(search))

  // Outside the `try`: `headers()` signals a static-generation bailout by
  // throwing a value carrying a `digest`, and swallowing one of those would
  // turn "render this route dynamically" into a user-facing error message. See
  // the same note in `src/app/actions/load-gallery-page.ts`.
  const [client, viewer] = await Promise.all([
    getIdentifiedDownloadClient(),
    getViewer(),
  ])

  if (!viewer?.isAdmin) {
    return { error: ADMIN_HISTORY_FORBIDDEN }
  }

  try {
    const page = await loadAdminHistory(client, filters, cursor)

    return {
      items: page.items,
      nextCursor: page.nextCursor,
      total: page.total,
    }
  } catch (error) {
    console.error('[load-admin-history] GET /download/history failed', error)

    return { error: 'Could not load more — try again' }
  }
}
