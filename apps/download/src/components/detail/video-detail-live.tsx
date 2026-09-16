'use client'

import type { JSX } from 'react'

import type { VideoDetailProps } from 'src/components/detail/video-detail'
import { mergeVideoJobs, VideoDetail } from 'src/components/detail/video-detail'
import { useJobEvents } from 'src/lib/use-job-events'

/**
 * Everything `VideoDetail` takes except `stale`, which is derived here rather
 * than passed: it is `!connected` off the socket, and a caller supplying its
 * own would be claiming to know something only the provider does.
 *
 * `jobs` is `MediaDetailResponse.jobs` verbatim from the server render — the
 * page's starting truth and, because the subscription is keyed on these ids,
 * also the full set of jobs this component will ever show. See
 * {@link mergeVideoJobs}.
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
 * ## Why a wrapper rather than a hook call inside `VideoDetail`
 *
 * `useJobEvents` throws without a `<JobEventsProvider>` ancestor — by design,
 * since the provider owns the socket and a silent fallback would let every
 * call site quietly open another connection. Calling it inside `VideoDetail`
 * would make that structural requirement viral: the component could no longer
 * be rendered by a test, a loading skeleton or any future server caller
 * without standing up a provider first. Split this way, `VideoDetail` stays a
 * plain presentational function of `jobs`, and this file is the thin layer
 * that knows where jobs come from.
 *
 * ## No state, and none needed
 *
 * There is no `useState` and no `useEffect` in here. `useJobEvents` is already
 * a `useSyncExternalStore` over the provider's store, so the live job map *is*
 * the external state and re-rendering on a frame is the subscription doing its
 * job. The merge is a pure function of two props-shaped values, computed in
 * render.
 *
 * The inline `jobIds` array is safe and is the documented call shape: the
 * filter never reaches the socket, and `useJobEvents` keys the interest on the
 * array's sorted *contents* rather than its identity, so a fresh array every
 * render re-subscribes nothing.
 */
export function VideoDetailLive({
  jobs,
  ...props
}: VideoDetailLiveProps): JSX.Element {
  const { connected, jobs: live } = useJobEvents({
    jobIds: jobs.map(job => job.id),
  })

  return (
    <VideoDetail
      {...props}
      jobs={mergeVideoJobs(jobs, live)}
      stale={!connected}
    />
  )
}
