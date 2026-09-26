import '@testing-library/jest-dom'

import type { Video } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'

import {
  VIDEO_DETAILS_HEADING,
  VIDEO_FILE_HEADING,
  VIDEO_LIVE_LABEL,
  VIDEO_STATS_NOTE,
  VIDEO_TAG_DISPLAY_LIMIT,
  VideoFacts,
  videoFileFacts,
  videoFileLine,
  videoInfoFacts,
  videoStatParts,
} from 'src/components/detail/video-facts'

const OBJECT_URL = 'https://storage.example.com/videos/job-1/part0.mp4'

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video:V1StGXR8_Z5',
    sourceUrl: 'https://www.youtube.com/watch?v=abc',
    title: 'Sourdough starter, day one to seven',
    type: DownloadType.Video,
    ...overrides,
  }
}

/** A card's rows as `label -> text`, in order. */
function rows(heading: string): [string, string][] {
  const card = screen.getByRole('region', { name: heading })

  return within(card)
    .getAllByRole('term')
    .map(term => [
      term.textContent ?? '',
      term.nextElementSibling?.textContent ?? '',
    ])
}

describe('videoStatParts', () => {
  it('abbreviates each count it has', () => {
    expect(
      videoStatParts(
        video({ commentCount: 1234, likeCount: 84_000, viewCount: 2_100_000 }),
      ),
    ).toEqual(['2.1M views', '84K likes', '1.2K comments'])
  })

  it('keeps a zero, which is a real count', () => {
    expect(videoStatParts(video({ likeCount: 0 }))).toEqual(['0 likes'])
  })
})

describe('videoFileLine', () => {
  it('reads resolution then frame rate', () => {
    expect(videoFileLine({ fps: 29.97, resolution: '1920x1080' })).toBe(
      '1920×1080 · 29.97 fps',
    )
  })

  it('is null with neither', () => {
    expect(videoFileLine({ size: 10 })).toBeNull()
  })
})

describe('VideoFacts', () => {
  it('draws both cards in reading order', () => {
    render(
      <VideoFacts
        media={video({
          channel: 'slowferment',
          channelUrl: 'https://www.youtube.com/@slowferment',
          downloadUrls: [OBJECT_URL, OBJECT_URL],
          file: { fps: 30, resolution: '1920x1080', size: 5 * 1024 ** 2 },
          publishedAt: '2025-03-04',
          tags: ['bread', 'baking'],
          timeRange: { end: '00:01:30', start: '00:00:10' },
          viewCount: 1500,
          wasLive: true,
        })}
      />,
    )

    expect(rows(VIDEO_FILE_HEADING)).toEqual([
      ['Video', '1920×1080 · 30 fps'],
      ['Size', '5.0 MB'],
      ['Parts', '2'],
    ])
    expect(rows(VIDEO_DETAILS_HEADING)).toEqual([
      ['Channel', 'slowferment'],
      ['Published', 'Mar 4, 2025'],
      ['Stats', `1.5K views (${VIDEO_STATS_NOTE})`],
      ['Origin', VIDEO_LIVE_LABEL],
      ['Clip', '00:00:10–00:01:30'],
      ['Tags', 'breadbaking'],
    ])
    expect(screen.getByRole('link', { name: 'slowferment' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/@slowferment',
    )
  })

  it('renders nothing for a video fetched before metadata was kept', () => {
    const { container } = render(<VideoFacts media={video()} />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('videoInfoFacts', () => {
  it('⚠️ names the channel without linking a URL that is not http(s)', () => {
    render(
      <>
        {videoInfoFacts(
          video({ channel: 'x', channelUrl: 'javascript:alert(1)' }),
        ).map(row => (
          <div key={row.label}>{row.value}</div>
        ))}
      </>,
    )

    expect(screen.getByText('x')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('draws only the first tags', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `tag${i}`)
    const row = videoInfoFacts(video({ tags })).find(r => r.label === 'Tags')

    render(<>{row?.value}</>)

    expect(screen.getAllByText(/^tag\d+$/)).toHaveLength(
      VIDEO_TAG_DISPLAY_LIMIT,
    )
  })
})

describe('videoFileFacts', () => {
  it('has no rows without a file', () => {
    expect(videoFileFacts(video({ downloadUrls: [OBJECT_URL] }))).toEqual([])
  })
})
