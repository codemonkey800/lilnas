'use server'

import { DownloadApiError } from '@lilnas/utils/download/client'
import { redirect } from 'next/navigation'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { mediaHref } from 'src/lib/media-route'
import { classifyQuery } from 'src/lib/url-classify'

/**
 * What the action answers with when it could **not** start the download.
 *
 * There is deliberately no success shape. On success the action never returns
 * at all: `redirect()` throws, Next turns that into a navigation, and the
 * awaited call on the *client* resolves to `undefined`. That `undefined` is why
 * {@link startVideoDownload} is typed `| undefined` — the type is the contract
 * with the caller, and the caller genuinely does observe it. "Resolved with a
 * value" therefore means "failed", and rendering `error` is the caller's only
 * job.
 *
 * ⚠️ This is a `'use server'` module, so it may export nothing but async
 * functions — the error copy below is module-private rather than an exported
 * constant for that reason. An `export const` here is a build error, not a
 * style choice.
 */
export type StartVideoDownloadResult = { error: string }

/**
 * Deliberately short, and in the register `search.pug`'s only error idiom uses
 * (`font-mono text-[11px] text-bad`, a clause rather than a paragraph). The
 * field it renders under is 32px tall in a nav bar; there is no room for
 * prose, and the detailed "yt-dlp didn't recognise this" story belongs on the
 * detail page once a job exists (spec §8), not here.
 */
const NOT_A_LINK = 'That is not a link we can download'
const CREATE_FAILED = 'Could not start that download — try again'

/**
 * Create the video job for a pasted link and go to its detail page, where
 * extraction and the download both start (spec §2, §8).
 *
 * The redirect target is derived through {@link mediaHref} from the job's own
 * `media`, not assembled from a string: `media.id` is `video:<nanoid>` and
 * `mediaHref` is the single place that knows the `video:` → `/videos/…`
 * mapping. Hand-stripping the prefix here would be a second one.
 */
export async function startVideoDownload(
  url: string,
): Promise<StartVideoDownloadResult | undefined> {
  // Re-classified server-side rather than trusted. A server action is a real
  // public endpoint — the browser is not the only thing that can call it — and
  // this is also what normalizes a scheme-less `youtube.com/watch?v=…` into
  // the absolute URL `CreateDownloadJobInputSchema.url` (`z.string().url()`)
  // demands. Doing it here rather than only in the field means the two can
  // never drift.
  const classified = classifyQuery(url)

  if (classified.kind !== 'url') {
    return { error: NOT_A_LINK }
  }

  // ⚠️ `getIdentifiedDownloadClient()`, never `DownloadClient.localInstance`.
  // The plain local client drops the `X-Forwarded-User`/`X-Forwarded-User-Id`
  // pair Traefik set on this request, and every job started from the web UI
  // would persist as an unattributed service call. See `download-client.ts`.
  //
  // Outside the `try` on purpose: `headers()` signals a static-generation
  // bailout by *throwing* a value carrying a `digest`, exactly like
  // `redirect()` does, and `src/lib/viewer.ts` documents why swallowing one of
  // those is never right. Keeping it out here means the `try` below wraps
  // precisely one call — one that can only ever throw a real failure.
  const client = await getIdentifiedDownloadClient()

  let href: string

  try {
    const job = await client.createJob({ url: classified.url })

    href = mediaHref(job.media)
  } catch (error) {
    console.error('[start-video-download] POST /download/videos failed', error)

    // A 400 is the body schema rejecting the URL, which is a different story
    // for the user than "the backend is down": one is fixable by pasting
    // something else, the other is not fixable by them at all.
    return {
      error:
        error instanceof DownloadApiError && error.status === 400
          ? NOT_A_LINK
          : CREATE_FAILED,
    }
  }

  // Outside the `try`, and it has to stay there: `redirect()` works by
  // throwing, so a `catch` around it would turn every successful download into
  // the generic failure message above and strand the user on the page they
  // started from.
  redirect(href)
}
