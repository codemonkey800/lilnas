import {
  MonitorSeriesOptions,
  SonarrImageType,
  SonarrMonitorType,
  SonarrSeriesResource,
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'
import {
  determineMonitoringStrategy,
  transformToSearchResults,
} from 'src/media/utils/sonarr.utils'

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
      ratings: {
        imdb: { value: 8.5, votes: 10000, type: 'user' },
      },
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

    it('should calculate average rating from multiple sources', () => {
      const seriesResource = createMockSeriesResource({
        ratings: {
          imdb: { value: 8.0, votes: 1000, type: 'user' },
          theMovieDb: { value: 7.5, votes: 500, type: 'user' },
          tvdb: { value: 8.5, votes: 200, type: 'user' },
        },
      })
      const result = transformToSearchResults([seriesResource])

      expect(result[0].rating).toBe(8.0) // (8.0 + 7.5 + 8.5) / 3
    })

    it('should handle rotten tomatoes rating conversion', () => {
      const seriesResource = createMockSeriesResource({
        ratings: {
          rottenTomatoes: { value: 85, votes: 100, type: 'user' }, // 85/10 = 8.5
        },
      })
      const result = transformToSearchResults([seriesResource])

      expect(result[0].rating).toBe(8.5)
    })

    it('should handle missing ratings', () => {
      const seriesResource = createMockSeriesResource({ ratings: {} })
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

  describe('determineMonitoringStrategy', () => {
    const mockSeasons = [
      { seasonNumber: 0, monitored: false }, // Specials
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
    ]

    it('should monitor all seasons except specials when no selection', () => {
      const options: MonitorSeriesOptions = {}
      const result = determineMonitoringStrategy(mockSeasons, options)

      expect(result.monitorType).toBe(SonarrMonitorType.ALL)
      expect(result.seasons).toEqual([
        { seasonNumber: 0, monitored: false }, // Specials remain unmonitored
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
      ])
    })

    it('should enable only selected seasons', () => {
      const options: MonitorSeriesOptions = {
        selection: [{ season: 1 }],
      }
      const result = determineMonitoringStrategy(mockSeasons, options)

      expect(result.monitorType).toBe(SonarrMonitorType.ALL)
      expect(result.seasons).toEqual([
        { seasonNumber: 0, monitored: false },
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: false }, // Not selected
      ])
    })

    it('should enable multiple selected seasons', () => {
      const options: MonitorSeriesOptions = {
        selection: [{ season: 1 }, { season: 2 }],
      }
      const result = determineMonitoringStrategy(mockSeasons, options)

      expect(result.seasons).toEqual([
        { seasonNumber: 0, monitored: false },
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
      ])
    })

    it('should handle empty seasons array', () => {
      const options: MonitorSeriesOptions = {}
      const result = determineMonitoringStrategy([], options)

      expect(result.monitorType).toBe(SonarrMonitorType.ALL)
      expect(result.seasons).toEqual([])
    })
  })
})
