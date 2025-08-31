import {
  MonitorSeriesOptions,
  SeriesSearchResult,
  SonarrImageType,
  SonarrMonitorType,
  SonarrSeries,
  SonarrSeriesResource,
  SonarrSeriesStatus,
  SonarrSeriesType,
  UnmonitorSeriesOptions,
} from 'src/media/types/sonarr.types'
import {
  determineMonitoringStrategy,
  determineUnmonitoringStrategy,
  extractSeriesInfo,
  extractUnmonitoringOperationSummary,
  formatRuntime,
  formatSeriesStatus,
  generateTitleSlug,
  hasEpisodeSelections,
  hasRemainingMonitoredContent,
  transformToSearchResults,
  validateSeriesData,
  validateUnmonitoringSelection,
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

  describe('extractSeriesInfo', () => {
    it('should extract series info from SeriesSearchResult', () => {
      const series: SeriesSearchResult = {
        tvdbId: 123456,
        title: 'Test Series',
        titleSlug: 'test-series',
        year: 2023,
        status: SonarrSeriesStatus.CONTINUING,
        seriesType: SonarrSeriesType.STANDARD,
        seasons: [{ seasonNumber: 1, monitored: true }],
        genres: ['Drama'],
        ended: false,
        network: 'Test Network',
      }

      const result = extractSeriesInfo(series)

      expect(result).toEqual({
        title: 'Test Series',
        year: 2023,
        tvdbId: 123456,
        status: SonarrSeriesStatus.CONTINUING,
        network: 'Test Network',
        seasonCount: 1,
      })
    })

    it('should handle missing optional fields', () => {
      const series: Partial<SeriesSearchResult> = {
        tvdbId: 123456,
        title: 'Test Series',
        status: SonarrSeriesStatus.CONTINUING,
      }

      const result = extractSeriesInfo(series as SeriesSearchResult)

      expect(result).toEqual({
        title: 'Test Series',
        year: undefined,
        tvdbId: 123456,
        status: SonarrSeriesStatus.CONTINUING,
        network: undefined,
        seasonCount: 0,
      })
    })
  })

  describe('validateSeriesData', () => {
    const createValidSeries = (): SonarrSeriesResource => ({
      tvdbId: 123456,
      title: 'Test Series',
      status: SonarrSeriesStatus.CONTINUING,
      genres: ['Drama'],
      seasons: [{ seasonNumber: 1, monitored: true }],
      ended: false,
      seriesType: SonarrSeriesType.STANDARD,
      images: [],
      sortTitle: 'test series',
      runtime: 45,
      cleanTitle: 'testseries',
      titleSlug: 'test-series',
      ratings: {},
      year: 2023,
      seasonFolder: true,
      useSceneNumbering: false,
    })

    it('should validate complete series data', () => {
      const series = createValidSeries()
      const result = validateSeriesData(series)

      expect(result.isValid).toBe(true)
      expect(result.missingFields).toEqual([])
    })

    it('should detect missing title', () => {
      const series = createValidSeries()
      series.title = ''

      const result = validateSeriesData(series)

      expect(result.isValid).toBe(false)
      expect(result.missingFields).toContain('title')
    })

    it('should detect missing tvdbId', () => {
      const series = createValidSeries()
      series.tvdbId = 0

      const result = validateSeriesData(series)

      expect(result.isValid).toBe(false)
      expect(result.missingFields).toContain('tvdbId')
    })

    it('should detect missing status', () => {
      const series = createValidSeries()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      series.status = '' as any

      const result = validateSeriesData(series)

      expect(result.isValid).toBe(false)
      expect(result.missingFields).toContain('status')
    })

    it('should detect empty genres', () => {
      const series = createValidSeries()
      series.genres = []

      const result = validateSeriesData(series)

      expect(result.isValid).toBe(false)
      expect(result.missingFields).toContain('genres')
    })

    it('should detect empty seasons', () => {
      const series = createValidSeries()
      series.seasons = []

      const result = validateSeriesData(series)

      expect(result.isValid).toBe(false)
      expect(result.missingFields).toContain('seasons')
    })

    it('should detect multiple missing fields', () => {
      const series = createValidSeries()
      series.title = ''
      series.genres = []
      series.seasons = []

      const result = validateSeriesData(series)

      expect(result.isValid).toBe(false)
      expect(result.missingFields).toEqual(['title', 'genres', 'seasons'])
    })
  })

  describe('generateTitleSlug', () => {
    it('should generate slug from simple title', () => {
      expect(generateTitleSlug('Test Series')).toBe('test-series')
    })

    it('should handle special characters', () => {
      expect(generateTitleSlug('The Walking Dead: World Beyond')).toBe(
        'the-walking-dead-world-beyond',
      )
    })

    it('should handle numbers', () => {
      expect(generateTitleSlug('Stranger Things 4')).toBe('stranger-things-4')
    })

    it('should handle multiple spaces', () => {
      expect(generateTitleSlug('The    Good    Place')).toBe('the-good-place')
    })

    it('should remove leading and trailing hyphens', () => {
      expect(generateTitleSlug('---Test Series---')).toBe('test-series')
    })

    it('should handle empty string', () => {
      expect(generateTitleSlug('')).toBe('')
    })

    it('should handle string with only special characters', () => {
      expect(generateTitleSlug('!@#$%^&*()')).toBe('')
    })

    it('should collapse multiple hyphens', () => {
      expect(generateTitleSlug('Test---Series')).toBe('test-series')
    })
  })

  describe('formatRuntime', () => {
    it('should format runtime in minutes only', () => {
      expect(formatRuntime(45)).toBe('45m')
    })

    it('should format runtime with hours and minutes', () => {
      expect(formatRuntime(90)).toBe('1h 30m')
    })

    it('should format runtime with hours only', () => {
      expect(formatRuntime(120)).toBe('2h 0m')
    })

    it('should handle undefined runtime', () => {
      expect(formatRuntime(undefined)).toBe('Unknown')
    })

    it('should handle zero runtime', () => {
      expect(formatRuntime(0)).toBe('Unknown')
    })

    it('should handle large runtime', () => {
      expect(formatRuntime(720)).toBe('12h 0m')
    })
  })

  describe('formatSeriesStatus', () => {
    it('should return "Ended" when ended is true', () => {
      expect(formatSeriesStatus('continuing', true)).toBe('Ended')
      expect(formatSeriesStatus('upcoming', true)).toBe('Ended')
    })

    it('should format continuing status', () => {
      expect(formatSeriesStatus('continuing', false)).toBe('Continuing')
    })

    it('should format ended status', () => {
      expect(formatSeriesStatus('ended', false)).toBe('Ended')
    })

    it('should format upcoming status', () => {
      expect(formatSeriesStatus('upcoming', false)).toBe('Upcoming')
    })

    it('should format deleted status', () => {
      expect(formatSeriesStatus('deleted', false)).toBe('Deleted')
    })

    it('should handle case insensitive status', () => {
      expect(formatSeriesStatus('CONTINUING', false)).toBe('Continuing')
      expect(formatSeriesStatus('Ended', false)).toBe('Ended')
    })

    it('should return original status for unknown values', () => {
      expect(formatSeriesStatus('unknown-status', false)).toBe('unknown-status')
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

  describe('hasEpisodeSelections', () => {
    it('should return true when selection has specific episodes', () => {
      const selection = [{ season: 1, episodes: [1, 2, 3] }]
      expect(hasEpisodeSelections(selection)).toBe(true)
    })

    it('should return false when selection has no episodes', () => {
      const selection = [{ season: 1 }]
      expect(hasEpisodeSelections(selection)).toBe(false)
    })

    it('should return false when selection has empty episodes array', () => {
      const selection = [{ season: 1, episodes: [] }]
      expect(hasEpisodeSelections(selection)).toBe(false)
    })

    it('should return true when any selection has episodes', () => {
      const selection = [
        { season: 1 },
        { season: 2, episodes: [1] },
        { season: 3 },
      ]
      expect(hasEpisodeSelections(selection)).toBe(true)
    })

    it('should handle empty selection array', () => {
      expect(hasEpisodeSelections([])).toBe(false)
    })
  })

  describe('determineUnmonitoringStrategy', () => {
    it('should identify full series deletion when no selection', () => {
      const options: UnmonitorSeriesOptions = {}
      const result = determineUnmonitoringStrategy(options)

      expect(result).toEqual({
        isFullSeriesDeletion: true,
        hasSeasonSelections: false,
        hasEpisodeSelections: false,
      })
    })

    it('should identify season selections', () => {
      const options: UnmonitorSeriesOptions = {
        selection: [{ season: 1 }, { season: 2 }],
      }
      const result = determineUnmonitoringStrategy(options)

      expect(result).toEqual({
        isFullSeriesDeletion: false,
        hasSeasonSelections: true,
        hasEpisodeSelections: false,
      })
    })

    it('should identify episode selections', () => {
      const options: UnmonitorSeriesOptions = {
        selection: [{ season: 1, episodes: [1, 2] }],
      }
      const result = determineUnmonitoringStrategy(options)

      expect(result).toEqual({
        isFullSeriesDeletion: false,
        hasSeasonSelections: false,
        hasEpisodeSelections: true,
      })
    })

    it('should prioritize episode selections over season selections', () => {
      const options: UnmonitorSeriesOptions = {
        selection: [{ season: 1 }, { season: 2, episodes: [1] }],
      }
      const result = determineUnmonitoringStrategy(options)

      expect(result).toEqual({
        isFullSeriesDeletion: false,
        hasSeasonSelections: false,
        hasEpisodeSelections: true,
      })
    })
  })

  describe('hasRemainingMonitoredContent', () => {
    const createMockSeries = (): SonarrSeries => ({
      id: 1,
      title: 'Test Series',
      alternateTitles: [],
      sortTitle: 'test series',
      status: SonarrSeriesStatus.CONTINUING,
      ended: false,
      overview: 'Test overview',
      network: 'Test Network',
      images: [],
      seasons: [
        { seasonNumber: 0, monitored: false }, // Specials
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
      ],
      year: 2023,
      path: '/tv/test-series',
      qualityProfileId: 1,
      seasonFolder: true,
      monitored: true,
      useSceneNumbering: false,
      runtime: 45,
      tvdbId: 123456,
      firstAired: '2023-01-01T00:00:00Z',
      seriesType: SonarrSeriesType.STANDARD,
      cleanTitle: 'testseries',
      titleSlug: 'test-series',
      certification: 'TV-14',
      genres: ['Drama'],
      tags: [],
      added: '2023-01-01T00:00:00Z',
      ratings: {},
    })

    it('should return true when monitored episodes exist', () => {
      const series = createMockSeries()
      const episodeMap = new Map([
        [1, [{ id: 1, monitored: true }]],
        [2, [{ id: 2, monitored: false }]],
      ])

      expect(hasRemainingMonitoredContent(series, episodeMap)).toBe(true)
    })

    it('should return false when no monitored episodes exist', () => {
      const series = createMockSeries()
      const episodeMap = new Map([
        [1, [{ id: 1, monitored: false }]],
        [2, [{ id: 2, monitored: false }]],
      ])

      expect(hasRemainingMonitoredContent(series, episodeMap)).toBe(false)
    })

    it('should ignore specials (season 0)', () => {
      const series = createMockSeries()
      const episodeMap = new Map([
        [0, [{ id: 1, monitored: true }]], // Specials - should be ignored
        [1, [{ id: 2, monitored: false }]],
      ])

      expect(hasRemainingMonitoredContent(series, episodeMap)).toBe(false)
    })

    it('should handle empty episode map', () => {
      const series = createMockSeries()
      const episodeMap = new Map()

      expect(hasRemainingMonitoredContent(series, episodeMap)).toBe(false)
    })

    it('should handle missing season in episode map', () => {
      const series = createMockSeries()
      const episodeMap = new Map([
        [1, [{ id: 1, monitored: false }]],
        // Season 2 missing from map
      ])

      expect(hasRemainingMonitoredContent(series, episodeMap)).toBe(false)
    })
  })

  describe('validateUnmonitoringSelection', () => {
    it('should validate correct selection', () => {
      const selection = [{ season: 1, episodes: [1, 2, 3] }, { season: 2 }]

      const result = validateUnmonitoringSelection(selection)

      expect(result.isValid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it('should detect duplicate seasons', () => {
      const selection = [
        { season: 1, episodes: [1, 2] },
        { season: 1, episodes: [3, 4] },
      ]

      const result = validateUnmonitoringSelection(selection)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Duplicate seasons found: 1')
    })

    it('should detect invalid season numbers', () => {
      const selection = [{ season: -1, episodes: [1] }]

      const result = validateUnmonitoringSelection(selection)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain(
        'Invalid season numbers (must be >= 0): -1',
      )
    })

    it('should detect invalid episode numbers', () => {
      const selection = [{ season: 1, episodes: [0, -1, 1] }]

      const result = validateUnmonitoringSelection(selection)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain(
        'Invalid episode numbers in season 1 (must be > 0): 0, -1',
      )
    })

    it('should detect duplicate episodes within season', () => {
      const selection = [{ season: 1, episodes: [1, 2, 1, 3] }]

      const result = validateUnmonitoringSelection(selection)

      expect(result.isValid).toBe(false)
      expect(result.errors).toContain('Duplicate episodes in season 1: 1')
    })

    it('should detect multiple error types', () => {
      const selection = [
        { season: -1, episodes: [0, 1, 1] },
        { season: 1 },
        { season: 1, episodes: [2] },
      ]

      const result = validateUnmonitoringSelection(selection)

      expect(result.isValid).toBe(false)
      expect(result.errors).toHaveLength(4) // Invalid season, invalid episode, duplicate episode, duplicate season
    })

    it('should handle empty selection array', () => {
      const result = validateUnmonitoringSelection([])

      expect(result.isValid).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  describe('extractUnmonitoringOperationSummary', () => {
    it('should extract full series deletion summary', () => {
      const options: UnmonitorSeriesOptions = {}
      const result = extractUnmonitoringOperationSummary(options)

      expect(result).toEqual({
        operationType: 'full_series',
        seasonCount: 0,
        episodeCount: 0,
        summary: 'Delete entire series',
      })
    })

    it('should extract season-level operation summary', () => {
      const options: UnmonitorSeriesOptions = {
        selection: [{ season: 1 }, { season: 2 }],
      }
      const result = extractUnmonitoringOperationSummary(options)

      expect(result).toEqual({
        operationType: 'seasons',
        seasonCount: 2,
        episodeCount: 0,
        summary: 'Unmonitor 2 season(s): 1, 2',
      })
    })

    it('should extract episode-level operation summary', () => {
      const options: UnmonitorSeriesOptions = {
        selection: [
          { season: 1, episodes: [1, 2] },
          { season: 2, episodes: [1] },
        ],
      }
      const result = extractUnmonitoringOperationSummary(options)

      expect(result).toEqual({
        operationType: 'episodes',
        seasonCount: 2,
        episodeCount: 3,
        summary: 'Unmonitor 3 episode(s) across 2 season(s)',
      })
    })

    it('should handle mixed selection with empty episodes arrays', () => {
      const options: UnmonitorSeriesOptions = {
        selection: [{ season: 1, episodes: [] }, { season: 2 }],
      }
      const result = extractUnmonitoringOperationSummary(options)

      expect(result).toEqual({
        operationType: 'seasons',
        seasonCount: 2,
        episodeCount: 0,
        summary: 'Unmonitor 2 season(s): 1, 2',
      })
    })

    it('should handle single season selection', () => {
      const options: UnmonitorSeriesOptions = {
        selection: [{ season: 1 }],
      }
      const result = extractUnmonitoringOperationSummary(options)

      expect(result).toEqual({
        operationType: 'seasons',
        seasonCount: 1,
        episodeCount: 0,
        summary: 'Unmonitor 1 season(s): 1',
      })
    })

    it('should handle single episode selection', () => {
      const options: UnmonitorSeriesOptions = {
        selection: [{ season: 1, episodes: [5] }],
      }
      const result = extractUnmonitoringOperationSummary(options)

      expect(result).toEqual({
        operationType: 'episodes',
        seasonCount: 1,
        episodeCount: 1,
        summary: 'Unmonitor 1 episode(s) across 1 season(s)',
      })
    })
  })
})
