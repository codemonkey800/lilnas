import { DownloadType } from '@lilnas/utils/download/types'

import { mediaId, videoNaturalKey } from 'src/db/media-id'

describe('videoNaturalKey', () => {
  it('combines the source URL and time range into one key', () => {
    expect(
      videoNaturalKey({
        sourceUrl: 'https://example.com/a',
        timeRange: { end: '00:01:00', start: '00:00:00' },
      }),
    ).toBe('https://example.com/a#00:00:00-00:01:00')
  })

  it('produces a stable `#-` suffix when no time range is given', () => {
    expect(videoNaturalKey({ sourceUrl: 'https://example.com/a' })).toBe(
      'https://example.com/a#-',
    )
  })

  it('gives a clip a different key than its full-length sibling', () => {
    const full = videoNaturalKey({ sourceUrl: 'https://example.com/a' })
    const clip = videoNaturalKey({
      sourceUrl: 'https://example.com/a',
      timeRange: { end: '00:01:00', start: '00:00:00' },
    })

    expect(full).not.toBe(clip)
  })

  it("matches the backfill migration's COALESCE expression byte-for-byte", () => {
    // migration 0003's expression is:
    //   url || '#' || COALESCE(json_extract(time_range,'$.start'),'')
    //       || '-'  || COALESCE(json_extract(time_range,'$.end'),'')
    const withStartOnly = videoNaturalKey({
      sourceUrl: 'https://example.com/a',
      timeRange: { end: '', start: '00:00:00' } as never,
    })
    expect(withStartOnly).toBe('https://example.com/a#00:00:00-')
  })
})

describe('mediaId', () => {
  it('derives a movie key from tmdbId', () => {
    expect(mediaId({ tmdbId: 438_631, type: DownloadType.Movie })).toBe(
      'tmdb:438631',
    )
  })

  it('derives a show key from tvdbId', () => {
    expect(mediaId({ tvdbId: 121_361, type: DownloadType.Show })).toBe(
      'tvdb:121361',
    )
  })

  it('derives a video key from the videos row id', () => {
    expect(mediaId({ id: 'V1StGXR8_Z5', type: DownloadType.Video })).toBe(
      'video:V1StGXR8_Z5',
    )
  })

  it('round-trips all three key forms with distinct prefixes', () => {
    const keys = [
      mediaId({ tmdbId: 1, type: DownloadType.Movie }),
      mediaId({ tvdbId: 1, type: DownloadType.Show }),
      mediaId({ id: '1', type: DownloadType.Video }),
    ]

    expect(new Set(keys).size).toBe(3)
    expect(keys).toEqual(['tmdb:1', 'tvdb:1', 'video:1'])
  })
})
