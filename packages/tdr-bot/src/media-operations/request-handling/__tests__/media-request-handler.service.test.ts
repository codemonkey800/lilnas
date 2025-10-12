// Mock @langchain/openai before any imports
jest.mock('@langchain/openai')

import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { Test, TestingModule } from '@nestjs/testing'

import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import {
  MovieDeleteContext,
  MovieSelectionContext,
  TvShowDeleteContext,
  TvShowSelectionContext,
} from 'src/media-operations/request-handling/strategies/base/strategy.types'
import { DownloadStatusStrategy } from 'src/media-operations/request-handling/strategies/download-status.strategy'
import { MediaBrowsingStrategy } from 'src/media-operations/request-handling/strategies/media-browsing.strategy'
import { MovieDeleteStrategy } from 'src/media-operations/request-handling/strategies/movie-delete.strategy'
import { MovieDownloadStrategy } from 'src/media-operations/request-handling/strategies/movie-download.strategy'
import { TvDeleteStrategy } from 'src/media-operations/request-handling/strategies/tv-delete.strategy'
import { TvDownloadStrategy } from 'src/media-operations/request-handling/strategies/tv-download.strategy'
import { StrategyResult } from 'src/media-operations/request-handling/types/strategy-result.type'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { MediaRequestType, SearchIntent } from 'src/schemas/graph'
import { RetryService } from 'src/utils/retry.service'

describe('MediaRequestHandler', () => {
  let handler: MediaRequestHandler
  let contextService: jest.Mocked<ContextManagementService>
  let retryService: jest.Mocked<RetryService>
  let movieDownloadStrategy: jest.Mocked<MovieDownloadStrategy>
  let tvDownloadStrategy: jest.Mocked<TvDownloadStrategy>
  let movieDeleteStrategy: jest.Mocked<MovieDeleteStrategy>
  let tvDeleteStrategy: jest.Mocked<TvDeleteStrategy>
  let mediaBrowsingStrategy: jest.Mocked<MediaBrowsingStrategy>
  let downloadStatusStrategy: jest.Mocked<DownloadStatusStrategy>

  // Mock ChatOpenAI
  const mockChatOpenAI = ChatOpenAI as jest.MockedClass<typeof ChatOpenAI>
  const mockInvoke = jest.fn()

  // Mock data
  const mockUserId = 'user123'
  const mockMessage = new HumanMessage({ content: 'Download The Matrix' })
  const mockMessages: BaseMessage[] = [mockMessage]
  const mockState = { someState: 'value' }

  const mockStrategyResult: StrategyResult = {
    images: [],
    messages: [new HumanMessage({ content: 'Strategy response' })],
  }

  beforeEach(async () => {
    // Setup ChatOpenAI mock
    mockInvoke.mockReset()
    mockChatOpenAI.mockImplementation(
      () =>
        ({
          invoke: mockInvoke,
          withStructuredOutput: jest.fn().mockReturnThis(),
        }) as unknown as ChatOpenAI,
    )

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaRequestHandler,
        {
          provide: ContextManagementService,
          useValue: {
            hasContext: jest.fn(),
            getContextType: jest.fn(),
            getContext: jest.fn(),
            clearContext: jest.fn(),
          },
        },
        {
          provide: RetryService,
          useValue: {
            executeWithRetry: jest.fn(),
          },
        },
        {
          provide: MovieDownloadStrategy,
          useValue: {
            handleRequest: jest.fn(),
          },
        },
        {
          provide: TvDownloadStrategy,
          useValue: {
            handleRequest: jest.fn(),
          },
        },
        {
          provide: MovieDeleteStrategy,
          useValue: {
            handleRequest: jest.fn(),
          },
        },
        {
          provide: TvDeleteStrategy,
          useValue: {
            handleRequest: jest.fn(),
          },
        },
        {
          provide: MediaBrowsingStrategy,
          useValue: {
            handleRequest: jest.fn(),
          },
        },
        {
          provide: DownloadStatusStrategy,
          useValue: {
            handleRequest: jest.fn(),
          },
        },
      ],
    }).compile()

    handler = module.get<MediaRequestHandler>(MediaRequestHandler)
    contextService = module.get(ContextManagementService)
    retryService = module.get(RetryService)
    movieDownloadStrategy = module.get(MovieDownloadStrategy)
    tvDownloadStrategy = module.get(TvDownloadStrategy)
    movieDeleteStrategy = module.get(MovieDeleteStrategy)
    tvDeleteStrategy = module.get(TvDeleteStrategy)
    mediaBrowsingStrategy = module.get(MediaBrowsingStrategy)
    downloadStatusStrategy = module.get(DownloadStatusStrategy)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('handleRequest', () => {
    describe('Context routing', () => {
      it('should route to movieDownloadStrategy when context type is "movie"', async () => {
        const mockContext: Partial<MovieSelectionContext> = {
          type: 'movie',
          query: 'The Matrix',
        }
        contextService.hasContext.mockResolvedValue(true)
        contextService.getContextType.mockResolvedValue('movie')
        contextService.getContext.mockResolvedValue(mockContext)
        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(contextService.hasContext).toHaveBeenCalledWith(mockUserId)
        expect(movieDownloadStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          context: mockContext,
          state: mockState,
        })
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to tvDownloadStrategy when context type is "tv"', async () => {
        const mockContext: Partial<TvShowSelectionContext> = {
          type: 'tvShow',
          query: 'Breaking Bad',
        }
        contextService.hasContext.mockResolvedValue(true)
        contextService.getContextType.mockResolvedValue('tv')
        contextService.getContext.mockResolvedValue(mockContext)
        tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(tvDownloadStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          context: mockContext,
          state: mockState,
        })
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to movieDeleteStrategy when context type is "movieDelete"', async () => {
        const mockContext: Partial<MovieDeleteContext> = {
          type: 'movieDelete',
          query: 'The Matrix',
        }
        contextService.hasContext.mockResolvedValue(true)
        contextService.getContextType.mockResolvedValue('movieDelete')
        contextService.getContext.mockResolvedValue(mockContext)
        movieDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(movieDeleteStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          context: mockContext,
          state: mockState,
        })
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to tvDeleteStrategy when context type is "tvDelete"', async () => {
        const mockContext: Partial<TvShowDeleteContext> = {
          type: 'tvShowDelete',
          query: 'Breaking Bad',
        }
        contextService.hasContext.mockResolvedValue(true)
        contextService.getContextType.mockResolvedValue('tvDelete')
        contextService.getContext.mockResolvedValue(mockContext)
        tvDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(tvDeleteStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          context: mockContext,
          state: mockState,
        })
        expect(result).toBe(mockStrategyResult)
      })

      it('should clear context and continue when context type is unknown', async () => {
        contextService.hasContext.mockResolvedValue(true)
        contextService.getContextType.mockResolvedValue('unknownType')
        contextService.getContext.mockResolvedValue({})
        contextService.clearContext.mockResolvedValue(true)

        // Mock getMediaTypeAndIntent to return a browse request
        retryService.executeWithRetry.mockImplementation(
          <T>(callback: () => T) => Promise.resolve(callback()),
        )
        mockInvoke.mockResolvedValue({
          content: JSON.stringify({
            mediaType: MediaRequestType.Both,
            searchIntent: SearchIntent.Library,
            searchTerms: '',
          }),
        })
        mediaBrowsingStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
        expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalled()
      })
    })

    describe('Status request routing', () => {
      beforeEach(() => {
        contextService.hasContext.mockResolvedValue(false)
        downloadStatusStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )
      })

      it('should route to downloadStatusStrategy when status keywords detected', async () => {
        const statusMessage = new HumanMessage({
          content: 'What is the download status?',
        })

        const result = await handler.handleRequest(
          statusMessage,
          [statusMessage],
          mockUserId,
          mockState,
        )

        expect(downloadStatusStrategy.handleRequest).toHaveBeenCalledWith({
          message: statusMessage,
          messages: [statusMessage],
          userId: mockUserId,
          state: mockState,
        })
        expect(result).toBe(mockStrategyResult)
      })

      it('should detect various status keywords', async () => {
        const testCases = [
          'What is downloading?',
          'Show me current downloads',
          'Any active downloads?',
          'Check download progress',
        ]

        for (const content of testCases) {
          const message = new HumanMessage({ content })
          await handler.handleRequest(message, [message], mockUserId)
          expect(downloadStatusStrategy.handleRequest).toHaveBeenCalled()
          jest.clearAllMocks()
        }
      })
    })

    describe('Download request routing', () => {
      beforeEach(() => {
        contextService.hasContext.mockResolvedValue(false)
        retryService.executeWithRetry.mockImplementation(
          <T>(callback: () => T) => Promise.resolve(callback()),
        )
      })

      it('should route to movieDownloadStrategy for Movies media type', async () => {
        mockInvoke.mockResolvedValue({
          content: JSON.stringify({
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.External,
            searchTerms: 'The Matrix',
          }),
        })
        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to tvDownloadStrategy for Shows media type', async () => {
        mockInvoke.mockResolvedValue({
          content: JSON.stringify({
            mediaType: MediaRequestType.Shows,
            searchIntent: SearchIntent.External,
            searchTerms: 'Breaking Bad',
          }),
        })
        tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(tvDownloadStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })

      it('should use LLM classification for Both media type and route to movie', async () => {
        // First call: getMediaTypeAndIntent returns Both
        mockInvoke.mockResolvedValueOnce({
          content: JSON.stringify({
            mediaType: MediaRequestType.Both,
            searchIntent: SearchIntent.External,
            searchTerms: 'The Matrix',
          }),
        })

        // Second call: classifyMediaType returns movie
        mockInvoke.mockResolvedValueOnce({
          mediaType: 'movie',
        })

        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(mockInvoke).toHaveBeenCalledTimes(2)
        expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })

      it('should use LLM classification for Both media type and route to TV', async () => {
        // First call: getMediaTypeAndIntent returns Both
        mockInvoke.mockResolvedValueOnce({
          content: JSON.stringify({
            mediaType: MediaRequestType.Both,
            searchIntent: SearchIntent.External,
            searchTerms: 'Breaking Bad',
          }),
        })

        // Second call: classifyMediaType returns tv_show
        mockInvoke.mockResolvedValueOnce({
          mediaType: 'tv_show',
        })

        tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(mockInvoke).toHaveBeenCalledTimes(2)
        expect(tvDownloadStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })
    })

    describe('Delete request routing', () => {
      beforeEach(() => {
        contextService.hasContext.mockResolvedValue(false)
        retryService.executeWithRetry.mockImplementation(
          <T>(callback: () => T) => Promise.resolve(callback()),
        )
      })

      it('should route to movieDeleteStrategy for Movies with Delete intent', async () => {
        mockInvoke.mockResolvedValue({
          content: JSON.stringify({
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Delete,
            searchTerms: 'The Matrix',
          }),
        })
        movieDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(movieDeleteStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to tvDeleteStrategy for Shows with Delete intent', async () => {
        mockInvoke.mockResolvedValue({
          content: JSON.stringify({
            mediaType: MediaRequestType.Shows,
            searchIntent: SearchIntent.Delete,
            searchTerms: 'Breaking Bad',
          }),
        })
        tvDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(tvDeleteStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })
    })

    describe('Browse request routing', () => {
      beforeEach(() => {
        contextService.hasContext.mockResolvedValue(false)
        retryService.executeWithRetry.mockImplementation(
          <T>(callback: () => T) => Promise.resolve(callback()),
        )
        mediaBrowsingStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )
      })

      it('should route to mediaBrowsingStrategy when SearchIntent is Library', async () => {
        mockInvoke.mockResolvedValue({
          content: JSON.stringify({
            mediaType: MediaRequestType.Both,
            searchIntent: SearchIntent.Library,
            searchTerms: 'action movies',
          }),
        })

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          state: mockState,
          context: {
            mediaType: MediaRequestType.Both,
            searchIntent: SearchIntent.Library,
            searchTerms: 'action movies',
          },
        })
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to mediaBrowsingStrategy when no download/delete keywords found', async () => {
        const browseMessage = new HumanMessage({
          content: 'Show me some action movies',
        })
        mockInvoke.mockResolvedValue({
          content: JSON.stringify({
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Both,
            searchTerms: 'action',
          }),
        })

        const result = await handler.handleRequest(
          browseMessage,
          [browseMessage],
          mockUserId,
          mockState,
        )

        expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })
    })

    describe('Error handling', () => {
      beforeEach(() => {
        contextService.hasContext.mockResolvedValue(false)
      })

      it('should throw error when strategy fails', async () => {
        const error = new Error('Strategy failed')
        retryService.executeWithRetry.mockImplementation(
          <T>(callback: () => T) => Promise.resolve(callback()),
        )
        mockInvoke.mockResolvedValue({
          content: JSON.stringify({
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.External,
            searchTerms: 'The Matrix',
          }),
        })
        movieDownloadStrategy.handleRequest.mockRejectedValue(error)

        await expect(
          handler.handleRequest(
            mockMessage,
            mockMessages,
            mockUserId,
            mockState,
          ),
        ).rejects.toThrow('Strategy failed')
      })

      it('should handle getMediaTypeAndIntent errors gracefully with defaults', async () => {
        retryService.executeWithRetry.mockRejectedValue(
          new Error('LLM call failed'),
        )
        mediaBrowsingStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        // Should fallback to default (Both, Library) and route to browsing
        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockState,
        )

        expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })
    })
  })

  describe('getMediaTypeAndIntent', () => {
    it('should successfully determine media type and intent from LLM', async () => {
      const expectedResponse = {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.External,
        searchTerms: 'The Matrix',
      }

      retryService.executeWithRetry.mockImplementation(<T>(callback: () => T) =>
        Promise.resolve(callback()),
      )
      mockInvoke.mockResolvedValue({
        content: JSON.stringify(expectedResponse),
      })

      contextService.hasContext.mockResolvedValue(false)
      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(retryService.executeWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        'OpenAI-getMediaTypeAndIntent',
      )
      expect(mockInvoke).toHaveBeenCalled()
    })

    it('should return defaults when LLM response is invalid', async () => {
      retryService.executeWithRetry.mockImplementation(<T>(callback: () => T) =>
        Promise.resolve(callback()),
      )
      mockInvoke.mockResolvedValue({
        content: 'invalid json',
      })

      contextService.hasContext.mockResolvedValue(false)
      mediaBrowsingStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      // Should fallback to browsing strategy with defaults
      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should use retry service for LLM calls', async () => {
      let attempts = 0
      retryService.executeWithRetry.mockImplementation(
        async (callback: () => unknown) => {
          attempts++
          if (attempts < 2) {
            throw new Error('Temporary failure')
          }
          return callback()
        },
      )

      mockInvoke.mockResolvedValue({
        content: JSON.stringify({
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.Library,
          searchTerms: '',
        }),
      })

      contextService.hasContext.mockResolvedValue(false)
      mediaBrowsingStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(retryService.executeWithRetry).toHaveBeenCalled()
    })
  })

  describe('routeDownloadRequest', () => {
    beforeEach(() => {
      contextService.hasContext.mockResolvedValue(false)
      retryService.executeWithRetry.mockImplementation(<T>(callback: () => T) =>
        Promise.resolve(callback()),
      )
    })

    it('should route directly to movieDownloadStrategy for Movies type', async () => {
      mockInvoke.mockResolvedValue({
        content: JSON.stringify({
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.External,
          searchTerms: 'Inception',
        }),
      })
      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalledWith({
        message: mockMessage,
        messages: mockMessages,
        userId: mockUserId,
        state: undefined,
      })
    })

    it('should route directly to tvDownloadStrategy for Shows type', async () => {
      mockInvoke.mockResolvedValue({
        content: JSON.stringify({
          mediaType: MediaRequestType.Shows,
          searchIntent: SearchIntent.External,
          searchTerms: 'Breaking Bad',
        }),
      })
      tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(tvDownloadStrategy.handleRequest).toHaveBeenCalledWith({
        message: mockMessage,
        messages: mockMessages,
        userId: mockUserId,
        state: undefined,
      })
    })

    it('should use LLM classification for Both type', async () => {
      // First call for intent detection
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.External,
          searchTerms: 'Inception',
        }),
      })

      // Second call for classification
      mockInvoke.mockResolvedValueOnce({
        mediaType: 'movie',
      })

      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(mockInvoke).toHaveBeenCalledTimes(2)
      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
    })
  })

  describe('routeDeleteRequest', () => {
    beforeEach(() => {
      contextService.hasContext.mockResolvedValue(false)
      retryService.executeWithRetry.mockImplementation(<T>(callback: () => T) =>
        Promise.resolve(callback()),
      )
    })

    it('should route directly to movieDeleteStrategy for Movies type', async () => {
      mockInvoke.mockResolvedValue({
        content: JSON.stringify({
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.Delete,
          searchTerms: 'The Matrix',
        }),
      })
      movieDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(movieDeleteStrategy.handleRequest).toHaveBeenCalledWith({
        message: mockMessage,
        messages: mockMessages,
        userId: mockUserId,
        state: undefined,
      })
    })

    it('should route directly to tvDeleteStrategy for Shows type', async () => {
      mockInvoke.mockResolvedValue({
        content: JSON.stringify({
          mediaType: MediaRequestType.Shows,
          searchIntent: SearchIntent.Delete,
          searchTerms: 'Breaking Bad',
        }),
      })
      tvDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(tvDeleteStrategy.handleRequest).toHaveBeenCalledWith({
        message: mockMessage,
        messages: mockMessages,
        userId: mockUserId,
        state: undefined,
      })
    })

    it('should use LLM classification for Both type', async () => {
      // First call for intent detection
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.Delete,
          searchTerms: 'Breaking Bad',
        }),
      })

      // Second call for classification
      mockInvoke.mockResolvedValueOnce({
        mediaType: 'tv_show',
      })

      tvDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(mockInvoke).toHaveBeenCalledTimes(2)
      expect(tvDeleteStrategy.handleRequest).toHaveBeenCalled()
    })
  })

  describe('Helper methods', () => {
    beforeEach(() => {
      contextService.hasContext.mockResolvedValue(false)
      retryService.executeWithRetry.mockImplementation(<T>(callback: () => T) =>
        Promise.resolve(callback()),
      )
      downloadStatusStrategy.handleRequest.mockResolvedValue(mockStrategyResult)
    })

    it('should correctly identify download status requests with keywords', async () => {
      const statusKeywords = [
        'download status',
        'downloading',
        'current download',
        'any download',
        "what's download",
        'downloads',
        'download progress',
        'active download',
      ]

      for (const keyword of statusKeywords) {
        const message = new HumanMessage({ content: `Check ${keyword}` })
        await handler.handleRequest(message, [message], mockUserId)
        expect(downloadStatusStrategy.handleRequest).toHaveBeenCalled()
        jest.clearAllMocks()
      }
    })

    it('should correctly identify download requests with keywords and SearchIntent.External', async () => {
      const downloadKeywords = ['download', 'add', 'get me', 'grab', 'fetch']

      for (const keyword of downloadKeywords) {
        const message = new HumanMessage({
          content: `${keyword} The Matrix`,
        })
        mockInvoke.mockResolvedValue({
          content: JSON.stringify({
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.External,
            searchTerms: 'The Matrix',
          }),
        })
        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        await handler.handleRequest(message, [message], mockUserId)
        expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
        jest.clearAllMocks()
      }
    })

    it('should correctly identify delete requests with SearchIntent.Delete', async () => {
      mockInvoke.mockResolvedValue({
        content: JSON.stringify({
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.Delete,
          searchTerms: 'The Matrix',
        }),
      })
      movieDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(movieDeleteStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should successfully classify media type as movie', async () => {
      // First call for intent detection
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.External,
          searchTerms: 'The Avengers',
        }),
      })

      // Second call for classification
      mockInvoke.mockResolvedValueOnce({
        mediaType: 'movie',
      })

      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should default to movie classification on LLM error', async () => {
      // First call for intent detection
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.External,
          searchTerms: 'Something',
        }),
      })

      // Second call fails
      mockInvoke.mockRejectedValueOnce(new Error('Classification failed'))

      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mockMessage, mockMessages, mockUserId)

      // Should default to movie strategy
      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
    })
  })

  describe('Topic Switch Detection', () => {
    it('should detect topic switch when user says "what\'s the weather?"', async () => {
      const weatherMessage = new HumanMessage({
        content: "what's the weather?",
      })

      // Setup: User has an active movie context
      contextService.hasContext.mockResolvedValue(true)
      contextService.getContextType.mockResolvedValue('movie')
      contextService.getContext.mockResolvedValue({
        timestamp: Date.now(),
        isActive: true,
      })

      // Topic switch detection returns SWITCH
      retryService.executeWithRetry.mockImplementation((fn: () => unknown) =>
        Promise.resolve(fn()),
      )
      mockInvoke.mockResolvedValueOnce({
        content: 'SWITCH',
      })

      // After clearing context, normal intent detection
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.Library,
          searchTerms: 'weather',
        }),
      })

      mediaBrowsingStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(weatherMessage, [weatherMessage], mockUserId)

      expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
      expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should NOT detect topic switch when user says "first one"', async () => {
      const selectionMessage = new HumanMessage({ content: 'first one' })

      // Setup: User has an active movie context
      contextService.hasContext.mockResolvedValue(true)
      contextService.getContextType.mockResolvedValue('movie')
      contextService.getContext.mockResolvedValue({
        timestamp: Date.now(),
        isActive: true,
      })

      // Topic switch detection returns CONTINUE
      retryService.executeWithRetry.mockImplementation((fn: () => unknown) =>
        Promise.resolve(fn()),
      )
      mockInvoke.mockResolvedValueOnce({
        content: 'CONTINUE',
      })

      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        selectionMessage,
        [selectionMessage],
        mockUserId,
      )

      expect(contextService.clearContext).not.toHaveBeenCalled()
      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should detect topic switch when user says "actually nevermind"', async () => {
      const nevermindMessage = new HumanMessage({
        content: 'actually nevermind',
      })

      // Setup: User has an active TV context
      contextService.hasContext.mockResolvedValue(true)
      contextService.getContextType.mockResolvedValue('tv')
      contextService.getContext.mockResolvedValue({
        timestamp: Date.now(),
        isActive: true,
      })

      // Topic switch detection returns SWITCH
      retryService.executeWithRetry.mockImplementation((fn: () => unknown) =>
        Promise.resolve(fn()),
      )
      mockInvoke.mockResolvedValueOnce({
        content: 'SWITCH',
      })

      // After clearing context, normal intent detection
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.Library,
          searchTerms: '',
        }),
      })

      mediaBrowsingStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        nevermindMessage,
        [nevermindMessage],
        mockUserId,
      )

      expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
      expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should NOT switch when user makes TV selection with "season 1"', async () => {
      const seasonMessage = new HumanMessage({ content: 'season 1' })

      // Setup: User has an active TV context
      contextService.hasContext.mockResolvedValue(true)
      contextService.getContextType.mockResolvedValue('tv')
      contextService.getContext.mockResolvedValue({
        timestamp: Date.now(),
        isActive: true,
      })

      // Topic switch detection returns CONTINUE
      retryService.executeWithRetry.mockImplementation((fn: () => unknown) =>
        Promise.resolve(fn()),
      )
      mockInvoke.mockResolvedValueOnce({
        content: 'CONTINUE',
      })

      tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(seasonMessage, [seasonMessage], mockUserId)

      expect(contextService.clearContext).not.toHaveBeenCalled()
      expect(tvDownloadStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should handle topic switch detection errors gracefully', async () => {
      const message = new HumanMessage({ content: 'some message' })

      // Setup: User has an active movie context
      contextService.hasContext.mockResolvedValue(true)
      contextService.getContextType.mockResolvedValue('movie')
      contextService.getContext.mockResolvedValue({
        timestamp: Date.now(),
        isActive: true,
      })

      // Topic switch detection throws error
      retryService.executeWithRetry.mockImplementation((fn: () => unknown) =>
        Promise.resolve(fn()),
      )
      mockInvoke.mockRejectedValueOnce(new Error('LLM timeout'))

      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(message, [message], mockUserId)

      // Should default to not switching (keep context)
      expect(contextService.clearContext).not.toHaveBeenCalled()
      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should detect topic switch for delete contexts', async () => {
      const mathMessage = new HumanMessage({ content: 'calculate 2+2' })

      // Setup: User has an active movie delete context
      contextService.hasContext.mockResolvedValue(true)
      contextService.getContextType.mockResolvedValue('movieDelete')
      contextService.getContext.mockResolvedValue({
        timestamp: Date.now(),
        isActive: true,
      })

      // Topic switch detection returns SWITCH
      retryService.executeWithRetry.mockImplementation((fn: () => unknown) =>
        Promise.resolve(fn()),
      )
      mockInvoke.mockResolvedValueOnce({
        content: 'SWITCH',
      })

      // After clearing context, normal intent detection
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.Library,
          searchTerms: 'calculate',
        }),
      })

      mediaBrowsingStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(mathMessage, [mathMessage], mockUserId)

      expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
      expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should continue when user clarifies with "the one from 2010"', async () => {
      const clarificationMessage = new HumanMessage({
        content: 'the one from 2010',
      })

      // Setup: User has an active movie context
      contextService.hasContext.mockResolvedValue(true)
      contextService.getContextType.mockResolvedValue('movie')
      contextService.getContext.mockResolvedValue({
        timestamp: Date.now(),
        isActive: true,
      })

      // Topic switch detection returns CONTINUE
      retryService.executeWithRetry.mockImplementation((fn: () => unknown) =>
        Promise.resolve(fn()),
      )
      mockInvoke.mockResolvedValueOnce({
        content: 'CONTINUE',
      })

      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        clarificationMessage,
        [clarificationMessage],
        mockUserId,
      )

      expect(contextService.clearContext).not.toHaveBeenCalled()
      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should handle case-insensitive SWITCH responses', async () => {
      const message = new HumanMessage({ content: 'tell me a joke' })

      // Setup: User has an active context
      contextService.hasContext.mockResolvedValue(true)
      contextService.getContextType.mockResolvedValue('tv')
      contextService.getContext.mockResolvedValue({
        timestamp: Date.now(),
        isActive: true,
      })

      // Topic switch returns lowercase "switch"
      retryService.executeWithRetry.mockImplementation((fn: () => unknown) =>
        Promise.resolve(fn()),
      )
      mockInvoke.mockResolvedValueOnce({
        content: 'switch',
      })

      // Normal intent detection
      mockInvoke.mockResolvedValueOnce({
        content: JSON.stringify({
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.Library,
          searchTerms: '',
        }),
      })

      mediaBrowsingStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(message, [message], mockUserId)

      expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
    })
  })

  describe('hasActiveMediaContext', () => {
    it('should return true when active context exists and no topic switch', async () => {
      // Arrange
      contextService.hasContext.mockResolvedValue(true)
      const topicResponse = { content: 'CONTINUE' }
      retryService.executeWithRetry.mockImplementation(fn => fn())
      mockInvoke.mockResolvedValue(topicResponse) // No topic switch

      const message = new HumanMessage({ content: 'The first one' })

      // Act
      const result = await handler.hasActiveMediaContext(mockUserId, message)

      // Assert
      expect(result).toBe(true)
      expect(contextService.hasContext).toHaveBeenCalledWith(mockUserId)
      expect(retryService.executeWithRetry).toHaveBeenCalled() // Topic switch detection uses retry
      expect(contextService.clearContext).not.toHaveBeenCalled()
    })

    it('should return false when no context exists', async () => {
      // Arrange
      contextService.hasContext.mockResolvedValue(false)

      const message = new HumanMessage({ content: 'Hello' })

      // Act
      const result = await handler.hasActiveMediaContext(mockUserId, message)

      // Assert
      expect(result).toBe(false)
      expect(contextService.hasContext).toHaveBeenCalledWith(mockUserId)
      expect(retryService.executeWithRetry).not.toHaveBeenCalled() // Skip topic detection if no context
      expect(contextService.clearContext).not.toHaveBeenCalled()
    })

    it('should clear context and return false when topic switch detected', async () => {
      // Arrange
      contextService.hasContext.mockResolvedValue(true)
      const topicResponse = { content: 'SWITCH' }
      retryService.executeWithRetry.mockImplementation(fn => fn())
      mockInvoke.mockResolvedValue(topicResponse) // Topic switched

      const message = new HumanMessage({
        content: "What's the weather like?",
      })

      // Act
      const result = await handler.hasActiveMediaContext(mockUserId, message)

      // Assert
      expect(result).toBe(false)
      expect(contextService.hasContext).toHaveBeenCalledWith(mockUserId)
      expect(retryService.executeWithRetry).toHaveBeenCalled() // Topic switch detection uses retry
      expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
    })

    it('should handle topic switch detection errors gracefully', async () => {
      // Arrange
      contextService.hasContext.mockResolvedValue(true)
      retryService.executeWithRetry.mockRejectedValue(
        new Error('OpenAI API error'),
      )

      const message = new HumanMessage({ content: 'Some message' })

      // Act
      const result = await handler.hasActiveMediaContext(mockUserId, message)

      // Assert
      expect(result).toBe(true) // Default to true on error (assume no switch)
      expect(contextService.hasContext).toHaveBeenCalledWith(mockUserId)
      expect(contextService.clearContext).not.toHaveBeenCalled()
    })
  })
})
