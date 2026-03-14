import { HumanMessage } from '@langchain/core/messages'
import { Test, TestingModule } from '@nestjs/testing'

import { RadarrService } from 'src/media/services/radarr.service'
import {
  MonitorAndDownloadResult,
  MovieSearchResult,
  RadarrMovieStatus,
} from 'src/media/types/radarr.types'
import { testSelectionBehavior } from 'src/media-operations/request-handling/__test-helpers__/selection-behavior-suite'
import { testStrategyEdgeCases } from 'src/media-operations/request-handling/__test-helpers__/strategy-edge-cases-suite'
import { testStrategyRouting } from 'src/media-operations/request-handling/__test-helpers__/strategy-routing-suite'
import { MovieDownloadStrategy } from 'src/media-operations/request-handling/strategies/movie-download.strategy'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { StateService } from 'src/state/state.service'

describe('MovieDownloadStrategy', () => {
  let strategy: MovieDownloadStrategy
  let radarrService: jest.Mocked<RadarrService>
  let promptService: jest.Mocked<PromptGenerationService>
  let parsingUtilities: jest.Mocked<ParsingUtilities>
  let selectionUtilities: jest.Mocked<SelectionUtilities>
  let contextService: jest.Mocked<ContextManagementService>

  // Mock response messages
  const mockChatResponse = new HumanMessage({
    id: 'mock-response-id',
    content: 'Here is your movie response...',
  })

  // Mock movie search results
  const mockMovie1: MovieSearchResult = {
    tmdbId: 603,
    imdbId: 'tt0133093',
    title: 'The Matrix',
    originalTitle: 'The Matrix',
    year: 1999,
    overview: 'Set in the 22nd century, The Matrix tells the story...',
    runtime: 136,
    genres: ['Action', 'Science Fiction'],
    rating: 8.2,
    posterPath: '/path/to/matrix-poster.jpg',
    backdropPath: '/path/to/matrix-backdrop.jpg',
    status: RadarrMovieStatus.RELEASED,
    certification: 'R',
    studio: 'Warner Bros.',
    popularity: 85.5,
  }

  const mockMovie2: MovieSearchResult = {
    tmdbId: 604,
    imdbId: 'tt0234215',
    title: 'The Matrix Reloaded',
    originalTitle: 'The Matrix Reloaded',
    year: 2003,
    overview: 'Six months after the events depicted in The Matrix...',
    runtime: 138,
    genres: ['Action', 'Science Fiction'],
    rating: 7.2,
    posterPath: '/path/to/reloaded-poster.jpg',
    backdropPath: '/path/to/reloaded-backdrop.jpg',
    status: RadarrMovieStatus.RELEASED,
    certification: 'R',
    studio: 'Warner Bros.',
    popularity: 72.3,
  }

  const mockMovie3: MovieSearchResult = {
    tmdbId: 605,
    imdbId: 'tt0242653',
    title: 'The Matrix Revolutions',
    originalTitle: 'The Matrix Revolutions',
    year: 2003,
    overview: 'The human city of Zion defends itself...',
    runtime: 129,
    genres: ['Action', 'Science Fiction'],
    rating: 6.7,
    posterPath: '/path/to/revolutions-poster.jpg',
    backdropPath: '/path/to/revolutions-backdrop.jpg',
    status: RadarrMovieStatus.RELEASED,
    certification: 'R',
    studio: 'Warner Bros.',
    popularity: 68.9,
  }

  // Mock download results
  const mockSuccessResult: MonitorAndDownloadResult = {
    success: true,
    movieAdded: true,
    searchTriggered: true,
  }

  const mockFailureResult: MonitorAndDownloadResult = {
    success: false,
    movieAdded: false,
    searchTriggered: false,
    error: 'Failed to add movie to Radarr',
  }

  // Mock state object (passed in params, not DI) - context methods removed, now in ContextManagementService
  const mockState = {}

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovieDownloadStrategy,
        {
          provide: RadarrService,
          useValue: {
            searchMovies: jest.fn(),
            monitorAndDownloadMovie: jest.fn(),
          },
        },
        {
          provide: PromptGenerationService,
          useValue: {
            generateMoviePrompt: jest.fn(),
          },
        },
        {
          provide: ParsingUtilities,
          useValue: {
            parseInitialSelection: jest.fn(),
            parseSearchSelection: jest.fn(),
          },
        },
        {
          provide: SelectionUtilities,
          useValue: {
            findSelectedMovie: jest.fn(),
          },
        },
        {
          provide: StateService,
          useValue: {
            getState: jest.fn().mockReturnValue({
              chatModel: 'gpt-4',
              temperature: 0.7,
            }),
            setUserMovieContext: jest.fn(),
            clearUserMovieContext: jest.fn(),
          },
        },
        {
          provide: ContextManagementService,
          useValue: {
            setContext: jest.fn().mockResolvedValue(undefined),
            clearContext: jest.fn().mockResolvedValue(true),
            getContext: jest.fn().mockResolvedValue(null),
            hasContext: jest.fn().mockResolvedValue(false),
          },
        },
      ],
    }).compile()

    strategy = module.get<MovieDownloadStrategy>(MovieDownloadStrategy)
    radarrService = module.get(RadarrService)
    promptService = module.get(PromptGenerationService)
    parsingUtilities = module.get(ParsingUtilities)
    selectionUtilities = module.get(SelectionUtilities)
    contextService = module.get(ContextManagementService)
  })

  testStrategyRouting({
    getStrategy: () => strategy,
    mocks: {
      parsingUtils: {
        parseInitialSelection: () => parsingUtilities.parseInitialSelection,
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
      },
      selectionUtils: {
        findSelectedItem: () => selectionUtilities.findSelectedMovie,
      },
      mediaService: {
        searchOrLibraryMethod: () => radarrService.searchMovies,
        operationMethod: () => radarrService.monitorAndDownloadMovie,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateMoviePrompt,
      },
    },
    fixtures: {
      validContext: {
        type: 'movie',
        isActive: true,
        searchResults: [mockMovie1, mockMovie2],
        query: 'matrix',
        timestamp: Date.now(),
      },
      mediaItems: [mockMovie1, mockMovie2, mockMovie3],
      operationResult: mockSuccessResult,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'movie',
      contextType: 'movie',
      wrongContextType: 'tv_show',
      inactiveContextType: 'movie',
      exampleMessage: 'download matrix',
    },
    mockState,
  })

  describe('New Movie Search - Basic Flows', () => {
    it('should return clarification when search query is empty', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download a movie' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: '',
        selection: null,
        tvSelection: null,
      })
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(radarrService.searchMovies).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toBe(mockChatResponse)
      expect(result.images).toEqual([])
    })

    it('should return no_results message when no movies found', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download nonexistent movie',
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
      radarrService.searchMovies.mockResolvedValue([])
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
      expect(result.images).toEqual([])
    })

    it('should auto-download immediately when single result found', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download matrix' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.searchMovies.mockResolvedValue([mockMovie1])
      radarrService.monitorAndDownloadMovie.mockResolvedValue(mockSuccessResult)
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should store context and show list when multiple results found without selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download matrix' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.searchMovies.mockResolvedValue([
        mockMovie1,
        mockMovie2,
        mockMovie3,
      ])
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(contextService.setContext).toHaveBeenCalledWith(
        'user123',
        'movie',
        {
          type: 'movie',
          searchResults: [mockMovie1, mockMovie2, mockMovie3],
          query: 'matrix',
          timestamp: expect.any(Number),
          isActive: true,
        },
      )
      expect(radarrService.monitorAndDownloadMovie).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should handle RadarrService search errors gracefully', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download matrix' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.searchMovies.mockRejectedValue(
        new Error('Radarr service unavailable'),
      )
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })
  })

  testSelectionBehavior({
    getStrategy: () => strategy,
    mocks: {
      parsingUtils: {
        parseInitialSelection: () => parsingUtilities.parseInitialSelection,
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
      },
      selectionUtils: {
        findSelectedItem: () => selectionUtilities.findSelectedMovie,
      },
      mediaService: {
        searchOrLibraryMethod: () => radarrService.searchMovies,
        operationMethod: () => radarrService.monitorAndDownloadMovie,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateMoviePrompt,
      },
      contextService: {
        setContext: () => contextService.setContext,
        clearContext: () => contextService.clearContext,
      },
    },
    fixtures: {
      mediaItems: [mockMovie1, mockMovie2, mockMovie3],
      operationResult: mockSuccessResult,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'movie',
      contextType: 'movie',
      supportsOrdinalSelection: true,
      supportsYearSelection: true,
      supportsTvSelection: false,
      operationType: 'download',
    },
    mockState,
  })

  describe('Selection from Context', () => {
    const movieContext = {
      type: 'movie' as const,
      searchResults: [mockMovie1, mockMovie2, mockMovie3],
      query: 'matrix',
      timestamp: Date.now(),
      isActive: true,
    }

    it('should download movie and clear context when valid ordinal is selected', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'first one' }),
        messages: [],
        userId: 'user123',
        context: movieContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedMovie.mockReturnValue(mockMovie1)
      radarrService.monitorAndDownloadMovie.mockResolvedValue(mockSuccessResult)
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(contextService.clearContext).toHaveBeenCalledWith('user123')
      expect(result.messages).toHaveLength(1)
    })

    it('should download movie and clear context when valid year is selected', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the 1999 one' }),
        messages: [],
        userId: 'user123',
        context: movieContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'year',
        value: '1999',
      })
      selectionUtilities.findSelectedMovie.mockReturnValue(mockMovie1)
      radarrService.monitorAndDownloadMovie.mockResolvedValue(mockSuccessResult)
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(contextService.clearContext).toHaveBeenCalledWith('user123')
      expect(result.messages).toHaveLength(1)
    })

    it('should re-show list when parseSearchSelection fails to parse user input', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'that one' }),
        messages: [],
        userId: 'user123',
        context: movieContext,
        state: mockState,
      }

      // The strategy catches parse errors and returns null via .catch(() => null)
      // Mock implementation to simulate this behavior by throwing an error that gets caught
      parsingUtilities.parseSearchSelection.mockRejectedValue(
        new Error('Parse failed'),
      )
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(contextService.clearContext).not.toHaveBeenCalled()
      expect(radarrService.monitorAndDownloadMovie).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should re-show list when findSelectedMovie returns null due to invalid selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'tenth one' }),
        messages: [],
        userId: 'user123',
        context: movieContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '10',
      })
      selectionUtilities.findSelectedMovie.mockReturnValue(null)
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(contextService.clearContext).not.toHaveBeenCalled()
      expect(radarrService.monitorAndDownloadMovie).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should clear context and show error when outer try-catch catches unexpected error', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'first one' }),
        messages: [],
        userId: 'user123',
        context: movieContext,
        state: mockState,
      }

      // Make findSelectedMovie throw an error to trigger outer catch block
      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedMovie.mockImplementation(() => {
        throw new Error('Unexpected error')
      })
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(contextService.clearContext).toHaveBeenCalledWith('user123')
      expect(result.messages).toHaveLength(1)
    })
  })

  describe('Error Handling', () => {
    it('should handle errors gracefully when download service throws exception', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download matrix' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.searchMovies.mockResolvedValue([mockMovie1])
      radarrService.monitorAndDownloadMovie.mockRejectedValue(
        new Error('Download service error'),
      )
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should return error response when download result indicates failure from service', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download matrix' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.searchMovies.mockResolvedValue([mockMovie1])
      radarrService.monitorAndDownloadMovie.mockResolvedValue(mockFailureResult)
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

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
        parseInitialSelection: () => parsingUtilities.parseInitialSelection,
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
      },
      selectionUtils: {
        findSelectedItem: () => selectionUtilities.findSelectedMovie,
      },
      mediaService: {
        searchMethod: () => radarrService.searchMovies,
        operationMethod: () => radarrService.monitorAndDownloadMovie,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateMoviePrompt,
      },
      contextService: {
        setContext: () => contextService.setContext,
        clearContext: () => contextService.clearContext,
      },
    },
    fixtures: {
      mediaItems: [mockMovie1, mockMovie2, mockMovie3],
      operationResult: mockSuccessResult,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'movie',
      contextType: 'movie',
      serviceName: 'RadarrService',
      searchMethodName: 'searchMovies',
      operationMethodName: 'monitorAndDownloadMovie',
      errorPromptType: 'error',
      processingErrorPromptType: 'processing_error',
    },
  })
})
