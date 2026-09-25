'use client'

import type { JSX } from 'react'

import type { ShowDetailProps } from 'src/components/detail/show-detail'
import { ShowDetail } from 'src/components/detail/show-detail'
import { useLiveMedia } from 'src/lib/use-live-media'

/**
 * `ShowDetail`, kept current off the download gateway.
 *
 * The show twin of `MovieDetailLive`: `ShowDetail` stays a plain function of
 * its props, and this wrapper is the one place that knows they come off a
 * socket. `useLiveMedia` follows the series by **media id**, so a grab this tab
 * did not start (Sonarr's own UI, Discord, another tab) shows up live — an
 * attempt at any scope lands in the Attempts lists, and a media frame's
 * `episodes` move each row's chip and bar, and its season tab's dot, in place.
 * No server re-render.
 */
export function ShowDetailLive({
  jobs,
  media,
  seasons,
  ...props
}: ShowDetailProps): JSX.Element {
  const live = useLiveMedia({ jobs, media, seasons })

  return (
    <ShowDetail
      {...props}
      jobs={live.jobs}
      media={live.media}
      seasons={live.seasons ?? seasons}
      stale={!live.connected}
    />
  )
}
