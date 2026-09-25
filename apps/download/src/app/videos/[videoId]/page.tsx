import { DownloadApiError } from '@lilnas/utils/download/client'
import type { MediaDetailResponse } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { notFound } from 'next/navigation'
import type { JSX } from 'react'

import {
  cancelVideoJob,
  deleteVideoJob,
  pauseVideoJob,
  resumeVideoJob,
  retryVideoJob,
} from 'src/app/actions/video-job'
import { LibraryLink } from 'src/components/detail/library-link'
import { VideoDetailShell } from 'src/components/detail/video-detail'
import { VideoDetailLive } from 'src/components/detail/video-detail-live'
import { JobEventsProvider } from 'src/components/live/job-events'
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
 *
 * ## Where `<JobEventsProvider>` is mounted, and why here
 *
 * At this page's own root, wrapping only `VideoDetailLive` — deliberately
 * **not** in `layout.tsx`. The provider owns the socket, so mounting it
 * app-wide would open a gateway connection on every route including the ones
 * that want no live data at all. `/activity` made exactly this call and this
 * page copies it: the page that needs the feed is the page that pays for it,
 * and it opens exactly one connection however many consumers sit inside,
 * because `useJobEvents()` throws without an ancestor rather than quietly
 * opening a second.
 *
 * This is the page that most needs it. A user pastes a link in the nav bar,
 * the POST creates the job and redirects *here* — so this is the first thing
 * they see after starting a download, and until now it was a plain server
 * render that only moved when they reloaded it.
 *
 * ⚠️ The provider sits **outside** everything below it and nothing between it
 * and `VideoDetailLive` carries a React `key`. That ordering is load-bearing
 * rather than incidental: a `key` above the provider would tear the socket
 * down and rebuild the store on every change of that key, and each teardown
 * starts the reconnect backoff ladder (1s, 2s, 4s, 8s, 15s) over from the top
 * — so the page would go quiet for progressively longer at exactly the moments
 * it re-rendered. `/activity` keeps its feed's `key` strictly inside the
 * provider for the same reason. Any future need to remount this body belongs
 * on `VideoDetailLive`, never above it.
 *
 * Nothing else changes: the route resolution, the `getMedia` read, the type
 * narrowing and the pinned instant all stay on the server, and the server
 * actions are passed through by reference.
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
      <JobEventsProvider>
        <VideoDetailLive
          jobs={jobs}
          media={media}
          now={getRequestInstant()}
          onCancel={cancelVideoJob}
          onDelete={deleteVideoJob}
          onPause={pauseVideoJob}
          onResume={resumeVideoJob}
          onRetry={retryVideoJob}
        />
      </JobEventsProvider>
    </VideoDetailShell>
  )
}
