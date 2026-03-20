import {
  type EpisodeFileResource,
  type EpisodeResource,
  type SeriesResource,
} from '@lilnas/media/sonarr'

import { buildShowDetail } from 'src/shows/shows.types'

function makeSeries(overrides: Partial<SeriesResource> = {}): SeriesResource {
  return {
    id: 1,
    tvdbId: 1000,
    title: 'Test Show',
    year: 2020,
    overview: 'A test show',
    network: 'HBO',
    status: 'continuing',
    genres: ['Drama'],
    ratings: { value: 8.5 },
    runtime: 60,
    firstAired: '2020-01-01T00:00:00Z',
    imdbId: 'tt1234567',
    tmdbId: 9999,
    images: [
      { coverType: 'poster', remoteUrl: 'https://example.com/poster.jpg' },
      { coverType: 'fanart', remoteUrl: 'https://example.com/fanart.jpg' },
    ],
    seasons: [
      {
        seasonNumber: 1,
        monitored: true,
        statistics: {
          totalEpisodeCount: 2,
          episodeCount: 2,
          sizeOnDisk: 10_000_000_000,
        },
      },
      {
        seasonNumber: 2,
        monitored: true,
        statistics: {
          totalEpisodeCount: 1,
          episodeCount: 1,
          sizeOnDisk: 5_000_000_000,
        },
      },
    ],
    statistics: {
      totalEpisodeCount: 3,
      episodeFileCount: 3,
      sizeOnDisk: 15_000_000_000,
    },
    ...overrides,
  }
}

function makeEpisode(
  overrides: Partial<EpisodeResource> = {},
): EpisodeResource {
  return {
    id: 1,
    seriesId: 1,
    episodeFileId: undefined,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Pilot',
    airDate: '2020-01-01',
    hasFile: false,
    monitored: true,
    ...overrides,
  }
}

function makeEpisodeFile(
  overrides: Partial<EpisodeFileResource> = {},
): EpisodeFileResource {
  return {
    id: 100,
    seriesId: 1,
    seasonNumber: 1,
    relativePath: 'Season 01/S01E01.mkv',
    size: 5_000_000_000,
    quality: { quality: { name: '1080p Bluray' } },
    ...overrides,
  }
}

describe('buildShowDetail', () => {
  describe('season 0 filtering', () => {
    it('excludes season 0 from output', () => {
      const series = makeSeries({
        seasons: [
          {
            seasonNumber: 0,
            monitored: false,
            statistics: {
              totalEpisodeCount: 3,
              episodeCount: 0,
              sizeOnDisk: 0,
            },
          },
          {
            seasonNumber: 1,
            monitored: true,
            statistics: {
              totalEpisodeCount: 2,
              episodeCount: 2,
              sizeOnDisk: 5_000_000_000,
            },
          },
        ],
      })
      const episodes = [
        makeEpisode({ seasonNumber: 0, id: 99 }),
        makeEpisode({ id: 1, seasonNumber: 1 }),
      ]
      const result = buildShowDetail(series, episodes, [])
      expect(result.seasons.map(s => s.seasonNumber)).not.toContain(0)
      expect(result.seasons).toHaveLength(1)
    })
  })

  describe('episode grouping and sorting', () => {
    it('groups episodes by season correctly', () => {
      const series = makeSeries()
      const episodes = [
        makeEpisode({ id: 1, seasonNumber: 1, episodeNumber: 1 }),
        makeEpisode({ id: 2, seasonNumber: 1, episodeNumber: 2 }),
        makeEpisode({ id: 3, seasonNumber: 2, episodeNumber: 1 }),
      ]
      const result = buildShowDetail(series, episodes, [])
      const season1 = result.seasons.find(s => s.seasonNumber === 1)
      const season2 = result.seasons.find(s => s.seasonNumber === 2)
      expect(season1?.episodes).toHaveLength(2)
      expect(season2?.episodes).toHaveLength(1)
    })

    it('sorts episodes within season by episodeNumber ascending', () => {
      const series = makeSeries({
        seasons: [
          {
            seasonNumber: 1,
            monitored: true,
            statistics: {
              totalEpisodeCount: 3,
              episodeCount: 3,
              sizeOnDisk: 0,
            },
          },
        ],
      })
      const episodes = [
        makeEpisode({ id: 3, seasonNumber: 1, episodeNumber: 3 }),
        makeEpisode({ id: 1, seasonNumber: 1, episodeNumber: 1 }),
        makeEpisode({ id: 2, seasonNumber: 1, episodeNumber: 2 }),
      ]
      const result = buildShowDetail(series, episodes, [])
      const season1 = result.seasons[0]!
      expect(season1.episodes.map(e => e.episodeNumber)).toEqual([1, 2, 3])
    })

    it('sorts seasons by seasonNumber ascending', () => {
      const series = makeSeries({
        seasons: [
          {
            seasonNumber: 3,
            monitored: true,
            statistics: {
              totalEpisodeCount: 1,
              episodeCount: 1,
              sizeOnDisk: 0,
            },
          },
          {
            seasonNumber: 1,
            monitored: true,
            statistics: {
              totalEpisodeCount: 1,
              episodeCount: 1,
              sizeOnDisk: 0,
            },
          },
          {
            seasonNumber: 2,
            monitored: true,
            statistics: {
              totalEpisodeCount: 1,
              episodeCount: 1,
              sizeOnDisk: 0,
            },
          },
        ],
      })
      const result = buildShowDetail(series, [], [])
      expect(result.seasons.map(s => s.seasonNumber)).toEqual([1, 2, 3])
    })
  })

  describe('episode-to-file joining', () => {
    it('joins file data to episode via episodeFileId', () => {
      const series = makeSeries({
        seasons: [
          {
            seasonNumber: 1,
            monitored: true,
            statistics: {
              totalEpisodeCount: 1,
              episodeCount: 1,
              sizeOnDisk: 5_000_000_000,
            },
          },
        ],
      })
      const file = makeEpisodeFile({
        id: 100,
        quality: { quality: { name: '4K BluRay' } },
        size: 8_000_000_000,
        relativePath: 'Season 01/S01E01.mkv',
      })
      const episode = makeEpisode({
        id: 1,
        episodeFileId: 100,
        hasFile: true,
        seasonNumber: 1,
      })
      const result = buildShowDetail(series, [episode], [file])
      const ep = result.seasons[0]?.episodes[0]
      expect(ep?.quality).toBe('4K BluRay')
      expect(ep?.fileSize).toBe(8_000_000_000)
      expect(ep?.relativePath).toBe('Season 01/S01E01.mkv')
    })

    it('returns null quality/fileSize/relativePath for episodes without files', () => {
      const series = makeSeries({
        seasons: [
          {
            seasonNumber: 1,
            monitored: true,
            statistics: {
              totalEpisodeCount: 1,
              episodeCount: 1,
              sizeOnDisk: 0,
            },
          },
        ],
      })
      const episode = makeEpisode({
        id: 1,
        episodeFileId: undefined,
        hasFile: false,
      })
      const result = buildShowDetail(series, [episode], [])
      const ep = result.seasons[0]?.episodes[0]
      expect(ep?.quality).toBeNull()
      expect(ep?.fileSize).toBeNull()
      expect(ep?.relativePath).toBeNull()
    })

    it('returns null fields when episodeFileId references a missing file', () => {
      const series = makeSeries({
        seasons: [
          {
            seasonNumber: 1,
            monitored: true,
            statistics: {
              totalEpisodeCount: 1,
              episodeCount: 1,
              sizeOnDisk: 0,
            },
          },
        ],
      })
      const episode = makeEpisode({ id: 1, episodeFileId: 999 })
      const result = buildShowDetail(series, [episode], [])
      const ep = result.seasons[0]?.episodes[0]
      expect(ep?.quality).toBeNull()
    })
  })

  describe('season stat aggregation', () => {
    it('computes downloadedCount from hasFile on episodes', () => {
      const series = makeSeries({
        seasons: [
          {
            seasonNumber: 1,
            monitored: true,
            statistics: {
              totalEpisodeCount: 3,
              episodeCount: 3,
              sizeOnDisk: 0,
            },
          },
        ],
      })
      const episodes = [
        makeEpisode({ id: 1, hasFile: true }),
        makeEpisode({ id: 2, hasFile: true }),
        makeEpisode({ id: 3, hasFile: false }),
      ]
      const result = buildShowDetail(series, episodes, [])
      expect(result.seasons[0]?.downloadedCount).toBe(2)
    })

    it('uses statistics.totalEpisodeCount for episodeCount when available', () => {
      const series = makeSeries({
        seasons: [
          {
            seasonNumber: 1,
            monitored: true,
            statistics: {
              totalEpisodeCount: 10,
              episodeCount: 10,
              sizeOnDisk: 0,
            },
          },
        ],
      })
      const episodes = [makeEpisode({ id: 1 }), makeEpisode({ id: 2 })]
      const result = buildShowDetail(series, episodes, [])
      // Statistics has 10, but only 2 episodes provided — should use statistics value
      expect(result.seasons[0]?.episodeCount).toBe(10)
    })

    it('falls back to actual episode count when statistics is missing', () => {
      const series = makeSeries({
        seasons: [{ seasonNumber: 1, monitored: true }],
      })
      const episodes = [
        makeEpisode({ id: 1 }),
        makeEpisode({ id: 2 }),
        makeEpisode({ id: 3 }),
      ]
      const result = buildShowDetail(series, episodes, [])
      expect(result.seasons[0]?.episodeCount).toBe(3)
    })
  })

  describe('series-level fields', () => {
    it('assembles top-level series statistics from series.statistics', () => {
      const series = makeSeries()
      const result = buildShowDetail(series, [], [])
      expect(result.totalEpisodeCount).toBe(3)
      expect(result.episodeFileCount).toBe(3)
      expect(result.sizeOnDisk).toBe(15_000_000_000)
    })

    it('returns empty seasons array when series has no seasons', () => {
      const series = makeSeries({ seasons: [] })
      const result = buildShowDetail(series, [], [])
      expect(result.seasons).toEqual([])
    })

    it('correctly resolves poster and fanart URLs', () => {
      const result = buildShowDetail(makeSeries(), [], [])
      expect(result.posterUrl).toBe('https://example.com/poster.jpg')
      expect(result.fanartUrl).toBe('https://example.com/fanart.jpg')
    })

    it('returns null image URLs when images is undefined', () => {
      const series = makeSeries({ images: undefined })
      const result = buildShowDetail(series, [], [])
      expect(result.posterUrl).toBeNull()
      expect(result.fanartUrl).toBeNull()
    })
  })
})
