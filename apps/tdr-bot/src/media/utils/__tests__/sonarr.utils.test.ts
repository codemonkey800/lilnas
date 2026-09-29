import type { QueueResource, SeriesResource } from '@lilnas/media/sonarr'

import {
  SonarrImageType,
  SonarrSeriesResource,
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'
import {
  applySeriesUpdate,
  describeKeptPack,
  formatEpisodeRange,
  groupQueueByDownload,
  isPathLikeLookupTerm,
  toDownloadingSeries,
  toKeptPackDownload,
  transformToSearchResults,
} from 'src/media/utils/sonarr.utils'

const queueRow = (overrides: Partial<QueueResource> = {}): QueueResource => ({
  id: 1,
  seriesId: 1,
  status: 'downloading',
  protocol: 'usenet',
  size: 1000,
  sizeleft: 500,
  series: { title: 'Test Series' },
  ...overrides,
})

/** One queue row of a pack: Sonarr repeats the whole pack's size per row. */
const packRow = (
  seasonNumber: number,
  episodeNumber: number,
  overrides: Partial<QueueResource> = {},
): QueueResource =>
  queueRow({
    id: 100 + episodeNumber,
    episodeId: 1000 + seasonNumber * 100 + episodeNumber,
    seasonNumber,
    downloadId: 'SABnzbd_nzo_pack',
    title: 'Test.Series.Pack.1080p',
    episode: {
      seasonNumber,
      episodeNumber,
      title: `Episode ${episodeNumber}`,
    },
    size: 10_000,
    sizeleft: 4_000,
    ...overrides,
  })

describe('sonarr.utils', () => {
  describe('transformToSearchResults', () => {
    const createMockSeriesResource = (
      overrides: Partial<SonarrSeriesResource> = {},
    ): SonarrSeriesResource => ({
      tvdbId: 123456,
      tmdbId: 789012,
      imdbId: 'tt1234567',
      title: 'Test Series',
      sortTitle: 'test series',
      year: 2023,
      overview: 'A test TV series overview',
      runtime: 45,
      genres: ['Drama', 'Action'],
      status: SonarrSeriesStatus.CONTINUING,
      ended: false,
      seriesType: SonarrSeriesType.STANDARD,
      network: 'Test Network',
      seasonFolder: true,
      useSceneNumbering: false,
      seasons: [
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
      ],
      images: [
        {
          coverType: SonarrImageType.POSTER,
          url: 'https://example.com/poster.jpg',
        },
        {
          coverType: SonarrImageType.FANART,
          url: 'https://example.com/fanart.jpg',
        },
      ],
      firstAired: '2023-01-01T00:00:00Z',
      lastAired: '2023-12-31T00:00:00Z',
      certification: 'TV-14',
      cleanTitle: 'testseries',
      titleSlug: 'test-series',
      ratings: { votes: 10000, value: 8.5 },
      ...overrides,
    })

    it('should transform series resource to search result', () => {
      const seriesResource = createMockSeriesResource()
      const result = transformToSearchResults([seriesResource])

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        tvdbId: 123456,
        tmdbId: 789012,
        imdbId: 'tt1234567',
        title: 'Test Series',
        titleSlug: 'test-series',
        sortTitle: 'test series',
        year: 2023,
        firstAired: '2023-01-01T00:00:00Z',
        lastAired: '2023-12-31T00:00:00Z',
        overview: 'A test TV series overview',
        runtime: 45,
        network: 'Test Network',
        status: SonarrSeriesStatus.CONTINUING,
        seriesType: SonarrSeriesType.STANDARD,
        seasons: [
          { seasonNumber: 1, monitored: true },
          { seasonNumber: 2, monitored: true },
        ],
        genres: ['Drama', 'Action'],
        rating: 8.5,
        posterPath: 'https://example.com/poster.jpg',
        backdropPath: 'https://example.com/fanart.jpg',
        certification: 'TV-14',
        ended: false,
      })
    })

    it('should handle missing images gracefully', () => {
      const seriesResource = createMockSeriesResource({ images: [] })
      const result = transformToSearchResults([seriesResource])

      expect(result[0].posterPath).toBeUndefined()
      expect(result[0].backdropPath).toBeUndefined()
    })

    it('should handle images with remoteUrl', () => {
      const seriesResource = createMockSeriesResource({
        images: [
          {
            coverType: SonarrImageType.POSTER,
            remoteUrl: 'https://remote.com/poster.jpg',
            url: 'https://local.com/poster.jpg',
          },
        ],
      })
      const result = transformToSearchResults([seriesResource])

      expect(result[0].posterPath).toBe('https://remote.com/poster.jpg')
    })

    it('should use the Sonarr v4 aggregate ratings value', () => {
      const seriesResource = createMockSeriesResource({
        ratings: { votes: 1000, value: 8.0 },
      })
      const result = transformToSearchResults([seriesResource])

      expect(result[0].rating).toBe(8.0)
    })

    it('should treat a zero-vote rating as unrated', () => {
      const seriesResource = createMockSeriesResource({
        ratings: { votes: 0, value: 0 },
      })
      const result = transformToSearchResults([seriesResource])

      expect(result[0].rating).toBeUndefined()
    })

    it('should handle missing ratings', () => {
      const seriesResource = createMockSeriesResource({ ratings: undefined })
      const result = transformToSearchResults([seriesResource])

      expect(result[0].rating).toBeUndefined()
    })

    it('should sanitize invalid year', () => {
      const seriesResource = createMockSeriesResource({ year: 1800 })
      const result = transformToSearchResults([seriesResource])

      expect(result[0].year).toBeUndefined()
    })

    it('should generate title slug when missing', () => {
      const seriesResource = createMockSeriesResource({
        title: 'Test Series',
        titleSlug: undefined,
      })
      const result = transformToSearchResults([seriesResource])

      expect(result[0].titleSlug).toBe('test-series')
    })

    it('should default to standard series type when missing', () => {
      const seriesResource = createMockSeriesResource({ seriesType: undefined })
      const result = transformToSearchResults([seriesResource])

      expect(result[0].seriesType).toBe('standard')
    })

    it('should handle empty arrays gracefully', () => {
      const result = transformToSearchResults([])
      expect(result).toEqual([])
    })
  })

  describe('groupQueueByDownload', () => {
    it('should group rows sharing a downloadId in first-appearance order', () => {
      const other = queueRow({ id: 50, downloadId: 'other' })
      const groups = groupQueueByDownload([packRow(1, 1), other, packRow(1, 2)])

      expect(groups).toHaveLength(2)
      expect(groups[0].downloadId).toBe('SABnzbd_nzo_pack')
      expect(groups[0].rows.map(r => r.id)).toEqual([101, 102])
      expect(groups[1].rows).toEqual([other])
    })

    it('should keep rows without a downloadId (pending releases) separate', () => {
      const groups = groupQueueByDownload([
        queueRow({ id: 1, status: 'delay', downloadId: null }),
        queueRow({ id: 2, status: 'delay' }),
        queueRow({ id: 3, status: 'fallback', downloadId: '' }),
      ])

      expect(groups).toHaveLength(3)
      expect(groups.every(g => g.downloadId === undefined)).toBe(true)
    })
  })

  describe('formatEpisodeRange', () => {
    it('should collapse consecutive episodes into a range', () => {
      expect(
        formatEpisodeRange([packRow(1, 1), packRow(1, 2), packRow(1, 3)]),
      ).toBe('S01E01–E03')
    })

    it('should list gaps and seasons separately, sorted', () => {
      expect(
        formatEpisodeRange([
          packRow(2, 1),
          packRow(1, 5),
          packRow(1, 1),
          packRow(1, 2),
        ]),
      ).toBe('S01E01–E02, S01E05, S02E01')
    })

    it('should label season 0 and episode 0', () => {
      expect(formatEpisodeRange([packRow(0, 0), packRow(0, 1)])).toBe(
        'S00E00–E01',
      )
    })

    it('should return an empty string when rows carry no episode numbers', () => {
      expect(formatEpisodeRange([queueRow()])).toBe('')
    })
  })

  describe('toDownloadingSeries', () => {
    it('should count a pack once with its size taken from a single row', () => {
      const [group] = groupQueueByDownload([
        packRow(1, 1),
        packRow(1, 2),
        packRow(1, 3),
      ])

      const result = toDownloadingSeries(group)

      expect(result).toEqual(
        expect.objectContaining({
          id: 101,
          downloadId: 'SABnzbd_nzo_pack',
          seasonNumber: 1,
          episodeCount: 3,
          episodeLabel: 'S01E01–E03',
          size: 10_000,
          sizeleft: 4_000,
          downloadedBytes: 6_000,
          progressPercent: 60,
        }),
      )
      expect(result.episodeId).toBeUndefined()
      expect(result.episodeNumber).toBeUndefined()
      expect(result.episodeTitle).toBeUndefined()
    })

    it('should keep episode fields for a single-episode download', () => {
      const result = toDownloadingSeries({
        downloadId: 'single',
        rows: [packRow(0, 4, { downloadId: 'single' })],
      })

      expect(result.episodeCount).toBe(1)
      expect(result.episodeLabel).toBe('S00E04')
      expect(result.seasonNumber).toBe(0)
      expect(result.episodeNumber).toBe(4)
      expect(result.episodeTitle).toBe('Episode 4')
    })

    it('should leave seasonNumber unset for a multi-season pack', () => {
      const [group] = groupQueueByDownload([packRow(1, 10), packRow(2, 1)])

      const result = toDownloadingSeries(group)

      expect(result.seasonNumber).toBeUndefined()
      expect(result.episodeLabel).toBe('S01E10, S02E01')
    })

    it('should fall back to the release title when episode numbers are missing', () => {
      const result = toDownloadingSeries({
        rows: [queueRow({ title: 'Some.Release' })],
      })

      expect(result.episodeLabel).toBe('Some.Release')
    })
  })

  describe('kept packs', () => {
    it('should describe the covered and requested episodes of a kept pack', () => {
      const rows = [packRow(1, 1), packRow(1, 2), packRow(1, 3)]
      const requested = new Set([rows[2].episodeId])

      const pack = toKeptPackDownload(
        { downloadId: 'SABnzbd_nzo_pack', rows: [rows[0], ...rows.slice(1)] },
        row => requested.has(row.episodeId),
      )

      expect(pack).toEqual({
        downloadId: 'SABnzbd_nzo_pack',
        title: 'Test.Series.Pack.1080p',
        coveredEpisodes: 'S01E01–E03',
        unmonitoredEpisodes: 'S01E03',
      })
      expect(describeKeptPack(pack)).toBe(
        'S01E01–E03 pack still downloading; S01E03 unmonitored',
      )
    })
  })

  describe('applySeriesUpdate', () => {
    const raw = (): SeriesResource => ({
      id: 5,
      title: 'Test Series',
      monitored: false,
      monitorNewItems: 'none',
      qualityProfileId: 3,
      tags: [7],
      seasons: [
        { seasonNumber: 0, monitored: false, images: [] },
        {
          seasonNumber: 1,
          monitored: false,
          statistics: { episodeCount: 10, sizeOnDisk: 1024 },
        },
        { seasonNumber: 2, monitored: true },
      ],
    })

    it('should keep every field it was not asked to change', () => {
      const unknownField = { keep: ['me'] }
      const series = { ...raw(), futureSonarrField: unknownField }

      const patched = applySeriesUpdate(series, { monitored: true })

      expect(patched).toEqual({ ...series, monitored: true })
      expect(patched).toMatchObject({
        monitorNewItems: 'none',
        futureSonarrField: unknownField,
      })
    })

    it('should apply season monitored flags by season number, including season 0', () => {
      const series = raw()

      const patched = applySeriesUpdate(series, {
        seasons: [
          { seasonNumber: 0, monitored: true },
          { seasonNumber: 2, monitored: false },
        ],
      })

      expect(patched.seasons).toEqual([
        { seasonNumber: 0, monitored: true, images: [] },
        series.seasons![1],
        { seasonNumber: 2, monitored: false },
      ])
      expect(patched.monitored).toBe(false)
    })

    it('should keep season fields the update does not carry', () => {
      const patched = applySeriesUpdate(raw(), {
        seasons: [{ seasonNumber: 1, monitored: true }],
      })

      expect(patched.seasons![1]).toEqual({
        seasonNumber: 1,
        monitored: true,
        statistics: { episodeCount: 10, sizeOnDisk: 1024 },
      })
    })

    it('should ignore updates for seasons Sonarr did not return', () => {
      const series = raw()

      const patched = applySeriesUpdate(series, {
        seasons: [{ seasonNumber: 9, monitored: true }],
      })

      expect(patched.seasons).toEqual(series.seasons)
    })

    it('should not mutate the raw series', () => {
      const series = raw()
      const before = structuredClone(series)

      applySeriesUpdate(series, {
        monitored: true,
        seasons: [{ seasonNumber: 1, monitored: true }],
      })

      expect(series).toEqual(before)
    })
  })
})

describe('isPathLikeLookupTerm', () => {
  // Sonarr v5 400s `/series/lookup` for any of these
  it.each(['/mnt/media/tv', '\\\\nas\\tv', '\\tv', 'C:\\TV', 'd:\\', '  /tv'])(
    'treats %j as a path',
    term => {
      expect(isPathLikeLookupTerm(term)).toBe(true)
    },
  )

  it.each([
    'Breaking Bad',
    'AC/DC Live',
    'Fate/Zero',
    'C: The Series',
    'tvdb:81189',
  ])('treats %j as a title', term => {
    expect(isPathLikeLookupTerm(term)).toBe(false)
  })
})
