'use client'

import type { JSX } from 'react'

import type { VideoDetailProps } from 'src/components/detail/video-detail'
import { VideoDetail } from 'src/components/detail/video-detail'
import { useLiveMedia } from 'src/lib/use-live-media'

/**
 * Everything `VideoDetail` takes except `stale`, which is derived here rather
 * than passed: it is `!connected` off the socket, and a caller supplying its
 * own would be claiming to know something only the provider does.
 *
 * `jobs` and `media` are `MediaDetailResponse` verbatim from the server
 * render — the page's starting truth, which live frames for this video then
 * replace.
 */
export type VideoDetailLiveProps = Omit<VideoDetailProps, 'stale'>

/**
 * `VideoDetail`, re-rendered as the download actually progresses.
 *
 * This is the whole client half of `/videos/<videoId>`, and it is deliberately
 * the *only* thing that crosses the boundary: the page stays a Server
 * Component that resolves the route, reads `GET /download/media/:id`, pins the
 * render instant and passes its server actions straight through. Everything
 * here is a function of the props plus one socket read.
 *
 * ## By media id, not by job id
 *
 * `useLiveMedia` subscribes on the video's `video:` key, so two things reach
 * this page that an id-keyed job filter never could:
 *
 * - **The video's own state.** The server sends a media frame alongside every
 *   video job event, carrying the `Video` with its `state` and
 *   `downloadUrls` — which is what flips the chip to `downloaded` and swaps
 *   the poster for the player, with no server re-render.
 * - **Attempts this page was not rendered with.** A re-paste of the same link
 *   from another tab or Discord mints a new job for the same `video:` key;
 *   it lands in the Attempts list, newest first, as it starts.
 *
 * ## Why a wrapper rather than a hook call inside `VideoDetail`
 *
 * `useLiveMedia` reads the provider's store, and `useJobEvents` under it
 * throws without a `<JobEventsProvider>` ancestor — by design, since the
 * provider owns the socket and a silent fallback would let every call site
 * quietly open another connection. Calling it inside `VideoDetail` would make
 * that structural requirement viral: the component could no longer be
 * rendered by a test, a loading skeleton or any future server caller without
 * standing up a provider first. Split this way, `VideoDetail` stays a plain
 * presentational function of its props, and this file is the thin layer that
 * knows where they come from.
 */
export function VideoDetailLive({
  jobs,
  media,
  ...props
}: VideoDetailLiveProps): JSX.Element {
  const live = useLiveMedia({ jobs, media })

  return (
    <VideoDetail
      {...props}
      jobs={live.jobs}
      media={live.media}
      stale={!live.connected}
    />
  )
}
