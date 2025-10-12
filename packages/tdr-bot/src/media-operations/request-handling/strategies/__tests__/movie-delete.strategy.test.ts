import { HumanMessage } from '@langchain/core/messages'
import { Test, TestingModule } from '@nestjs/testing'

import { RadarrService } from 'src/media/services/radarr.service'
import {
  MovieLibrarySearchResult,
  RadarrMinimumAvailability,
  RadarrMovieStatus,
  UnmonitorAndDeleteResult,
} from 'src/media/types/radarr.types'
import { testSelectionBehavior } from 'src/media-operations/request-handling/__test-helpers__/selection-behavior-suite'
import { testStrategyEdgeCases } from 'src/media-operations/request-handling/__test-helpers__/strategy-edge-cases-suite'
import { testStrategyRouting } from 'src/media-operations/request-handling/__test-helpers__/strategy-routing-suite'
import { MovieDeleteStrategy } from 'src/media-operations/request-handling/strategies/movie-delete.strategy'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { StateService } from 'src/state/state.service'

describe('MovieDeleteStrategy', () => {
  let strategy: MovieDeleteStrategy
  let radarrService: jest.Mocked<RadarrService>
  let promptService: jest.Mocked<PromptGenerationService>
  let parsingUtilities: jest.Mocked<ParsingUtilities>
  let selectionUtilities: jest.Mocked<SelectionUtilities>
  let stateService: jest.Mocked<StateService>

  // Mock response messages
  const mockChatResponse = new HumanMessage({
    id: 'mock-response-id',
    content: 'Here is your movie delete response...',
  })

  // Mock movie library results
  const mockLibraryMovie1: MovieLibrarySearchResult = {
    id: 1,
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
    isAvailable: true,
    monitored: true,
    hasFile: true,
    path: '/movies/The Matrix (1999)',
    added: '2023-01-01T00:00:00Z',
    sizeOnDisk: 5368709120, // 5GB
    qualityProfileId: 1,
    rootFolderPath: '/movies',
    minimumAvailability: RadarrMinimumAvailability.RELEASED,
  }

  const mockLibraryMovie2: MovieLibrarySearchResult = {
    id: 2,
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
    isAvailable: true,
    monitored: true,
    hasFile: true,
    path: '/movies/The Matrix Reloaded (2003)',
    added: '2023-01-01T00:00:00Z',
    sizeOnDisk: 5905580032, // 5.5GB
    qualityProfileId: 1,
    rootFolderPath: '/movies',
    minimumAvailability: RadarrMinimumAvailability.RELEASED,
  }

  const mockLibraryMovie3: MovieLibrarySearchResult = {
    id: 3,
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
    isAvailable: true,
    monitored: true,
    hasFile: true,
    path: '/movies/The Matrix Revolutions (2003)',
    added: '2023-01-01T00:00:00Z',
    sizeOnDisk: 4831838208, // 4.5GB
    qualityProfileId: 1,
    rootFolderPath: '/movies',
    minimumAvailability: RadarrMinimumAvailability.RELEASED,
  }

  // Mock delete results
  const mockSuccessResult: UnmonitorAndDeleteResult = {
    success: true,
    movieDeleted: true,
    filesDeleted: true,
  }

  const mockFailureResult: UnmonitorAndDeleteResult = {
    success: false,
    movieDeleted: false,
    filesDeleted: false,
    error: 'Failed to delete movie from Radarr',
  }

  // Mock state object (passed in params, not DI)
  const mockState = {
    setUserMovieDeleteContext: jest.fn(),
    clearUserMovieDeleteContext: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovieDeleteStrategy,
        {
          provide: RadarrService,
          useValue: {
            getLibraryMovies: jest.fn(),
            unmonitorAndDeleteMovie: jest.fn(),
          },
        },
        {
          provide: PromptGenerationService,
          useValue: {
            generateMovieDeletePrompt: jest.fn(),
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
            findSelectedMovieFromLibrary: jest.fn(),
          },
        },
        {
          provide: StateService,
          useValue: {
            getState: jest.fn().mockReturnValue({
              chatModel: 'gpt-4',
              temperature: 0.7,
            }),
            setUserMovieDeleteContext: jest.fn(),
            clearUserMovieDeleteContext: jest.fn(),
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

    strategy = module.get<MovieDeleteStrategy>(MovieDeleteStrategy)
    radarrService = module.get(RadarrService)
    promptService = module.get(PromptGenerationService)
    parsingUtilities = module.get(ParsingUtilities)
    selectionUtilities = module.get(SelectionUtilities)
    stateService = module.get(StateService)

    // Reset state mocks
    mockState.setUserMovieDeleteContext.mockClear()
    mockState.clearUserMovieDeleteContext.mockClear()
    stateService.setUserMovieDeleteContext.mockClear()
    stateService.clearUserMovieDeleteContext.mockClear()
  })

  testStrategyRouting({
    getStrategy: () => strategy,
    mocks: {
      parsingUtils: {
        parseInitialSelection: () => parsingUtilities.parseInitialSelection,
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
      },
      selectionUtils: {
        findSelectedItem: () => selectionUtilities.findSelectedMovieFromLibrary,
      },
      mediaService: {
        searchOrLibraryMethod: () => radarrService.getLibraryMovies,
        operationMethod: () => radarrService.unmonitorAndDeleteMovie,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateMovieDeletePrompt,
      },
    },
    fixtures: {
      validContext: {
        type: 'movieDelete',
        isActive: true,
        searchResults: [mockLibraryMovie1, mockLibraryMovie2],
        query: 'matrix',
        timestamp: Date.now(),
      },
      mediaItems: [mockLibraryMovie1, mockLibraryMovie2, mockLibraryMovie3],
      operationResult: mockSuccessResult,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'movie',
      contextType: 'movieDelete',
      wrongContextType: 'movie',
      inactiveContextType: 'movieDelete',
      exampleMessage: 'delete matrix',
    },
    mockState,
  })

  describe('New Movie Delete - Basic Flows', () => {
    it('should return clarification when search query is empty', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'delete a movie' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: '',
        selection: null,
        tvSelection: null,
      })
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(radarrService.getLibraryMovies).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toBe(mockChatResponse)
      expect(result.images).toEqual([])
    })

    it('should return no_results message when no library movies found', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'delete nonexistent movie',
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
      radarrService.getLibraryMovies.mockResolvedValue([])
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
      expect(result.images).toEqual([])
    })

    it('should auto-delete immediately when single result found', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'delete matrix' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.getLibraryMovies.mockResolvedValue([mockLibraryMovie1])
      radarrService.unmonitorAndDeleteMovie.mockResolvedValue(mockSuccessResult)
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(stateService.setUserMovieDeleteContext).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should store context and show list when multiple results found without selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'delete matrix' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.getLibraryMovies.mockResolvedValue([
        mockLibraryMovie1,
        mockLibraryMovie2,
        mockLibraryMovie3,
      ])
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.setUserMovieDeleteContext).toHaveBeenCalledWith(
        'user123',
        {
          type: 'movieDelete',
          searchResults: [
            mockLibraryMovie1,
            mockLibraryMovie2,
            mockLibraryMovie3,
          ],
          query: 'matrix',
          timestamp: expect.any(Number),
          isActive: true,
        },
      )
      expect(radarrService.unmonitorAndDeleteMovie).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should handle RadarrService library search errors gracefully', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'delete matrix' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.getLibraryMovies.mockRejectedValue(
        new Error('Radarr service unavailable'),
      )
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

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
        findSelectedItem: () => selectionUtilities.findSelectedMovieFromLibrary,
      },
      mediaService: {
        searchOrLibraryMethod: () => radarrService.getLibraryMovies,
        operationMethod: () => radarrService.unmonitorAndDeleteMovie,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateMovieDeletePrompt,
      },
      stateService: {
        setContextMethod: () =>
          stateService.setUserMovieContext || stateService.setUserTvShowContext,
        clearContextMethod: () =>
          stateService.clearUserMovieContext ||
          stateService.clearUserTvShowContext,
      },
    },
    fixtures: {
      mediaItems: [mockLibraryMovie1, mockLibraryMovie2, mockLibraryMovie3],
      operationResult: mockSuccessResult,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'movie',
      contextType: 'movieDelete',
      setContextMethod: 'setUserMovieDeleteContext',
      supportsOrdinalSelection: true,
      supportsYearSelection: true,
      supportsTvSelection: false,
      operationType: 'delete',
    },
    mockState,
  })

  describe('Selection from Context', () => {
    const movieDeleteContext = {
      type: 'movieDelete' as const,
      searchResults: [mockLibraryMovie1, mockLibraryMovie2, mockLibraryMovie3],
      query: 'matrix',
      timestamp: Date.now(),
      isActive: true,
    }

    it('should delete movie and clear context when valid ordinal is selected', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'first one' }),
        messages: [],
        userId: 'user123',
        context: movieDeleteContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedMovieFromLibrary.mockReturnValue(
        mockLibraryMovie1,
      )
      radarrService.unmonitorAndDeleteMovie.mockResolvedValue(mockSuccessResult)
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.clearUserMovieDeleteContext).toHaveBeenCalledWith(
        'user123',
      )
      expect(result.messages).toHaveLength(1)
    })

    it('should delete movie and clear context when valid year is selected', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the 1999 one' }),
        messages: [],
        userId: 'user123',
        context: movieDeleteContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'year',
        value: '1999',
      })
      selectionUtilities.findSelectedMovieFromLibrary.mockReturnValue(
        mockLibraryMovie1,
      )
      radarrService.unmonitorAndDeleteMovie.mockResolvedValue(mockSuccessResult)
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.clearUserMovieDeleteContext).toHaveBeenCalledWith(
        'user123',
      )
      expect(result.messages).toHaveLength(1)
    })

    it('should re-show list when parseSearchSelection fails to parse user input', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'that one' }),
        messages: [],
        userId: 'user123',
        context: movieDeleteContext,
        state: mockState,
      }

      // The strategy catches parse errors and returns null via .catch(() => null)
      parsingUtilities.parseSearchSelection.mockRejectedValue(
        new Error('Parse failed'),
      )
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.clearUserMovieDeleteContext).not.toHaveBeenCalled()
      expect(radarrService.unmonitorAndDeleteMovie).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should re-show list when findSelectedMovieFromLibrary returns null due to invalid selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'tenth one' }),
        messages: [],
        userId: 'user123',
        context: movieDeleteContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '10',
      })
      selectionUtilities.findSelectedMovieFromLibrary.mockReturnValue(null)
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.clearUserMovieDeleteContext).not.toHaveBeenCalled()
      expect(radarrService.unmonitorAndDeleteMovie).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should clear context and show error when outer try-catch catches unexpected error', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'first one' }),
        messages: [],
        userId: 'user123',
        context: movieDeleteContext,
        state: mockState,
      }

      // Make findSelectedMovieFromLibrary throw an error to trigger outer catch block
      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedMovieFromLibrary.mockImplementation(() => {
        throw new Error('Unexpected error')
      })
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(mockState.clearUserMovieDeleteContext).toHaveBeenCalledWith(
        'user123',
      )
      expect(result.messages).toHaveLength(1)
    })
  })

  describe('Error Handling', () => {
    it('should handle errors gracefully when delete service throws exception', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'delete matrix' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.getLibraryMovies.mockResolvedValue([mockLibraryMovie1])
      radarrService.unmonitorAndDeleteMovie.mockRejectedValue(
        new Error('Delete service error'),
      )
      promptService.generateMovieDeletePrompt.mockResolvedValue(
        mockChatResponse,
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
    })

    it('should return error response when delete result indicates failure from service', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'delete matrix' }),
        messages: [],
        userId: 'user123',
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.getLibraryMovies.mockResolvedValue([mockLibraryMovie1])
      radarrService.unmonitorAndDeleteMovie.mockResolvedValue(mockFailureResult)
      promptService.generateMovieDeletePrompt.mockResolvedValue(
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
        parseInitialSelection: () => parsingUtilities.parseInitialSelection,
        parseSearchSelection: () => parsingUtilities.parseSearchSelection,
      },
      selectionUtils: {
        findSelectedItem: () => selectionUtilities.findSelectedMovieFromLibrary,
      },
      mediaService: {
        searchMethod: () => radarrService.getLibraryMovies,
        operationMethod: () => radarrService.unmonitorAndDeleteMovie,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateMovieDeletePrompt,
      },
      stateService: {
        setContextMethod: () => stateService.setUserMovieDeleteContext,
        clearContextMethod: () => stateService.clearUserMovieDeleteContext,
      },
    },
    fixtures: {
      mediaItems: [mockLibraryMovie1, mockLibraryMovie2, mockLibraryMovie3],
      operationResult: mockSuccessResult,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'movie',
      contextType: 'movieDelete',
      setContextMethod: 'setUserMovieDeleteContext',
      clearContextMethod: 'clearUserMovieDeleteContext',
      serviceName: 'RadarrService',
      searchMethodName: 'getLibraryMovies',
      operationMethodName: 'unmonitorAndDeleteMovie',
      errorPromptType: 'error_delete',
      processingErrorPromptType: 'processing_error_delete',
    },
  })
})
