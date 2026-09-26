import { cns } from '@lilnas/utils/cns'
import type { Video, VideoFile } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import type { Fact } from 'src/components/detail/fact-section'
import {
  fact,
  FactCards,
  FactRun,
  facts,
  formatDay,
  httpHref,
  joinFacts,
} from 'src/components/detail/fact-section'
import { Chip } from 'src/components/ui/chip'
import { formatBytes, UNKNOWN_VALUE } from 'src/lib/format'

export const VIDEO_DETAILS_HEADING = 'Details'
export const VIDEO_FILE_HEADING = 'File'

/**
 * Beside the counts: they are yt-dlp's reading at download time and never
 * refreshed, so an old video's `2.1M views` is a snapshot, not a live figure.
 */
export const VIDEO_STATS_NOTE = 'at download'

export const VIDEO_LIVE_LABEL = 'Livestream recording'

/** How many tags are drawn. The rest are the long tail of keyword stuffing. */
export const VIDEO_TAG_DISPLAY_LIMIT = 12

/** `2100000` -> `2.1M`. Locale pinned for the server/browser reason `formatDay` gives. */
const COMPACT_COUNT = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
  notation: 'compact',
})

function counted(value: number | undefined, noun: string): string | null {
  return value === undefined ? null : `${COMPACT_COUNT.format(value)} ${noun}`
}

/** `['2.1M views', '84K likes', '1.2K comments']`. */
export function videoStatParts(video: Video): string[] {
  return [
    counted(video.viewCount, 'views'),
    counted(video.likeCount, 'likes'),
    counted(video.commentCount, 'comments'),
  ].filter((part): part is string => part !== null)
}

/** `1920×1080 · 30 fps`. */
export function videoFileLine(file: VideoFile): string | null {
  return joinFacts([
    file.resolution?.replace('x', '×'),
    file.fps ? `${Number(file.fps.toFixed(3))}\u00a0fps` : null,
  ])
}

/** The `Details` card's rows - who posted it, when, and how it was doing. */
export function videoInfoFacts(video: Video): Fact[] {
  const channelHref = httpHref(video.channelUrl)
  const stats = videoStatParts(video)
  const tags = video.tags?.slice(0, VIDEO_TAG_DISPLAY_LIMIT) ?? []

  return facts([
    fact(
      'Channel',
      video.channel && channelHref ? (
        <a
          className={cns('text-uv-hi hover:underline')}
          href={channelHref}
          rel="noreferrer"
          target="_blank"
        >
          {video.channel}
        </a>
      ) : (
        video.channel
      ),
    ),
    fact('Published', formatDay(video.publishedAt)),
    fact(
      'Stats',
      stats.length > 0 ? (
        <>
          <FactRun parts={stats} />
          <span className={cns('text-ink-4')}>{` (${VIDEO_STATS_NOTE})`}</span>
        </>
      ) : null,
    ),
    fact('Origin', video.wasLive ? VIDEO_LIVE_LABEL : null),
    fact(
      'Clip',
      video.timeRange
        ? `${video.timeRange.start}–${video.timeRange.end}`
        : null,
    ),
    fact(
      'Tags',
      tags.length > 0 ? (
        <span className={cns('flex flex-wrap gap-1.5')}>
          {tags.map(tag => (
            <Chip key={tag} label={tag} tone="mute" />
          ))}
        </span>
      ) : null,
    ),
  ])
}

/** The `File` card's rows - what the rendered download is. */
export function videoFileFacts(video: Video): Fact[] {
  const file = video.file
  const parts = video.downloadUrls?.length ?? 0

  if (!file) {
    return []
  }

  const size = formatBytes(file.size)

  return facts([
    fact('Video', videoFileLine(file)),
    fact('Size', size === UNKNOWN_VALUE ? null : size),
    fact('Parts', parts > 1 ? String(parts) : null),
  ])
}

export type VideoFactsProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  media: Video
}

/**
 * The video page's two reference cards: **File** - the rendered download's
 * resolution, frame rate and size - and **Details** - the channel, publish
 * day, counts and tags yt-dlp reported when it fetched the post.
 *
 * A video fetched before that metadata was recorded has neither, and this
 * renders `null` rather than two empty cards.
 */
export function VideoFacts({
  media,
  ...props
}: VideoFactsProps): JSX.Element | null {
  return (
    <FactCards
      {...props}
      sections={[
        { facts: videoFileFacts(media), heading: VIDEO_FILE_HEADING },
        { facts: videoInfoFacts(media), heading: VIDEO_DETAILS_HEADING },
      ]}
    />
  )
}
