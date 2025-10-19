import { HumanMessage } from '@langchain/core/messages'
import { Test, TestingModule } from '@nestjs/testing'

import { SonarrService } from 'src/media/services/sonarr.service'
import {
  MonitorAndDownloadSeriesResult,
  SeriesSearchResult,
  SonarrSeriesStatus,
  SonarrSeriesType,
} from 'src/media/types/sonarr.types'
import { testStrategyEdgeCases } from 'src/media-operations/request-handling/__test-helpers__/strategy-edge-cases-suite'
import { testStrategyRouting } from 'src/media-operations/request-handling/__test-helpers__/strategy-routing-suite'
import { TvDownloadStrategy } from 'src/media-operations/request-handling/strategies/tv-download.strategy'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { TvShowSelection } from 'src/schemas/tv-show'
import { StateService } from 'src/state/state.service'

describe('TvDownloadStrategy', () => {
  let strategy: TvDownloadStrategy
  let sonarrService: jest.Mocked<SonarrService>
  let promptService: jest.Mocked<PromptGenerationService>
  let parsingUtilities: jest.Mocked<ParsingUtilities>
  let selectionUtilities: jest.Mocked<SelectionUtilities>
  let contextService: jest.Mocked<ContextManagementService>

  // Mock response messages
  const mockChatResponse = new HumanMessage({
    id: 'mock-response-id',
    content: 'Here is your TV show response...',
  })

  // Mock TV show search results
  const mockShow1: SeriesSearchResult = {
    tvdbId: 12345,
    tmdbId: 67890,
    imdbId: 'tt0944947',
    title: 'Breaking Bad',
    titleSlug: 'breaking-bad',
    year: 2008,
    overview:
      'A high school chemistry teacher turned methamphetamine producer...',
    runtime: 47,
    network: 'AMC',
    status: SonarrSeriesStatus.ENDED,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: false },
      { seasonNumber: 3, monitored: false },
    ],
    genres: ['Drama', 'Crime', 'Thriller'],
    rating: 9.5,
    posterPath: '/path/to/breaking-bad-poster.jpg',
    certification: 'TV-MA',
    ended: true,
  }

  const mockShow2: SeriesSearchResult = {
    tvdbId: 23456,
    tmdbId: 78901,
    imdbId: 'tt3032476',
    title: 'Better Call Saul',
    titleSlug: 'better-call-saul',
    year: 2015,
    overview: 'The trials and tribulations of criminal lawyer Jimmy McGill...',
    runtime: 46,
    network: 'AMC',
    status: SonarrSeriesStatus.ENDED,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: false },
    ],
    genres: ['Drama', 'Crime'],
    rating: 8.9,
    posterPath: '/path/to/better-call-saul-poster.jpg',
    certification: 'TV-MA',
    ended: true,
  }

  const mockShow3: SeriesSearchResult = {
    tvdbId: 34567,
    tmdbId: 89012,
    imdbId: 'tt2085059',
    title: 'Black Mirror',
    titleSlug: 'black-mirror',
    year: 2011,
    overview:
      'An anthology series exploring a twisted, high-tech multiverse...',
    runtime: 60,
    network: 'Netflix',
    status: SonarrSeriesStatus.CONTINUING,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: false },
    ],
    genres: ['Science Fiction', 'Thriller', 'Drama'],
    rating: 8.8,
    posterPath: '/path/to/black-mirror-poster.jpg',
    certification: 'TV-MA',
    ended: false,
  }

  // Mock granular selections
  const mockEntireSeriesSelection: TvShowSelection = {
    selection: undefined,
  }

  const mockEntireSeriesSelectionEmptyArray: TvShowSelection = {
    selection: [],
  }

  const mockSeasonSelection: TvShowSelection = {
    selection: [{ season: 1 }],
  }

  const mockEpisodeSelection: TvShowSelection = {
    selection: [{ season: 1, episodes: [1, 2, 3] }],
  }

  const mockMultiSeasonSelection: TvShowSelection = {
    selection: [{ season: 1 }, { season: 2 }],
  }

  // Mock download results
  const mockSuccessResult: MonitorAndDownloadSeriesResult = {
    success: true,
    seriesAdded: true,
    seriesUpdated: false,
    searchTriggered: true,
    changes: [],
  }

  const mockFailureResult: MonitorAndDownloadSeriesResult = {
    success: false,
    seriesAdded: false,
    seriesUpdated: false,
    searchTriggered: false,
    changes: [],
    error: 'Failed to add series to Sonarr',
  }

  // Mock state object (passed in params, not DI) - context methods removed, now in ContextManagementService
  const mockState = {}

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TvDownloadStrategy,
        {
          provide: SonarrService,
          useValue: {
            searchShows: jest.fn(),
            monitorAndDownloadSeries: jest.fn(),
          },
        },
        {
          provide: PromptGenerationService,
          useValue: {
            generateTvShowChatResponse: jest.fn(),
          },
        },
        {
          provide: ParsingUtilities,
          useValue: {
            parseInitialSelection: jest.fn(),
            parseSearchSelection: jest.fn(),
            parseTvShowSelection: jest.fn(),
          },
        },
        {
          provide: SelectionUtilities,
          useValue: {
            findSelectedShow: jest.fn(),
          },
        },
        {
          provide: StateService,
          useValue: {
            getState: jest.fn().mockReturnValue({
              chatModel: 'gpt-4',
              temperature: 0.7,
            }),
            setUserTvShowContext: jest.fn(),
            clearUserTvShowContext: jest.fn(),
          },
        },
        {
          provide: ContextManagementService,
          useValue: {
            setContext: jest.fn(),
            getContext: jest.fn(),
            clearContext: jest.fn(),
          },
        },
      ],
    }).compile()

    strategy = module.get<TvDownloadStrategy>(TvDownloadStrategy)
    sonarrService = module.get(SonarrService)
    promptService = module.get(PromptGenerationService)
    parsingUtilities = module.get(ParsingUtilities)
    selectionUtilities = module.get(SelectionUtilities)
    contextService = module.get(ContextManagementService)

    // Reset context service mocks
    contextService.setContext.mockClear()
    contextService.clearContext.mockClear()
  })

  testStrategyRouting({
    getStrategy: () => strategy,
    mocks: {
      parsingUtils: {
        parseInitialSelection: () => parsingUtilities.parseInitialSelection,
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
        parseTvShowSelection: () => parsingUtilities.parseTvShowSelection,
      },
      selectionUtils: {
        findSelectedItem: () => selectionUtilities.findSelectedShow,
      },
      mediaService: {
        searchOrLibraryMethod: () => sonarrService.searchShows,
        operationMethod: () => sonarrService.monitorAndDownloadSeries,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateTvShowChatResponse,
      },
    },
    fixtures: {
      validContext: {
        type: 'tvShow',
        isActive: true,
        searchResults: [mockShow1, mockShow2],
        query: 'breaking',
        timestamp: Date.now(),
      },
      mediaItems: [mockShow1, mockShow2, mockShow3],
      operationResult: mockSuccessResult,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'tv show',
      contextType: 'tvShow',
      wrongContextType: 'movie',
      inactiveContextType: 'tvShow',
      exampleMessage: 'download breaking bad',
    },
    mockState,
  })

  describe('New TV Show Search - Basic Flows', () => {
    it('should return clarification when search query is empty', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download a tv show' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: '',
        selection: null,
        tvSelection: null,
      })
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(sonarrService.searchShows).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toBe(mockChatResponse)
      expect(result.images).toEqual([])
    })

    it('should return no_results message when no shows found', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download nonexistent show',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'nonexistent',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([])
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
      expect(result.images).toEqual([])
    })

    it('should store single show in context and ask for granular selection when no TV selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking bad',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).toHaveBeenCalledWith('user123', 'tv', {
        type: 'tvShow',
        searchResults: [mockShow1],
        query: 'breaking bad',
        timestamp: expect.any(Number),
        isActive: true,
        originalSearchSelection: undefined,
        originalTvSelection: undefined,
      })
      expect(sonarrService.monitorAndDownloadSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should store multiple shows in context and ask user to choose when multiple results found', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download breaking' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([
        mockShow1,
        mockShow2,
        mockShow3,
      ])
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).toHaveBeenCalledWith('user123', 'tv', {
        type: 'tvShow',
        searchResults: [mockShow1, mockShow2, mockShow3],
        query: 'breaking',
        timestamp: expect.any(Number),
        isActive: true,
        originalSearchSelection: undefined,
        originalTvSelection: undefined,
      })
      expect(sonarrService.monitorAndDownloadSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should handle SonarrService search errors gracefully', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking bad',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockRejectedValue(
        new Error('Sonarr service unavailable'),
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })
  })

  describe('New TV Show Search - Complete Auto-Selection (Ordinal + Granular)', () => {
    it('should auto-select show with ordinal and download when granular selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the second show, season 1',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'ordinal', value: '2' },
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([
        mockShow1,
        mockShow2,
        mockShow3,
      ])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow2)
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should fall back to list when auto-selection fails with invalid ordinal', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the 5th show, all episodes',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'ordinal', value: '5' },
        tvSelection: mockEntireSeriesSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(null)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(sonarrService.monitorAndDownloadSeries).not.toHaveBeenCalled()
      expect(contextService.setContext).toHaveBeenCalledWith('user123', 'tv', {
        type: 'tvShow',
        searchResults: [mockShow1, mockShow2],
        query: 'breaking',
        timestamp: expect.any(Number),
        isActive: true,
        originalSearchSelection: { selectionType: 'ordinal', value: '5' },
        originalTvSelection: mockEntireSeriesSelection,
      })
      expect(result.messages).toHaveLength(1)
    })

    it('should return error when download fails during auto-selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the first show, season 1',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: { selectionType: 'ordinal', value: '1' },
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockFailureResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should not store context when complete auto-selection succeeds', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the first show, all seasons',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'ordinal', value: '1' },
        tvSelection: mockEntireSeriesSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      await strategy.handleRequest(params)

      expect(contextService.setContext).not.toHaveBeenCalled()
      expect(contextService.clearContext).not.toHaveBeenCalled()
    })
  })

  describe('New TV Show Search - Complete Auto-Selection (Year + Granular)', () => {
    it('should auto-select by year and download when granular selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking 2008, season 1',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'year', value: '2008' },
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([
        mockShow1,
        mockShow2,
        mockShow3,
      ])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should fall back to list when year match fails', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking 1999, all episodes',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'year', value: '1999' },
        tvSelection: mockEntireSeriesSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(null)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(sonarrService.monitorAndDownloadSeries).not.toHaveBeenCalled()
      expect(contextService.setContext).toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should return error when download fails during year auto-selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking 2008, season 1',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'year', value: '2008' },
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockFailureResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })
  })

  describe('New TV Show Search - Show-Only Auto-Selection', () => {
    it('should auto-select show with ordinal and store in context when no granular selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the second show',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'ordinal', value: '2' },
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow2)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).toHaveBeenCalledWith('user123', 'tv', {
        type: 'tvShow',
        searchResults: [mockShow2],
        query: 'breaking',
        timestamp: expect.any(Number),
        isActive: true,
        originalSearchSelection: { selectionType: 'ordinal', value: '2' },
        originalTvSelection: undefined,
      })
      expect(result.messages).toHaveLength(1)
    })

    it('should auto-select by year and store in context when no granular selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking 2008',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'year', value: '2008' },
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).toHaveBeenCalledWith('user123', 'tv', {
        type: 'tvShow',
        searchResults: [mockShow1],
        query: 'breaking',
        timestamp: expect.any(Number),
        isActive: true,
        originalSearchSelection: { selectionType: 'year', value: '2008' },
        originalTvSelection: undefined,
      })
      expect(result.messages).toHaveLength(1)
    })

    it('should fall back to list when ordinal selection fails', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download the 10th show',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking',
        selection: { selectionType: 'ordinal', value: '10' },
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1, mockShow2])
      selectionUtilities.findSelectedShow.mockReturnValue(null)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).toHaveBeenCalledWith('user123', 'tv', {
        type: 'tvShow',
        searchResults: [mockShow1, mockShow2],
        query: 'breaking',
        timestamp: expect.any(Number),
        isActive: true,
        originalSearchSelection: { selectionType: 'ordinal', value: '10' },
        originalTvSelection: undefined,
      })
      expect(result.messages).toHaveLength(1)
    })
  })

  describe('New TV Show Search - Single Result Scenarios', () => {
    it('should auto-download immediately when single result found with granular selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking bad season 1',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: null,
        tvSelection: mockSeasonSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should store single result and ask for granular selection when no granular selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking bad',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: null,
        tvSelection: null,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(sonarrService.monitorAndDownloadSeries).not.toHaveBeenCalled()
      expect(contextService.setContext).toHaveBeenCalledWith('user123', 'tv', {
        type: 'tvShow',
        searchResults: [mockShow1],
        query: 'breaking bad',
        timestamp: expect.any(Number),
        isActive: true,
        originalSearchSelection: undefined,
        originalTvSelection: undefined,
      })
      expect(result.messages).toHaveLength(1)
    })

    it('should return error message when single result download fails', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download breaking bad all episodes',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'breaking bad',
        selection: null,
        tvSelection: mockEntireSeriesSelection,
      })
      sonarrService.searchShows.mockResolvedValue([mockShow1])
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockFailureResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })
  })

  describe('Selection from Context - Multiple Shows', () => {
    it('should parse ordinal selection and move to granular selection phase when show selected from context', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the first one' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).toHaveBeenCalledWith(
        'user123',
        'tv',
        expect.objectContaining({
          searchResults: [mockShow1],
        }),
      )
      expect(result.messages).toHaveLength(1)
    })

    it('should parse year selection and move to granular selection phase when show selected from context', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: '2015' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'year',
        value: '2015',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow2)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).toHaveBeenCalledWith(
        'user123',
        'tv',
        expect.objectContaining({
          searchResults: [mockShow2],
        }),
      )
      expect(result.messages).toHaveLength(1)
    })

    it('should auto-apply stored granular selection when show selected from context', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the second one' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
          originalTvSelection: mockSeasonSelection,
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '2',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow2)
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.clearContext).toHaveBeenCalledWith('user123')
      expect(result.messages).toHaveLength(1)
    })

    it('should re-prompt when selection is unparseable', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'something random' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockRejectedValue(
        new Error('Could not parse selection'),
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(selectionUtilities.findSelectedShow).not.toHaveBeenCalled()
      expect(sonarrService.monitorAndDownloadSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should re-prompt when ordinal selection is out of range', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the fifth one' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '5',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(null)
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(sonarrService.monitorAndDownloadSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should clear context when download succeeds with stored granular selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the first one' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1, mockShow2],
          query: 'breaking',
          timestamp: Date.now(),
          originalTvSelection: mockEntireSeriesSelection,
        },
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedShow.mockReturnValue(mockShow1)
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      await strategy.handleRequest(params)

      expect(contextService.clearContext).toHaveBeenCalledWith('user123')
    })
  })

  describe('Selection from Context - Single Show Granular Selection', () => {
    it('should parse and apply entire series selection when selection is undefined', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'all episodes' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEntireSeriesSelection,
      )
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.clearContext).toHaveBeenCalledWith('user123')
      expect(result.messages).toHaveLength(1)
    })

    it('should parse and apply entire series selection when selection is empty array', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'everything' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEntireSeriesSelectionEmptyArray,
      )
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.clearContext).toHaveBeenCalledWith('user123')
      expect(result.messages).toHaveLength(1)
    })

    it('should parse and apply specific season selection when user provides season', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'season 1' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockSeasonSelection,
      )
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.clearContext).toHaveBeenCalledWith('user123')
      expect(result.messages).toHaveLength(1)
    })

    it('should parse and apply specific episode selection when user provides episodes', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'season 1 episodes 1, 2, 3',
        }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEpisodeSelection,
      )
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(contextService.clearContext).toHaveBeenCalledWith('user123')
      expect(result.messages).toHaveLength(1)
    })

    it('should re-prompt when granular selection is unparseable', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'random text' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockRejectedValue(
        new Error('Could not parse TV show selection'),
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(sonarrService.monitorAndDownloadSeries).not.toHaveBeenCalled()
      expect(contextService.clearContext).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should clear context when download succeeds', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'season 1' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockSeasonSelection,
      )
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      await strategy.handleRequest(params)

      expect(contextService.clearContext).toHaveBeenCalledWith('user123')
    })
  })

  describe('Download Success and Failure', () => {
    it('should return success response when series download succeeds', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'all episodes' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEntireSeriesSelection,
      )
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
      expect(result.images).toEqual([])
    })

    it('should return error response when series download fails', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'season 1' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockSeasonSelection,
      )
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockFailureResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should handle errors gracefully when service throws exception during download', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'all episodes' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockEntireSeriesSelection,
      )
      sonarrService.monitorAndDownloadSeries.mockRejectedValue(
        new Error('Network error'),
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should pass correct parameters to SonarrService.monitorAndDownloadSeries when downloading', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'seasons 1 and 2' }),
        messages: [],
        userId: 'user123',
        context: {
          type: 'tvShow',
          isActive: true,
          searchResults: [mockShow1],
          query: 'breaking bad',
          timestamp: Date.now(),
        },
        state: mockState,
      }

      parsingUtilities.parseTvShowSelection.mockResolvedValue(
        mockMultiSeasonSelection,
      )
      sonarrService.monitorAndDownloadSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toBeDefined()
    })
  })

  // ============================================================================
  // Shared Edge Case Tests
  // ============================================================================
  testStrategyEdgeCases({
    getStrategy: () => strategy,
    mocks: {
      parsingUtils: {
        parseInitialSelection: () => parsingUtilities.parseInitialSelection,
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
      },
      selectionUtils: {
        findSelectedItem: () => selectionUtilities.findSelectedShow,
      },
      mediaService: {
        searchMethod: () => sonarrService.searchShows,
        operationMethod: () => sonarrService.monitorAndDownloadSeries,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateTvShowChatResponse,
      },
      contextService: {
        setContext: () => contextService.setContext,
        clearContext: () => contextService.clearContext,
      },
    },
    fixtures: {
      mediaItems: [mockShow1, mockShow2, mockShow3],
      operationResult: mockSuccessResult,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'tv show',
      contextType: 'tvShow',
      serviceName: 'SonarrService',
      searchMethodName: 'searchShows',
      operationMethodName: 'monitorAndDownloadSeries',
      errorPromptType: 'TV_SHOW_ERROR',
      processingErrorPromptType: 'TV_SHOW_PROCESSING_ERROR',
    },
  })
})
