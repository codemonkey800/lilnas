'use client'

import type { JSX } from 'react'

import type { MovieDetailProps } from 'src/components/detail/movie-detail'
import { MovieDetail } from 'src/components/detail/movie-detail'
import { useLiveMediaJobs } from 'src/lib/use-live-media-jobs'

/**
 * `MovieDetail`, re-rendered as Radarr's queue moves.
 *
 * The client half of `/movies/<tmdbId>`, split out the same way
 * `VideoDetailLive` is: `MovieDetail` stays a plain function of `jobs` that
 * renders without a `<JobEventsProvider>`, and this wrapper is the one place
 * that knows the jobs come off a socket. See `useLiveMediaJobs` for how a
 * finished download pulls the file and the Watch link in with it.
 */
export function MovieDetailLive({
  jobs,
  ...props
}: MovieDetailProps): JSX.Element {
  return <MovieDetail {...props} jobs={useLiveMediaJobs(jobs)} />
}
