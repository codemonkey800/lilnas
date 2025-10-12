import { HumanMessage } from '@langchain/core/messages'
import { Test, TestingModule } from '@nestjs/testing'

import { SonarrService } from 'src/media/services/sonarr.service'
import {
  SonarrSeriesStatus,
  SonarrSeriesType,
  UnmonitorAndDeleteSeriesResult,
} from 'src/media/types/sonarr.types'
import { testStrategyEdgeCases } from 'src/media-operations/request-handling/__test-helpers__/strategy-edge-cases-suite'
import { testStrategyRouting } from 'src/media-operations/request-handling/__test-helpers__/strategy-routing-suite'
import { TvDeleteStrategy } from 'src/media-operations/request-handling/strategies/tv-delete.strategy'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { LibrarySearchResult } from 'src/schemas/tv-show'
import { StateService } from 'src/state/state.service'

describe('TvDeleteStrategy', () => {
  let strategy: TvDeleteStrategy
  let sonarrService: jest.Mocked<SonarrService>
  let promptService: jest.Mocked<PromptGenerationService>
  let parsingUtilities: jest.Mocked<ParsingUtilities>
  let selectionUtilities: jest.Mocked<SelectionUtilities>
  let stateService: jest.Mocked<StateService>

  // Mock response messages
  const mockChatResponse = new HumanMessage({
    id: 'mock-response-id',
    content: 'Here is your TV show delete response...',
  })

  // Mock TV show library results
  const mockLibraryShow1: LibrarySearchResult = {
    id: 1,
    tvdbId: 81189,
    tmdbId: 1396,
    imdbId: 'tt0903747',
    title: 'Breaking Bad',
    titleSlug: 'breaking-bad',
    year: 2008,
    overview: 'A high school chemistry teacher turned meth cook...',
    runtime: 45,
    network: 'AMC',
    status: SonarrSeriesStatus.ENDED,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
      { seasonNumber: 3, monitored: true },
      { seasonNumber: 4, monitored: true },
      { seasonNumber: 5, monitored: true },
    ],
    genres: ['Drama', 'Crime', 'Thriller'],
    rating: 9.5,
    posterPath: '/path/to/breaking-bad-poster.jpg',
    backdropPath: '/path/to/breaking-bad-backdrop.jpg',
    certification: 'TV-MA',
    ended: true,
    monitored: true,
    path: '/tv/Breaking Bad',
    added: '2023-01-01T00:00:00Z',
    statistics: {
      seasonCount: 5,
      episodeFileCount: 62,
      episodeCount: 62,
      totalEpisodeCount: 62,
      sizeOnDisk: 30000000000,
      percentOfEpisodes: 100,
    },
  }

  const mockLibraryShow2: LibrarySearchResult = {
    id: 2,
    tvdbId: 272903,
    tmdbId: 60059,
    imdbId: 'tt3032476',
    title: 'Better Call Saul',
    titleSlug: 'better-call-saul',
    year: 2015,
    overview: 'Six years before Saul Goodman meets Walter White...',
    runtime: 46,
    network: 'AMC',
    status: SonarrSeriesStatus.ENDED,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
      { seasonNumber: 3, monitored: true },
      { seasonNumber: 4, monitored: true },
      { seasonNumber: 5, monitored: true },
      { seasonNumber: 6, monitored: true },
    ],
    genres: ['Drama', 'Crime'],
    rating: 8.9,
    posterPath: '/path/to/bcs-poster.jpg',
    backdropPath: '/path/to/bcs-backdrop.jpg',
    certification: 'TV-MA',
    ended: true,
    monitored: true,
    path: '/tv/Better Call Saul',
    added: '2023-01-01T00:00:00Z',
    statistics: {
      seasonCount: 6,
      episodeFileCount: 63,
      episodeCount: 63,
      totalEpisodeCount: 63,
      sizeOnDisk: 32000000000,
      percentOfEpisodes: 100,
    },
  }

  const mockLibraryShow3: LibrarySearchResult = {
    id: 3,
    tvdbId: 73739,
    tmdbId: 1408,
    imdbId: 'tt0369179',
    title: 'Breaking In',
    titleSlug: 'breaking-in',
    year: 2011,
    overview: 'A group of high-tech security experts...',
    runtime: 22,
    network: 'Fox',
    status: SonarrSeriesStatus.ENDED,
    seriesType: SonarrSeriesType.STANDARD,
    seasons: [
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
    ],
    genres: ['Comedy', 'Action'],
    rating: 7.3,
    posterPath: '/path/to/breaking-in-poster.jpg',
    backdropPath: '/path/to/breaking-in-backdrop.jpg',
    certification: 'TV-14',
    ended: true,
    monitored: true,
    path: '/tv/Breaking In',
    added: '2023-01-01T00:00:00Z',
    statistics: {
      seasonCount: 2,
      episodeFileCount: 20,
      episodeCount: 20,
      totalEpisodeCount: 20,
      sizeOnDisk: 5000000000,
      percentOfEpisodes: 100,
    },
  }

  // Mock delete results
  const mockSuccessResult: UnmonitorAndDeleteSeriesResult = {
    success: true,
    seriesDeleted: true,
    episodesUnmonitored: false,
    downloadsCancel: false,
    canceledDownloads: 0,
    changes: [
      {
        season: 1,
        action: 'deleted_series',
      },
    ],
  }

  const mockFailureResult: UnmonitorAndDeleteSeriesResult = {
    success: false,
    seriesDeleted: false,
    episodesUnmonitored: false,
    downloadsCancel: false,
    canceledDownloads: 0,
    changes: [],
    error: 'Failed to delete series from Sonarr',
  }

  // Mock state object (passed in params, not DI)
  const mockState = {
    setUserTvShowDeleteContext: jest.fn(),
    clearUserTvShowDeleteContext: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TvDeleteStrategy,
        {
          provide: SonarrService,
          useValue: {
            getLibrarySeries: jest.fn(),
            unmonitorAndDeleteSeries: jest.fn(),
          },
        },
        {
          provide: PromptGenerationService,
          useValue: {
            generateTvShowDeleteChatResponse: jest.fn(),
          },
        },
        {
          provide: ParsingUtilities,
          useValue: {
            extractTvDeleteQueryWithLLM: jest.fn(),
            parseSearchSelection: jest.fn(),
            parseTvShowSelection: jest.fn(),
          },
        },
        {
          provide: SelectionUtilities,
          useValue: {
            findSelectedTvShowFromLibrary: jest.fn(),
          },
        },
        {
          provide: StateService,
          useValue: {
            getState: jest.fn().mockReturnValue({
              chatModel: 'gpt-4',
              temperature: 0.7,
            }),
            setUserTvShowDeleteContext: jest.fn(),
            clearUserTvShowDeleteContext: jest.fn(),
          },
        },
        {
          provide: ContextManagementService,
          useValue: {
            setContext: jest.fn().mockResolvedValue(undefined),
            clearContext: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile()

    strategy = module.get<TvDeleteStrategy>(TvDeleteStrategy)
    sonarrService = module.get(SonarrService)
    promptService = module.get(PromptGenerationService)
    parsingUtilities = module.get(ParsingUtilities)
    selectionUtilities = module.get(SelectionUtilities)
    stateService = module.get(StateService)

    // Reset state mocks
    mockState.setUserTvShowDeleteContext.mockClear()
    mockState.clearUserTvShowDeleteContext.mockClear()
    stateService.setUserTvShowDeleteContext.mockClear()
    stateService.clearUserTvShowDeleteContext.mockClear()
  })

  testStrategyRouting({
    getStrategy: () => strategy,
    mocks: {
      parsingUtils: {
        parseInitialSelection: () =>
          parsingUtilities.extractTvDeleteQueryWithLLM,
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
        parseTvShowSelection: () => parsingUtilities.parseTvShowSelection,
      },
      selectionUtils: {
        findSelectedItem: () =>
          selectionUtilities.findSelectedTvShowFromLibrary,
      },
      mediaService: {
        searchOrLibraryMethod: () => sonarrService.getLibrarySeries,
        operationMethod: () => sonarrService.unmonitorAndDeleteSeries,
      },
      promptService: {
        generatePromptMethod: () =>
          promptService.generateTvShowDeleteChatResponse,
      },
    },
    fixtures: {
      validContext: {
        type: 'tvShowDelete',
        isActive: true,
        searchResults: [mockLibraryShow1, mockLibraryShow2],
        query: 'breaking',
        timestamp: Date.now(),
      },
      mediaItems: [mockLibraryShow1, mockLibraryShow2, mockLibraryShow3],
      operationResult: mockSuccessResult,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'tv show',
      contextType: 'tvShowDelete',
      wrongContextType: 'tvShow',
      inactiveContextType: 'tvShowDelete',
      exampleMessage: 'delete breaking bad',
    },
    mockState,
  })

  describe('New TV Show Delete - Basic Flows', () => {
    it('should return clarification when search query is empty', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'delete a show' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue('')
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(sonarrService.getLibrarySeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toBe(mockChatResponse)
      expect(result.images).toEqual([])
    })

    it('should return no_results message when no library shows found', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete nonexistent show',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue(
        'nonexistent',
      )
      parsingUtilities.parseSearchSelection.mockResolvedValue(null as any)
      parsingUtilities.parseTvShowSelection.mockResolvedValue(null as any)
      sonarrService.getLibrarySeries.mockResolvedValue([])
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
      expect(result.images).toEqual([])
    })

    it('should create context and ask for series selection when single result found and no TV selection provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete breaking bad',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue(
        'breaking bad',
      )
      parsingUtilities.parseSearchSelection.mockResolvedValue(null as any)
      parsingUtilities.parseTvShowSelection.mockResolvedValue(null as any)
      sonarrService.getLibrarySeries.mockResolvedValue([mockLibraryShow1])
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.setUserTvShowDeleteContext).toHaveBeenCalledWith(
        'user123',
        expect.objectContaining({
          type: 'tvShowDelete',
          searchResults: [mockLibraryShow1],
          query: 'breaking bad',
          isActive: true,
        }),
      )
      expect(sonarrService.unmonitorAndDeleteSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should auto-delete when single result found with valid TV selection for episodes or seasons', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete breaking bad season 1',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue(
        'breaking bad',
      )
      parsingUtilities.parseSearchSelection.mockResolvedValue(null as any)
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      sonarrService.getLibrarySeries.mockResolvedValue([mockLibraryShow1])
      sonarrService.unmonitorAndDeleteSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.setUserTvShowDeleteContext).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should auto-delete when single result found with entire series selection as empty object', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete breaking bad entirely',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue(
        'breaking bad',
      )
      parsingUtilities.parseSearchSelection.mockResolvedValue(null as any)
      parsingUtilities.parseTvShowSelection.mockResolvedValue({})
      sonarrService.getLibrarySeries.mockResolvedValue([mockLibraryShow1])
      sonarrService.unmonitorAndDeleteSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.setUserTvShowDeleteContext).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should store context and show list when multiple results found and no selections provided', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'delete breaking' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue('breaking')
      parsingUtilities.parseSearchSelection.mockResolvedValue(null as any)
      parsingUtilities.parseTvShowSelection.mockResolvedValue(null as any)
      sonarrService.getLibrarySeries.mockResolvedValue([
        mockLibraryShow1,
        mockLibraryShow3,
      ])
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.setUserTvShowDeleteContext).toHaveBeenCalledWith(
        'user123',
        expect.objectContaining({
          type: 'tvShowDelete',
          searchResults: [mockLibraryShow1, mockLibraryShow3],
          query: 'breaking',
          isActive: true,
        }),
      )
      expect(sonarrService.unmonitorAndDeleteSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should handle SonarrService library search errors gracefully', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete breaking bad',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue(
        'breaking bad',
      )
      parsingUtilities.parseSearchSelection.mockResolvedValue(null as any)
      parsingUtilities.parseTvShowSelection.mockResolvedValue(null as any)
      sonarrService.getLibrarySeries.mockRejectedValue(
        new Error('Sonarr service unavailable'),
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })
  })

  describe('New TV Show Delete - Auto-Selection with Ordinal', () => {
    it('should auto-select and delete show when valid ordinal is provided in search query with TV selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete the second show season 1',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue('breaking')
      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '2',
      })
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      sonarrService.getLibrarySeries.mockResolvedValue([
        mockLibraryShow1,
        mockLibraryShow3,
      ])
      selectionUtilities.findSelectedTvShowFromLibrary.mockReturnValue(
        mockLibraryShow3,
      )
      sonarrService.unmonitorAndDeleteSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })
  })

  describe('New TV Show Delete - Auto-Selection with Year', () => {
    it('should auto-select and delete show by year when year is provided in search query with TV selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete breaking from 2008 season 1',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue('breaking')
      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'year',
        value: '2008',
      })
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      sonarrService.getLibrarySeries.mockResolvedValue([
        mockLibraryShow1,
        mockLibraryShow3,
      ])
      selectionUtilities.findSelectedTvShowFromLibrary.mockReturnValue(
        mockLibraryShow1,
      )
      sonarrService.unmonitorAndDeleteSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should fall back to showing list when year is not found in library', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete breaking from 2020',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue('breaking')
      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'year',
        value: '2020',
      })
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      sonarrService.getLibrarySeries.mockResolvedValue([
        mockLibraryShow1,
        mockLibraryShow3,
      ])
      selectionUtilities.findSelectedTvShowFromLibrary.mockReturnValue(null)
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.setUserTvShowDeleteContext).toHaveBeenCalledWith(
        'user123',
        expect.objectContaining({
          type: 'tvShowDelete',
          searchResults: [mockLibraryShow1, mockLibraryShow3],
          query: 'breaking',
          isActive: true,
        }),
      )
      expect(sonarrService.unmonitorAndDeleteSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })
  })

  describe('New TV Show Delete - Failed Auto-Selection', () => {
    it('should fall back to showing list when ordinal selection is out of range', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete the fifth show',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue('breaking')
      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '5',
      })
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      sonarrService.getLibrarySeries.mockResolvedValue([
        mockLibraryShow1,
        mockLibraryShow3,
      ])
      selectionUtilities.findSelectedTvShowFromLibrary.mockReturnValue(null)
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.setUserTvShowDeleteContext).toHaveBeenCalledWith(
        'user123',
        expect.objectContaining({
          type: 'tvShowDelete',
          searchResults: [mockLibraryShow1, mockLibraryShow3],
          query: 'breaking',
          isActive: true,
        }),
      )
      expect(sonarrService.unmonitorAndDeleteSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should fall back to showing list when findSelectedTvShowFromLibrary returns null due to invalid selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete the first show',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue('breaking')
      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      sonarrService.getLibrarySeries.mockResolvedValue([
        mockLibraryShow1,
        mockLibraryShow3,
      ])
      selectionUtilities.findSelectedTvShowFromLibrary.mockReturnValue(null)
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.setUserTvShowDeleteContext).toHaveBeenCalled()
      expect(sonarrService.unmonitorAndDeleteSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })
  })

  describe('Selection from Context', () => {
    const tvShowDeleteContext = {
      type: 'tvShowDelete' as const,
      searchResults: [mockLibraryShow1, mockLibraryShow2, mockLibraryShow3],
      query: 'breaking',
      timestamp: Date.now(),
      isActive: true,
    }

    it('should delete show and clear context when valid ordinal is selected with TV selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'first one, season 1' }),
        messages: [],
        userId: 'user123',
        context: tvShowDeleteContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      selectionUtilities.findSelectedTvShowFromLibrary.mockReturnValue(
        mockLibraryShow1,
      )
      sonarrService.unmonitorAndDeleteSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.clearUserTvShowDeleteContext).toHaveBeenCalledWith(
        'user123',
      )
      expect(result.messages).toHaveLength(1)
    })

    it('should delete show and clear context when valid year is selected with TV selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'the 2008 one, season 1',
        }),
        messages: [],
        userId: 'user123',
        context: tvShowDeleteContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'year',
        value: '2008',
      })
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      selectionUtilities.findSelectedTvShowFromLibrary.mockReturnValue(
        mockLibraryShow1,
      )
      sonarrService.unmonitorAndDeleteSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.clearUserTvShowDeleteContext).toHaveBeenCalledWith(
        'user123',
      )
      expect(result.messages).toHaveLength(1)
    })

    it('should re-show list when parseSearchSelection fails to parse user input', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'that one' }),
        messages: [],
        userId: 'user123',
        context: tvShowDeleteContext,
        state: mockState,
      }

      // The strategy catches parse errors and returns null via .catch(() => null)
      parsingUtilities.parseSearchSelection.mockRejectedValue(
        new Error('Parse failed'),
      )
      parsingUtilities.parseTvShowSelection.mockResolvedValue(null as any)
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.clearUserTvShowDeleteContext).not.toHaveBeenCalled()
      expect(sonarrService.unmonitorAndDeleteSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should re-show list when findSelectedTvShowFromLibrary returns null due to invalid selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'tenth one' }),
        messages: [],
        userId: 'user123',
        context: tvShowDeleteContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '10',
      })
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      selectionUtilities.findSelectedTvShowFromLibrary.mockReturnValue(null)
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.clearUserTvShowDeleteContext).not.toHaveBeenCalled()
      expect(sonarrService.unmonitorAndDeleteSeries).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should clear context and show error when outer try-catch catches unexpected error', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'first one' }),
        messages: [],
        userId: 'user123',
        context: tvShowDeleteContext,
        state: mockState,
      }

      // Make findSelectedTvShowFromLibrary throw an error to trigger outer catch block
      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      selectionUtilities.findSelectedTvShowFromLibrary.mockImplementation(
        () => {
          throw new Error('Unexpected error')
        },
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.clearUserTvShowDeleteContext).toHaveBeenCalledWith(
        'user123',
      )
      expect(result.messages).toHaveLength(1)
    })

    it('should delete show and clear context when entire series selection (empty object) is provided for single result', async () => {
      const singleResultContext = {
        type: 'tvShowDelete' as const,
        searchResults: [mockLibraryShow1],
        query: 'breaking bad',
        timestamp: Date.now(),
        isActive: true,
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'entire series' }),
        messages: [],
        userId: 'user123',
        context: singleResultContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue(null as any)
      parsingUtilities.parseTvShowSelection.mockResolvedValue({})
      sonarrService.unmonitorAndDeleteSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(sonarrService.unmonitorAndDeleteSeries).toHaveBeenCalledWith(
        mockLibraryShow1.tvdbId,
        expect.objectContaining({
          selection: undefined,
          deleteFiles: true,
        }),
      )
      expect(mockState.clearUserTvShowDeleteContext).toHaveBeenCalledWith(
        'user123',
      )
      expect(result.messages).toHaveLength(1)
    })

    it('should delete show and clear context when entire series selection (empty object) is provided for multiple results with search selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'first one, entire series',
        }),
        messages: [],
        userId: 'user123',
        context: tvShowDeleteContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      parsingUtilities.parseTvShowSelection.mockResolvedValue({})
      selectionUtilities.findSelectedTvShowFromLibrary.mockReturnValue(
        mockLibraryShow1,
      )
      sonarrService.unmonitorAndDeleteSeries.mockResolvedValue(
        mockSuccessResult,
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(sonarrService.unmonitorAndDeleteSeries).toHaveBeenCalledWith(
        mockLibraryShow1.tvdbId,
        expect.objectContaining({
          selection: undefined,
          deleteFiles: true,
        }),
      )
      expect(mockState.clearUserTvShowDeleteContext).toHaveBeenCalledWith(
        'user123',
      )
      expect(result.messages).toHaveLength(1)
    })
  })

  describe('Error Handling', () => {
    it('should handle errors gracefully when delete service throws exception', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete breaking bad season 1',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue(
        'breaking bad',
      )
      parsingUtilities.parseSearchSelection.mockResolvedValue(null as any)
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      sonarrService.getLibrarySeries.mockResolvedValue([mockLibraryShow1])
      sonarrService.unmonitorAndDeleteSeries.mockRejectedValue(
        new Error('Delete service error'),
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should return error response when delete result indicates failure from service', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete breaking bad season 1',
        }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.extractTvDeleteQueryWithLLM.mockResolvedValue(
        'breaking bad',
      )
      parsingUtilities.parseSearchSelection.mockResolvedValue(null as any)
      parsingUtilities.parseTvShowSelection.mockResolvedValue({
        selection: [{ season: 1 }],
      })
      sonarrService.getLibrarySeries.mockResolvedValue([mockLibraryShow1])
      sonarrService.unmonitorAndDeleteSeries.mockResolvedValue(
        mockFailureResult,
      )
      promptService.generateTvShowDeleteChatResponse.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })
  })

  // ============================================================================
  // Shared Edge Case Tests
  // ============================================================================
  testStrategyEdgeCases({
    getStrategy: () => strategy,
    mocks: {
      parsingUtils: {
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
      },
      selectionUtils: {
        findSelectedItem: () =>
          selectionUtilities.findSelectedTvShowFromLibrary,
      },
      mediaService: {
        searchMethod: () => sonarrService.getLibrarySeries,
        operationMethod: () => sonarrService.unmonitorAndDeleteSeries,
      },
      promptService: {
        generatePromptMethod: () =>
          promptService.generateTvShowDeleteChatResponse,
      },
      stateService: {
        setContextMethod: () => stateService.setUserTvShowDeleteContext,
        clearContextMethod: () => stateService.clearUserTvShowDeleteContext,
      },
    },
    fixtures: {
      mediaItems: [mockLibraryShow1, mockLibraryShow2, mockLibraryShow3],
      operationResult: mockSuccessResult,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'tv show',
      contextType: 'tvShowDelete',
      setContextMethod: 'setUserTvShowDeleteContext',
      clearContextMethod: 'clearUserTvShowDeleteContext',
      serviceName: 'SonarrService',
      searchMethodName: 'getLibrarySeries',
      operationMethodName: 'unmonitorAndDeleteSeries',
      errorPromptType: 'TV_SHOW_DELETE_ERROR',
      processingErrorPromptType: 'TV_SHOW_DELETE_ERROR',
    },
  })
})
