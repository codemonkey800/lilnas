import { HumanMessage } from '@langchain/core/messages'
import { DownloadApiError } from '@lilnas/utils/download/client'
import { DownloadJobStatus, QualityTier } from '@lilnas/utils/download/types'
import { Test, TestingModule } from '@nestjs/testing'

import { PromptGenerationService } from 'src/llm/skills/media/prompt-generation.service'
import { RadarrService } from 'src/media/services/radarr.service'
import {
  MovieSearchResult,
  RadarrMovieStatus,
} from 'src/media/types/radarr.types'
import { createMockMovieJob } from 'src/media-operations/request-handling/__test-fixtures__/media-fixtures'
import {
  createMockDiscordIdentity,
  createMockDownloadClientFactory,
} from 'src/media-operations/request-handling/__test-helpers__/mock-services'
import { testSelectionBehavior } from 'src/media-operations/request-handling/__test-helpers__/selection-behavior-suite'
import { testStrategyEdgeCases } from 'src/media-operations/request-handling/__test-helpers__/strategy-edge-cases-suite'
import { testStrategyRouting } from 'src/media-operations/request-handling/__test-helpers__/strategy-routing-suite'
import { DownloadClientFactory } from 'src/media-operations/request-handling/download-client.factory'
import { MovieDownloadStrategy } from 'src/media-operations/request-handling/strategies/movie-download.strategy'
import {
  MediaContextType,
  StrategyRequestParams,
} from 'src/media-operations/request-handling/types/request-context.type'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'

describe('MovieDownloadStrategy', () => {
  let strategy: MovieDownloadStrategy
  let radarrService: jest.Mocked<RadarrService>
  let downloadClientFactory: ReturnType<
    typeof createMockDownloadClientFactory
  >['factory']
  let downloadClient: ReturnType<
    typeof createMockDownloadClientFactory
  >['client']
  let promptService: jest.Mocked<PromptGenerationService>
  let parsingUtilities: jest.Mocked<ParsingUtilities>
  let selectionUtilities: jest.Mocked<SelectionUtilities>

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

  // The job the download app answers a request with - still searching
  const mockRequestedJob = createMockMovieJob()

  const matrixLinks =
    'Follow along on the [activity page](<https://download.lilnas.io/activity>), or open [The Matrix](<https://download.lilnas.io/movies/603>).'

  // Mock state object (passed in params, not DI) - context handling removed, now carried on StrategyResult.pendingContext
  const mockState = {}

  beforeEach(async () => {
    const mockDownload = createMockDownloadClientFactory()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovieDownloadStrategy,
        {
          provide: RadarrService,
          useValue: {
            searchMovies: jest.fn(),
          },
        },
        {
          provide: DownloadClientFactory,
          useValue: mockDownload.factory,
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
      ],
    }).compile()

    strategy = module.get<MovieDownloadStrategy>(MovieDownloadStrategy)
    radarrService = module.get(RadarrService)
    downloadClientFactory = module.get(DownloadClientFactory)
    downloadClient = mockDownload.client
    promptService = module.get(PromptGenerationService)
    parsingUtilities = module.get(ParsingUtilities)
    selectionUtilities = module.get(SelectionUtilities)
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
        operationMethod: () => downloadClient.requestMovie,
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
      operationResult: mockRequestedJob,
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
    it('asks for a title when the search query is empty', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({
          id: '1',
          content: 'download some horror movies',
        }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
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
      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [],
        'clarification',
      )
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
        discord: createMockDiscordIdentity('user123'),
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
        discord: createMockDiscordIdentity('user123'),
        state: mockState,
      }

      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.searchMovies.mockResolvedValue([mockMovie1])
      downloadClient.requestMovie.mockResolvedValue(mockRequestedJob)
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toBe(
        `Here is your movie response...\n\n${matrixLinks}`,
      )
    })

    it('should store context and show list when multiple results found without selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download matrix' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
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

      expect(result.pendingContext).toEqual({
        type: MediaContextType.MovieDownload,
        data: {
          type: 'movie',
          searchResults: [mockMovie1, mockMovie2, mockMovie3],
          query: 'matrix',
          timestamp: expect.any(Number),
          isActive: true,
        },
      })
      expect(downloadClient.requestMovie).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should handle RadarrService search errors gracefully', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download matrix' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
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
        operationMethod: () => downloadClient.requestMovie,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateMoviePrompt,
      },
    },
    fixtures: {
      mediaItems: [mockMovie1, mockMovie2, mockMovie3],
      operationResult: mockRequestedJob,
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
        discord: createMockDiscordIdentity('user123'),
        context: movieContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedMovie.mockReturnValue(mockMovie1)
      downloadClient.requestMovie.mockResolvedValue(mockRequestedJob)
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
    })

    it('should download movie and clear context when valid year is selected', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'the 1999 one' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
        context: movieContext,
        state: mockState,
      }

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'year',
        value: '1999',
      })
      selectionUtilities.findSelectedMovie.mockReturnValue(mockMovie1)
      downloadClient.requestMovie.mockResolvedValue(mockRequestedJob)
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
    })

    it('should re-show list when parseSearchSelection fails to parse user input', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'that one' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
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

      expect(result.pendingContext?.data).toEqual(params.context)
      expect(downloadClient.requestMovie).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should re-show list when findSelectedMovie returns null due to invalid selection', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'tenth one' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
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

      expect(result.pendingContext?.data).toEqual(params.context)
      expect(downloadClient.requestMovie).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
    })

    it('should clear context and show error when outer try-catch catches unexpected error', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'first one' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
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

      expect(result.pendingContext).toBeUndefined()
      expect(result.messages).toHaveLength(1)
    })
  })

  describe('Requesting via the download app', () => {
    const singleResultParams = (
      overrides: Partial<StrategyRequestParams> = {},
    ): StrategyRequestParams => ({
      message: new HumanMessage({ id: '1', content: 'download matrix' }),
      messages: [],
      userId: 'user123',
      discord: createMockDiscordIdentity('user123'),
      state: mockState,
      ...overrides,
    })

    beforeEach(() => {
      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: null,
        tvSelection: null,
      })
      radarrService.searchMovies.mockResolvedValue([mockMovie1])
      promptService.generateMoviePrompt.mockResolvedValue(mockChatResponse)
    })

    it("requests the movie as the sender, leaving the tier to the server's default", async () => {
      downloadClient.requestMovie.mockResolvedValue(mockRequestedJob)

      await strategy.handleRequest(singleResultParams())

      expect(downloadClientFactory.forDiscord).toHaveBeenCalledWith({
        userId: 'user123',
        username: 'testuser',
        displayName: 'Test User',
      })
      // Omitted outright, not sent as `qualityTier: undefined`
      expect(downloadClient.requestMovie).toHaveBeenCalledWith({
        tmdbId: 603,
      })
      expect(downloadClient.requestMovie.mock.calls[0][0]).not.toHaveProperty(
        'qualityTier',
      )
    })

    it('passes the asked-for quality tier through', async () => {
      downloadClient.requestMovie.mockResolvedValue(mockRequestedJob)

      await strategy.handleRequest(
        singleResultParams({ qualityTier: QualityTier.UpTo4k }),
      )

      expect(downloadClient.requestMovie).toHaveBeenCalledWith({
        tmdbId: 603,
        qualityTier: QualityTier.UpTo4k,
      })
    })

    it('replies that the movie was requested, with links to follow it', async () => {
      downloadClient.requestMovie.mockResolvedValue(
        createMockMovieJob({
          statusNote: 'Waiting for Radarr to finish adding the movie',
        }),
      )

      const result = await strategy.handleRequest(singleResultParams())

      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [],
        'success',
        expect.objectContaining({
          selectedMovie: mockMovie1,
          statusNote: 'Waiting for Radarr to finish adding the movie',
          autoApplied: false,
        }),
      )
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toBe(
        `Here is your movie response...\n\n${matrixLinks}`,
      )
    })

    it('says the movie is already downloaded when the job comes back completed', async () => {
      downloadClient.requestMovie.mockResolvedValue(
        createMockMovieJob({
          status: DownloadJobStatus.Completed,
          completedAt: '2026-01-01T00:00:00.000Z',
        }),
      )

      const result = await strategy.handleRequest(singleResultParams())

      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [],
        'already_downloaded',
        { selectedMovie: mockMovie1 },
      )
      expect(promptService.generateMoviePrompt).not.toHaveBeenCalledWith(
        expect.anything(),
        'success',
        expect.anything(),
      )
      expect(result.messages[0].content).toBe(
        `Here is your movie response...\n\n${matrixLinks}`,
      )
    })

    it("reports a job that failed at request time with the job's error, still linking it", async () => {
      downloadClient.requestMovie.mockResolvedValue(
        createMockMovieJob({
          status: DownloadJobStatus.Failed,
          error: 'Radarr has no "HD (up to 1080p)" quality profile',
        }),
      )

      const result = await strategy.handleRequest(singleResultParams())

      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [],
        'error',
        {
          selectedMovie: mockMovie1,
          errorMessage:
            'Requested "The Matrix", but the request failed: Radarr has no "HD (up to 1080p)" quality profile.',
        },
      )
      // The job page offers Retry, so the links still help
      expect(result.messages[0].content).toBe(
        `Here is your movie response...\n\n${matrixLinks}`,
      )
    })

    it('reports a job that found no release', async () => {
      downloadClient.requestMovie.mockResolvedValue(
        createMockMovieJob({ status: DownloadJobStatus.NotFound }),
      )

      await strategy.handleRequest(singleResultParams())

      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [],
        'error',
        {
          selectedMovie: mockMovie1,
          errorMessage:
            'Requested "The Matrix", but no release was found for it.',
        },
      )
    })

    it("hands the download app's error message to the error prompt, with no links", async () => {
      downloadClient.requestMovie.mockRejectedValue(
        new DownloadApiError(400, 'Bad Request', {
          statusCode: 400,
          message: 'Radarr has no "Up to 4K" quality profile',
          error: 'Bad Request',
        }),
      )

      const result = await strategy.handleRequest(
        singleResultParams({ qualityTier: QualityTier.UpTo4k }),
      )

      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [],
        'error',
        {
          selectedMovie: mockMovie1,
          errorMessage:
            'Couldn\'t request "The Matrix": Radarr has no "Up to 4K" quality profile',
        },
      )
      // Nothing was created, so there is nothing to link to
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toBe(mockChatResponse)
    })

    it('says the download app might be down when it cannot be reached', async () => {
      downloadClient.requestMovie.mockRejectedValue(
        new TypeError('fetch failed'),
      )

      const result = await strategy.handleRequest(singleResultParams())

      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [],
        'error',
        {
          selectedMovie: mockMovie1,
          errorMessage:
            'Couldn\'t request "The Matrix" - the download app might be unavailable (fetch failed).',
        },
      )
      expect(result.messages[0]).toBe(mockChatResponse)
    })

    it('requests an auto-applied pick once, noting how it was picked', async () => {
      parsingUtilities.parseInitialSelection.mockResolvedValue({
        searchQuery: 'matrix',
        selection: { selectionType: 'year', value: '1999' },
        tvSelection: null,
      })
      radarrService.searchMovies.mockResolvedValue([mockMovie1, mockMovie2])
      selectionUtilities.findSelectedMovie.mockReturnValue(mockMovie1)
      downloadClient.requestMovie.mockResolvedValue(mockRequestedJob)

      const result = await strategy.handleRequest(
        singleResultParams({ qualityTier: QualityTier.Hd }),
      )

      expect(downloadClient.requestMovie).toHaveBeenCalledTimes(1)
      expect(downloadClient.requestMovie).toHaveBeenCalledWith({
        tmdbId: 603,
        qualityTier: QualityTier.Hd,
      })
      expect(promptService.generateMoviePrompt).toHaveBeenCalledTimes(1)
      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [],
        'success',
        expect.objectContaining({
          autoApplied: true,
          selectionCriteria: 'year: 1999',
        }),
      )
      expect(result.messages[0].content).toBe(
        `Here is your movie response...\n\n${matrixLinks}`,
      )
    })

    it('keeps the tier asked for with the search for the follow-up pick', async () => {
      radarrService.searchMovies.mockResolvedValue([mockMovie1, mockMovie2])

      const listResult = await strategy.handleRequest(
        singleResultParams({ qualityTier: QualityTier.UpTo720p }),
      )

      expect(listResult.pendingContext).toEqual({
        type: MediaContextType.MovieDownload,
        data: expect.objectContaining({ qualityTier: QualityTier.UpTo720p }),
      })
      const storedContext = listResult.pendingContext
        ?.data as StrategyRequestParams['context']

      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '2',
      })
      selectionUtilities.findSelectedMovie.mockReturnValue(mockMovie2)
      downloadClient.requestMovie.mockResolvedValue(mockRequestedJob)

      await strategy.handleRequest(
        singleResultParams({
          message: new HumanMessage({ id: '2', content: 'the second one' }),
          context: storedContext,
        }),
      )

      expect(downloadClient.requestMovie).toHaveBeenCalledWith({
        tmdbId: 604,
        qualityTier: QualityTier.UpTo720p,
      })
    })

    it('lets a tier named in the pick override the one from the search', async () => {
      parsingUtilities.parseSearchSelection.mockResolvedValue({
        selectionType: 'ordinal',
        value: '1',
      })
      selectionUtilities.findSelectedMovie.mockReturnValue(mockMovie1)
      downloadClient.requestMovie.mockResolvedValue(mockRequestedJob)

      await strategy.handleRequest(
        singleResultParams({
          message: new HumanMessage({ id: '2', content: 'first one in 4k' }),
          qualityTier: QualityTier.UpTo4k,
          context: {
            type: 'movie',
            searchResults: [mockMovie1, mockMovie2],
            query: 'matrix',
            timestamp: Date.now(),
            isActive: true,
            qualityTier: QualityTier.UpTo720p,
          },
        }),
      )

      expect(downloadClient.requestMovie).toHaveBeenCalledWith({
        tmdbId: 603,
        qualityTier: QualityTier.UpTo4k,
      })
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
        operationMethod: () => downloadClient.requestMovie,
      },
      promptService: {
        generatePromptMethod: () => promptService.generateMoviePrompt,
      },
    },
    fixtures: {
      mediaItems: [mockMovie1, mockMovie2, mockMovie3],
      operationResult: mockRequestedJob,
      chatResponse: mockChatResponse,
    },
    config: {
      mediaType: 'movie',
      contextType: 'movie',
      serviceName: 'DownloadClient',
      searchMethodName: 'searchMovies',
      operationMethodName: 'requestMovie',
      errorPromptType: 'error',
      processingErrorPromptType: 'processing_error',
    },
  })
})
