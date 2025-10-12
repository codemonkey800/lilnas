import { Test, TestingModule } from '@nestjs/testing'

import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import {
  MovieLibrarySearchResult,
  MovieSearchResult,
  RadarrMinimumAvailability,
  RadarrMovieStatus,
} from 'src/media/types/radarr.types'
import {
  LibrarySearchResult,
  SeriesSearchResult,
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'
import { DataFetchingUtilities } from 'src/media-operations/request-handling/utils/data-fetching.utils'
import { MediaRequestType } from 'src/schemas/graph'

describe('DataFetchingUtilities', () => {
  let service: DataFetchingUtilities
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>

  const mockMovies: MovieLibrarySearchResult[] = [
    {
      id: 1,
      title: 'The Matrix',
      year: 1999,
      tmdbId: 603,
      hasFile: true,
      monitored: true,
      qualityProfileId: 1,
      rootFolderPath: '/movies',
      path: '/movies/The Matrix (1999)',
      added: '2024-01-01T00:00:00Z',
      minimumAvailability: RadarrMinimumAvailability.RELEASED,
      isAvailable: true,
      genres: ['Action', 'Sci-Fi'],
      status: RadarrMovieStatus.RELEASED,
    },
    {
      id: 2,
      title: 'Inception',
      year: 2010,
      tmdbId: 27205,
      hasFile: false,
      monitored: true,
      qualityProfileId: 1,
      rootFolderPath: '/movies',
      path: '/movies/Inception (2010)',
      added: '2024-01-02T00:00:00Z',
      minimumAvailability: RadarrMinimumAvailability.RELEASED,
      isAvailable: true,
      genres: ['Action', 'Thriller'],
      status: RadarrMovieStatus.RELEASED,
    },
  ]

  const mockMovieSearchResults: MovieSearchResult[] = [
    {
      tmdbId: 603,
      title: 'The Matrix',
      year: 1999,
      genres: ['Action', 'Sci-Fi'],
      status: RadarrMovieStatus.RELEASED,
    },
    {
      tmdbId: 27205,
      title: 'Inception',
      year: 2010,
      genres: ['Action', 'Thriller'],
      status: RadarrMovieStatus.RELEASED,
    },
  ]

  const mockSeries: LibrarySearchResult[] = [
    {
      id: 1,
      title: 'Breaking Bad',
      year: 2008,
      tvdbId: 81189,
      monitored: true,
      seasons: [
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
      ],
      path: '/tv/Breaking Bad',
      added: '2024-01-01T00:00:00Z',
      titleSlug: 'breaking-bad',
      status: SonarrSeriesStatus.ENDED,
      seriesType: SonarrSeriesType.STANDARD,
      genres: ['Drama', 'Crime'],
      ended: true,
    },
    {
      id: 2,
      title: 'The Wire',
      year: 2002,
      tvdbId: 79126,
      monitored: true,
      seasons: [{ seasonNumber: 1, monitored: true }],
      path: '/tv/The Wire',
      added: '2024-01-02T00:00:00Z',
      titleSlug: 'the-wire',
      status: SonarrSeriesStatus.ENDED,
      seriesType: SonarrSeriesType.STANDARD,
      genres: ['Drama', 'Crime'],
      ended: true,
    },
  ]

  const mockSeriesSearchResults: SeriesSearchResult[] = [
    {
      tvdbId: 81189,
      title: 'Breaking Bad',
      year: 2008,
      titleSlug: 'breaking-bad',
      status: SonarrSeriesStatus.ENDED,
      seriesType: SonarrSeriesType.STANDARD,
      genres: ['Drama', 'Crime'],
      ended: true,
      seasons: [
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
      ],
    },
    {
      tvdbId: 79126,
      title: 'The Wire',
      year: 2002,
      titleSlug: 'the-wire',
      status: SonarrSeriesStatus.ENDED,
      seriesType: SonarrSeriesType.STANDARD,
      genres: ['Drama', 'Crime'],
      ended: true,
      seasons: [{ seasonNumber: 1, monitored: true }],
    },
  ]

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataFetchingUtilities,
        {
          provide: RadarrService,
          useValue: {
            getLibraryMovies: jest.fn(),
            searchMovies: jest.fn(),
          },
        },
        {
          provide: SonarrService,
          useValue: {
            getLibrarySeries: jest.fn(),
            searchShows: jest.fn(),
          },
        },
      ],
    }).compile()

    service = module.get<DataFetchingUtilities>(DataFetchingUtilities)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)
  })

  describe('fetchLibraryData', () => {
    describe('Movies media type', () => {
      it('should fetch and format movie library data when requesting movies', async () => {
        radarrService.getLibraryMovies.mockResolvedValue(mockMovies)

        const result = await service.fetchLibraryData(MediaRequestType.Movies)

        expect(radarrService.getLibraryMovies).toHaveBeenCalledTimes(1)
        expect(sonarrService.getLibrarySeries).not.toHaveBeenCalled()
        expect(result.count).toBe(2)
        expect(result.content).toContain('**MOVIES IN LIBRARY:**')
        expect(result.content).toContain('Total movies: 2')
        expect(result.content).toContain('The Matrix')
        expect(result.content).toContain('Inception')
      })

      it('should return empty result when movie library is empty', async () => {
        radarrService.getLibraryMovies.mockResolvedValue([])

        const result = await service.fetchLibraryData(MediaRequestType.Movies)

        expect(result.count).toBe(0)
        expect(result.content).toContain(
          '**MOVIES:** No movies found in library',
        )
      })

      it('should handle error gracefully when movie library fetch fails', async () => {
        const error = new Error('Radarr service unavailable')
        radarrService.getLibraryMovies.mockRejectedValue(error)

        const result = await service.fetchLibraryData(MediaRequestType.Movies)

        expect(result.count).toBe(0)
        expect(result.content).toContain(
          '**MOVIES:** Unable to fetch movie library (service may be unavailable)',
        )
      })
    })

    describe('Shows media type', () => {
      it('should fetch and format TV series library data when requesting shows', async () => {
        sonarrService.getLibrarySeries.mockResolvedValue(mockSeries)

        const result = await service.fetchLibraryData(MediaRequestType.Shows)

        expect(sonarrService.getLibrarySeries).toHaveBeenCalledTimes(1)
        expect(radarrService.getLibraryMovies).not.toHaveBeenCalled()
        expect(result.count).toBe(2)
        expect(result.content).toContain('**TV SHOWS IN LIBRARY:**')
        expect(result.content).toContain('Total shows: 2')
        expect(result.content).toContain('Breaking Bad')
        expect(result.content).toContain('The Wire')
      })

      it('should return empty result when TV series library is empty', async () => {
        sonarrService.getLibrarySeries.mockResolvedValue([])

        const result = await service.fetchLibraryData(MediaRequestType.Shows)

        expect(result.count).toBe(0)
        expect(result.content).toContain(
          '**TV SHOWS:** No TV shows found in library',
        )
      })

      it('should handle error gracefully when TV series library fetch fails', async () => {
        const error = new Error('Sonarr service unavailable')
        sonarrService.getLibrarySeries.mockRejectedValue(error)

        const result = await service.fetchLibraryData(MediaRequestType.Shows)

        expect(result.count).toBe(0)
        expect(result.content).toContain(
          '**TV SHOWS:** Unable to fetch TV series library (service may be unavailable)',
        )
      })
    })

    describe('Both media types', () => {
      it('should fetch both movies and TV series when requesting both media types', async () => {
        radarrService.getLibraryMovies.mockResolvedValue(mockMovies)
        sonarrService.getLibrarySeries.mockResolvedValue(mockSeries)

        const result = await service.fetchLibraryData(MediaRequestType.Both)

        expect(radarrService.getLibraryMovies).toHaveBeenCalledTimes(1)
        expect(sonarrService.getLibrarySeries).toHaveBeenCalledTimes(1)
        expect(result.count).toBe(4) // 2 movies + 2 series
        expect(result.content).toContain('**MOVIES IN LIBRARY:**')
        expect(result.content).toContain('**TV SHOWS IN LIBRARY:**')
        expect(result.content).toContain('Total movies: 2')
        expect(result.content).toContain('Total shows: 2')
      })

      it('should return partial results when movies succeed but TV fetch fails', async () => {
        radarrService.getLibraryMovies.mockResolvedValue(mockMovies)
        sonarrService.getLibrarySeries.mockRejectedValue(
          new Error('Sonarr unavailable'),
        )

        const result = await service.fetchLibraryData(MediaRequestType.Both)

        expect(result.count).toBe(2) // Only movies
        expect(result.content).toContain('**MOVIES IN LIBRARY:**')
        expect(result.content).toContain('Total movies: 2')
        expect(result.content).toContain('Unable to fetch TV series library')
      })

      it('should return partial results when TV succeeds but movies fetch fails', async () => {
        radarrService.getLibraryMovies.mockRejectedValue(
          new Error('Radarr unavailable'),
        )
        sonarrService.getLibrarySeries.mockResolvedValue(mockSeries)

        const result = await service.fetchLibraryData(MediaRequestType.Both)

        expect(result.count).toBe(2) // Only TV series
        expect(result.content).toContain('Unable to fetch movie library')
        expect(result.content).toContain('**TV SHOWS IN LIBRARY:**')
        expect(result.content).toContain('Total shows: 2')
      })

      it('should handle gracefully when both movie and TV fetches fail', async () => {
        radarrService.getLibraryMovies.mockRejectedValue(
          new Error('Radarr unavailable'),
        )
        sonarrService.getLibrarySeries.mockRejectedValue(
          new Error('Sonarr unavailable'),
        )

        const result = await service.fetchLibraryData(MediaRequestType.Both)

        expect(result.count).toBe(0)
        expect(result.content).toContain('Unable to fetch movie library')
        expect(result.content).toContain('Unable to fetch TV series library')
      })
    })

    it('should pass searchQuery parameter for logging when provided', async () => {
      const loggerLogSpy = jest.spyOn(service['logger'], 'log')
      radarrService.getLibraryMovies.mockResolvedValue([])

      await service.fetchLibraryData(MediaRequestType.Movies, 'test query')

      expect(loggerLogSpy).toHaveBeenCalledWith(
        { searchQuery: 'test query' },
        'Fetching movie library data',
      )
    })
  })

  describe('fetchExternalSearchData', () => {
    describe('Movies media type', () => {
      it('should search and format movie results when searching for movies externally', async () => {
        radarrService.searchMovies.mockResolvedValue(mockMovieSearchResults)

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Movies,
          'matrix',
        )

        expect(radarrService.searchMovies).toHaveBeenCalledWith('matrix')
        expect(sonarrService.searchShows).not.toHaveBeenCalled()
        expect(result.count).toBe(2)
        expect(result.content).toContain('**🔍 MOVIE SEARCH RESULTS:**')
        expect(result.content).toContain('Found 2 movies matching "matrix"')
        expect(result.content).toContain('The Matrix')
        expect(result.content).toContain('Inception')
      })

      it('should return empty result when movie search finds no matches', async () => {
        radarrService.searchMovies.mockResolvedValue([])

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Movies,
          'nonexistent',
        )

        expect(result.count).toBe(0)
        expect(result.content).toContain(
          '**🔍 MOVIE SEARCH:** No movies found for "nonexistent"',
        )
      })

      it('should handle error gracefully when movie search service fails', async () => {
        const error = new Error('Search service unavailable')
        radarrService.searchMovies.mockRejectedValue(error)

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Movies,
          'matrix',
        )

        expect(result.count).toBe(0)
        expect(result.content).toContain(
          '**🔍 MOVIES:** Unable to search for "matrix" (service may be unavailable)',
        )
      })
    })

    describe('Shows media type', () => {
      it('should search and format TV show results when searching for shows externally', async () => {
        sonarrService.searchShows.mockResolvedValue(mockSeriesSearchResults)

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Shows,
          'breaking',
        )

        expect(sonarrService.searchShows).toHaveBeenCalledWith('breaking')
        expect(radarrService.searchMovies).not.toHaveBeenCalled()
        expect(result.count).toBe(2)
        expect(result.content).toContain('**🔍 TV SHOW SEARCH RESULTS:**')
        expect(result.content).toContain('Found 2 shows matching "breaking"')
        expect(result.content).toContain('Breaking Bad')
        expect(result.content).toContain('The Wire')
      })

      it('should return empty result when TV show search finds no matches', async () => {
        sonarrService.searchShows.mockResolvedValue([])

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Shows,
          'nonexistent',
        )

        expect(result.count).toBe(0)
        expect(result.content).toContain(
          '**🔍 TV SHOWS:** No shows found for "nonexistent"',
        )
      })

      it('should handle error gracefully when TV show search service fails', async () => {
        const error = new Error('Search service unavailable')
        sonarrService.searchShows.mockRejectedValue(error)

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Shows,
          'breaking',
        )

        expect(result.count).toBe(0)
        expect(result.content).toContain(
          '**🔍 TV SHOWS:** Unable to search for "breaking" (service may be unavailable)',
        )
      })
    })

    describe('Both media types', () => {
      it('should search both movies and TV shows when requesting both media types', async () => {
        radarrService.searchMovies.mockResolvedValue(mockMovieSearchResults)
        sonarrService.searchShows.mockResolvedValue(mockSeriesSearchResults)

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Both,
          'test query',
        )

        expect(radarrService.searchMovies).toHaveBeenCalledWith('test query')
        expect(sonarrService.searchShows).toHaveBeenCalledWith('test query')
        expect(result.count).toBe(4) // 2 movies + 2 series
        expect(result.content).toContain('**🔍 MOVIE SEARCH RESULTS:**')
        expect(result.content).toContain('**🔍 TV SHOW SEARCH RESULTS:**')
        expect(result.content).toContain('Found 2 movies matching "test query"')
        expect(result.content).toContain('Found 2 shows matching "test query"')
      })

      it('should return partial results when movie search succeeds but TV search fails', async () => {
        radarrService.searchMovies.mockResolvedValue(mockMovieSearchResults)
        sonarrService.searchShows.mockRejectedValue(
          new Error('Sonarr unavailable'),
        )

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Both,
          'test query',
        )

        expect(result.count).toBe(2) // Only movies
        expect(result.content).toContain('**🔍 MOVIE SEARCH RESULTS:**')
        expect(result.content).toContain('Found 2 movies matching "test query"')
        expect(result.content).toContain('Unable to search for "test query"')
      })

      it('should return partial results when TV search succeeds but movie search fails', async () => {
        radarrService.searchMovies.mockRejectedValue(
          new Error('Radarr unavailable'),
        )
        sonarrService.searchShows.mockResolvedValue(mockSeriesSearchResults)

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Both,
          'test query',
        )

        expect(result.count).toBe(2) // Only TV series
        expect(result.content).toContain('Unable to search for "test query"')
        expect(result.content).toContain('**🔍 TV SHOW SEARCH RESULTS:**')
        expect(result.content).toContain('Found 2 shows matching "test query"')
      })

      it('should handle gracefully when both movie and TV searches fail', async () => {
        radarrService.searchMovies.mockRejectedValue(
          new Error('Radarr unavailable'),
        )
        sonarrService.searchShows.mockRejectedValue(
          new Error('Sonarr unavailable'),
        )

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Both,
          'test query',
        )

        expect(result.count).toBe(0)
        expect(result.content).toContain('Unable to search for "test query"')
        // Should appear twice (once for movies, once for TV)
        expect((result.content.match(/Unable to search/g) || []).length).toBe(2)
      })

      it('should return empty result when both searches find no matches', async () => {
        radarrService.searchMovies.mockResolvedValue([])
        sonarrService.searchShows.mockResolvedValue([])

        const result = await service.fetchExternalSearchData(
          MediaRequestType.Both,
          'nonexistent',
        )

        expect(result.count).toBe(0)
        expect(result.content).toContain('No movies found for "nonexistent"')
        expect(result.content).toContain('No shows found for "nonexistent"')
      })
    })
  })
})
