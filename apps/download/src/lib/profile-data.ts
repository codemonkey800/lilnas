import { DownloadApiError } from '@lilnas/utils/download/client'
import type {
  DownloadJob,
  DownloadPage,
  ProfileResponse,
} from '@lilnas/utils/download/types'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import type { ProfileFilters } from 'src/lib/profile-filters'
import { profileHistoryQuery } from 'src/lib/profile-filters'
import { getRequestInstant } from 'src/lib/request-instant'
import type { Viewer } from 'src/lib/viewer'
import { getViewer } from 'src/lib/viewer'

/**
 * What the page says when `?user=` names somebody this viewer may not see.
 *
 * More specific than `NOT_AUTHORIZED_DESCRIPTION`'s default, because here there
 * *is* something useful to say: the rule is about whose profile it is, and the
 * reader's own profile is one click away.
 */
export const FOREIGN_PROFILE_DESCRIPTION =
  'This profile belongs to someone else. You can only see your own, unless you’re an admin.'

/** What the pagination action says when the same refusal arrives mid-scroll. */
export const FOREIGN_PROFILE_ERROR =
  'You are not allowed to see this profile’s history'

/**
 * Whether a thrown value is the backend refusing `?user=`, as opposed to any
 * other failure.
 *
 * `GET /download/profile` answers 403 for a non-admin naming somebody else — a
 * rule being stated, not a fault — so it is recognized here and rendered as the
 * shared not-authorized panel. Everything else, 401 included, keeps propagating
 * to the error boundary where an unexpected failure belongs.
 *
 * ⚠️ This is also what keeps Next's control-flow throws intact. They carry a
 * `digest` and are not `DownloadApiError`s, so they fall through the `instanceof`
 * and re-throw — the same guard `src/lib/viewer.ts` documents at length.
 */
export function isForbiddenProfileError(error: unknown): boolean {
  return error instanceof DownloadApiError && error.status === 403
}

/**
 * Everything `/profile` needs for one render.
 *
 * A union rather than nullable fields: `forbidden` is the one state with no
 * profile *and* no history, and every other branch has both. Threading that as
 * two independently-nullable properties would let a caller render half a page.
 */
export type ProfileView = {
  /** One pinned instant for every relative stamp on the page. */
  now: number
  /** The email the page is about — `?user=`, or the viewer's own. */
  requester: string
  /** Who is looking. Decides the "you" chip and which avatars link. */
  viewer: Viewer | null
} & (
  | {
      forbidden: false
      history: DownloadPage<DownloadJob>
      profile: ProfileResponse
    }
  | { forbidden: true; history: null; profile: null }
)

/**
 * Loads a profile and the first page of its history.
 *
 * ## The two calls, and why both need the target spelled out
 *
 * Both endpoints read a missing `requester` the same way — "me", meaning the
 * *viewer*. (`getHistory()` does have an every-requester mode, but it is
 * `scope: 'all'`, an admin-only opt-in this page never sets; omitting
 * `requester` has never meant that.) The trouble is that "me" is the wrong
 * default here: this page is just as often somebody else's profile, via
 * `?user=`. So the target is resolved once, here — the URL's `?user=`, or the
 * viewer's own email — and spelled out to both rather than left to either
 * endpoint's default. That also makes the two calls independent, so they run
 * together.
 *
 * ## What a missing identity means
 *
 * `getViewer()` answers `null` only when `whoami` failed, which in practice
 * means no forwarded identity at all. With no `?user=` either there is nobody
 * to compute a profile for, and every call below would answer 401. That is a
 * genuine failure rather than an empty state, so it throws to `error.tsx`.
 *
 * ⚠️ `getIdentifiedDownloadClient()`, never `DownloadClient.localInstance`: the
 * history's `requester` is masked per viewer server-side, and a client with no
 * forwarded identity would be masked as an anonymous service caller — and would
 * be refused its own profile.
 */
export async function loadProfileView(
  filters: ProfileFilters,
): Promise<ProfileView> {
  // Outside the `try`, both of them: `headers()` signals a static-generation
  // bailout by throwing a value carrying a `digest`, and `getViewer` re-throws
  // those rather than reporting "no identity".
  const [viewer, client] = await Promise.all([
    getViewer(),
    getIdentifiedDownloadClient(),
  ])

  const requester = filters.user ?? viewer?.email ?? null

  if (requester === null) {
    throw new Error(
      '/profile needs a signed-in viewer or an explicit ?user=, and has neither',
    )
  }

  const now = getRequestInstant()

  try {
    const [profile, history] = await Promise.all([
      client.getProfile({ requester }),
      client.getHistory(profileHistoryQuery(filters, requester)),
    ])

    return { forbidden: false, history, now, profile, requester, viewer }
  } catch (error) {
    if (!isForbiddenProfileError(error)) {
      throw error
    }

    return {
      forbidden: true,
      history: null,
      now,
      profile: null,
      requester,
      viewer,
    }
  }
}
