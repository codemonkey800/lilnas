'use client'

import type { JSX } from 'react'

import type { MovieDetailProps } from 'src/components/detail/movie-detail'
import { MovieDetail } from 'src/components/detail/movie-detail'
import { useLiveMedia } from 'src/lib/use-live-media'

/**
 * `MovieDetail`, kept current off the download gateway.
 *
 * The client half of `/movies/<tmdbId>`: `MovieDetail` stays a plain function
 * of its props that renders without a `<JobEventsProvider>`, and this wrapper
 * is the one place that knows they come off a socket. `useLiveMedia` follows
 * the movie by **media id**, so a download this tab did not start (Radarr's
 * own UI, Discord, another tab) shows up live, and a media frame carries the
 * new state, file and queue snapshot itself — no server re-render.
 */
export function MovieDetailLive({
  jobs,
  media,
  ...props
}: MovieDetailProps): JSX.Element {
  const live = useLiveMedia({ jobs, media })

  return (
    <MovieDetail
      {...props}
      jobs={live.jobs}
      media={live.media}
      stale={!live.connected}
    />
  )
}
