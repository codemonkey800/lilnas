import type { VideoInfo } from '@lilnas/utils/download/types'

import {
  platformName,
  toVideoMetadata,
  uploadDay,
  VIDEO_TAG_LIMIT,
  videoRuntime,
} from 'src/download/video-metadata.util'

describe('platformName', () => {
  it.each([
    ['Youtube', 'YouTube'],
    ['YoutubeTab', 'YouTube'],
    ['TwitchVod', 'Twitch'],
    ['Twitter', 'X'],
    ['TikTok', 'TikTok'],
    ['Instagram', 'Instagram'],
  ])('reads %s as %s', (key, name) => {
    expect(platformName(key)).toBe(name)
  })

  it.each([['Generic'], [''], [null], [undefined]])(
    'names no platform for %p',
    key => {
      expect(platformName(key)).toBeUndefined()
    },
  )
})

describe('uploadDay', () => {
  it('spells yt-dlp’s day as an ISO date', () => {
    expect(uploadDay('20250304')).toBe('2025-03-04')
  })

  it.each([['2025-03-04'], ['202503'], [''], [null]])('drops %p', value => {
    expect(uploadDay(value)).toBeUndefined()
  })
})

describe('videoRuntime', () => {
  it('rounds the source’s duration', () => {
    expect(videoRuntime(61.6, null)).toBe(62)
  })

  it('times a clip by its range, not the source', () => {
    expect(videoRuntime(3600, { end: '01:02:03', start: '00:00:03' })).toBe(
      3720,
    )
  })

  it.each([[0], [-1], [Number.NaN], [null]])(
    'knows no runtime for a duration of %p',
    duration => {
      expect(videoRuntime(duration, null)).toBeUndefined()
    },
  )
})

describe('toVideoMetadata', () => {
  it('maps everything yt-dlp reported', () => {
    const info: VideoInfo = {
      channel: 'MKBHD',
      channel_url: 'https://www.youtube.com/@mkbhd',
      comment_count: 1200,
      duration: 840,
      extractor_key: 'Youtube',
      fps: 29.97,
      height: 1080,
      like_count: 84_000.4,
      tags: ['tech', ' Tech ', 'review', ''],
      title: 'A video',
      upload_date: '20250304',
      view_count: 2_100_000,
      was_live: true,
      width: 1920,
    }

    expect(toVideoMetadata(info)).toEqual({
      fileInfo: { fps: 29.97, resolution: '1920x1080' },
      runtime: 840,
      sourceInfo: {
        channel: 'MKBHD',
        channelUrl: 'https://www.youtube.com/@mkbhd',
        commentCount: 1200,
        likeCount: 84_000,
        platform: 'YouTube',
        publishedAt: '2025-03-04',
        tags: ['tech', 'review'],
        viewCount: 2_100_000,
        wasLive: true,
      },
    })
  })

  it('falls back to the uploader when there is no channel', () => {
    expect(
      toVideoMetadata({
        uploader: 'someone',
        uploader_url: 'https://www.tiktok.com/@someone',
      }).sourceInfo,
    ).toEqual({
      channel: 'someone',
      channelUrl: 'https://www.tiktok.com/@someone',
    })
  })

  it('caps the tags', () => {
    const tags = Array.from({ length: VIDEO_TAG_LIMIT + 5 }, (_, i) => `t${i}`)

    expect(toVideoMetadata({ tags }).sourceInfo?.tags).toHaveLength(
      VIDEO_TAG_LIMIT,
    )
  })

  it('leaves out every part yt-dlp said nothing about', () => {
    expect(
      toVideoMetadata({ description: 'd', title: 't', was_live: false }),
    ).toEqual({})
  })

  it('claims no resolution from a lone dimension', () => {
    expect(toVideoMetadata({ width: 1920 }).fileInfo).toBeUndefined()
  })
})
