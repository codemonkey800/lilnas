'use client'

import type { JSX } from 'react'

import type { ShowDetailProps } from 'src/components/detail/show-detail'
import { ShowDetail } from 'src/components/detail/show-detail'
import { useLiveMediaJobs } from 'src/lib/use-live-media-jobs'

/**
 * `ShowDetail`, re-rendered as Sonarr's queue moves.
 *
 * The show twin of `MovieDetailLive`. A landed job refreshes the page, which
 * also re-reads the seasons, so an episode's file shows up alongside it.
 */
export function ShowDetailLive({
  jobs,
  ...props
}: ShowDetailProps): JSX.Element {
  return <ShowDetail {...props} jobs={useLiveMediaJobs(jobs)} />
}
