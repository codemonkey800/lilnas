import { DownloadApiError } from '@lilnas/utils/download/client'
import type { MediaDetailResponse } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { notFound } from 'next/navigation'
import type { JSX } from 'react'

import {
  cancelVideoJob,
  pauseVideoJob,
  resumeVideoJob,
  retryVideoJob,
} from 'src/app/actions/video-job'
import { LibraryLink } from 'src/components/detail/library-link'
import {
  VideoDetail,
  VideoDetailShell,
} from 'src/components/detail/video-detail'
import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { mediaIdFromRoute } from 'src/lib/media-route'
import { getRequestInstant } from 'src/lib/request-instant'

/**
 * Static rather than a `generateMetadata` that names the video.
 *
 * A dynamic title would need a second `getMedia` for the same key — the read
 * below is not wrapped in `React.cache`, and wrapping it would buy one page
 * title at the cost of a shared module every detail route then has to agree
 * on. The document title is not where this page's identity lives; the `<h1>`
 * is.
 */
export const metadata = {
  title: 'Video · Download',
}

export type VideoDetailPageProps = {
  params: Promise<{ videoId: string }>
}

/**
 * The detail read, with the one failure that is not an error peeled off.
 *
 * ⚠️ `GET /download/media/:id` answers an unknown `video:` key with a **404**,
 * unlike a `tmdb:`/`tvdb:` key which always resolves to something: a video
 * cannot exist before somebody downloaded it, so there is no metadata lookup
 * to fall back on. That 404 is a genuine "no such page", not a service
 * failure, so it becomes `notFound()` and everything else propagates to the
 * error boundary.
 *
 * `notFound()` is called from the `catch` rather than inside the `try`, which
 * is what keeps it from catching its own throw — it signals by throwing a
 * value carrying a `digest`, exactly like `redirect()`.
 */
async function loadVideoDetail(mediaId: string): Promise<MediaDetailResponse> {
  // ⚠️ `getIdentifiedDownloadClient()`, never `DownloadClient.localInstance` —
  // a plain local call drops the `X-Forwarded-User` pair Traefik set on this
  // request. See `download-client.ts`.
  const client = await getIdentifiedDownloadClient()

  try {
    return await client.getMedia(mediaId)
  } catch (error) {
    if (error instanceof DownloadApiError && error.status === 404) {
      notFound()
    }

    throw error
  }
}

/**
 * `/videos/<videoId>` — a video's permalink: where it came from, who fetched
 * it, what its download is doing, and the player once there is something to
 * play.
 *
 * Three ways in and all of them land here: the nav bar's paste (which creates
 * the job and redirects), a gallery card, and a bare deep link. A re-paste of
 * the same URL lands here too rather than on a second page — `videos` is
 * uniquely indexed on its natural key, so one source URL is always one
 * `video:<id>` and the earlier attempts are already in `jobs`.
 *
 * The back affordance is `LibraryLink` in the page body, which is what the
 * mockups' `libraryLink` mixin is — an in-page control, not an app-bar one.
 * `AppBar`'s own `back` prop is deliberately left unwired.
 */
export default async function VideoDetailPage({
  params,
}: VideoDetailPageProps): Promise<JSX.Element> {
  const { videoId } = await params

  // `mediaIdFromRoute` returns `null` rather than throwing for a segment that
  // is not a plain nanoid, and that rejection is the security boundary for
  // this mapping: without it `/videos/tmdb%3A438631` would concatenate into
  // `video:tmdb:438631` and aim a video-scoped route at another id space.
  const mediaId = mediaIdFromRoute('videos', videoId)

  if (!mediaId) {
    notFound()
  }

  const { jobs, media } = await loadVideoDetail(mediaId)

  // Belt and braces against the prefix and the payload disagreeing. The
  // `video:` key can only resolve to a `Video` today, but this is also what
  // narrows the union for `VideoDetail`, which needs `sourceUrl`.
  if (media.type !== DownloadType.Video) {
    notFound()
  }

  return (
    <VideoDetailShell>
      {/*
        `DetailHeader` renders the title as a `<p class="text-h1">` — the
        mockups' own markup — so the document's one heading is here, for a
        screen reader only. The same split `/gallery` makes.
      */}
      <h1 className="sr-only">{media.title}</h1>
      <LibraryLink />
      <VideoDetail
        jobs={jobs}
        media={media}
        now={getRequestInstant()}
        onCancel={cancelVideoJob}
        onPause={pauseVideoJob}
        onResume={resumeVideoJob}
        onRetry={retryVideoJob}
      />
    </VideoDetailShell>
  )
}
