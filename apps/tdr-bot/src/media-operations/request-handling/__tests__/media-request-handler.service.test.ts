import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { QualityTier } from '@lilnas/utils/download/types'
import { Test, TestingModule } from '@nestjs/testing'

import { LlmClient } from 'src/llm/client/llm-client'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import {
  createFakeLlmClient,
  createMockDiscordIdentity,
} from 'src/media-operations/request-handling/__test-helpers__/mock-services'
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
import { MediaContextType } from 'src/media-operations/request-handling/types/request-context.type'
import { StrategyResult } from 'src/media-operations/request-handling/types/strategy-result.type'
import { MediaRequestType, SearchIntent } from 'src/schemas/graph'

describe('MediaRequestHandler', () => {
  let handler: MediaRequestHandler
  let llm: FakeLlmClient
  let movieDownloadStrategy: jest.Mocked<MovieDownloadStrategy>
  let tvDownloadStrategy: jest.Mocked<TvDownloadStrategy>
  let movieDeleteStrategy: jest.Mocked<MovieDeleteStrategy>
  let tvDeleteStrategy: jest.Mocked<TvDeleteStrategy>
  let mediaBrowsingStrategy: jest.Mocked<MediaBrowsingStrategy>
  let downloadStatusStrategy: jest.Mocked<DownloadStatusStrategy>

  // Mock data
  const mockUserId = 'user123'
  const mockDiscord = createMockDiscordIdentity(mockUserId)
  const mockMessage = new HumanMessage({ content: 'Download The Matrix' })
  const mockMessages: BaseMessage[] = [mockMessage]

  const mockStrategyResult: StrategyResult = {
    images: [],
    messages: [new HumanMessage({ content: 'Strategy response' })],
  }

  beforeEach(async () => {
    llm = createFakeLlmClient()

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaRequestHandler,
        { provide: LlmClient, useValue: llm },
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
      beforeEach(() => {
        llm.script('media.topicSwitch', 'CONTINUE')
      })

      it('should route to movieDownloadStrategy when context type is "movie"', async () => {
        const mockContext: MovieSelectionContext = {
          type: 'movie',
          query: 'The Matrix',
          searchResults: [],
          timestamp: Date.now(),
          isActive: true,
        }
        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
          { type: MediaContextType.MovieDownload, data: mockContext },
        )

        expect(movieDownloadStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          discord: mockDiscord,
          context: mockContext,
        })
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to tvDownloadStrategy when context type is "tv"', async () => {
        const mockContext: TvShowSelectionContext = {
          type: 'tvShow',
          query: 'Breaking Bad',
          searchResults: [],
          timestamp: Date.now(),
          isActive: true,
        }
        tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
          { type: MediaContextType.TvDownload, data: mockContext },
        )

        expect(tvDownloadStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          discord: mockDiscord,
          context: mockContext,
        })
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to movieDeleteStrategy when context type is "movieDelete"', async () => {
        const mockContext: MovieDeleteContext = {
          type: 'movieDelete',
          query: 'The Matrix',
          searchResults: [],
          timestamp: Date.now(),
          isActive: true,
        }
        movieDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
          { type: MediaContextType.MovieDelete, data: mockContext },
        )

        expect(movieDeleteStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          discord: mockDiscord,
          context: mockContext,
        })
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to tvDeleteStrategy when context type is "tvDelete"', async () => {
        const mockContext: TvShowDeleteContext = {
          type: 'tvShowDelete',
          query: 'Breaking Bad',
          searchResults: [],
          timestamp: Date.now(),
          isActive: true,
        }
        tvDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
          { type: MediaContextType.TvDelete, data: mockContext },
        )

        expect(tvDeleteStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          discord: mockDiscord,
          context: mockContext,
        })
        expect(result).toBe(mockStrategyResult)
      })

      it('should ignore an unknown context type and continue', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.Library,
          searchTerms: '',
        })
        mediaBrowsingStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
          { type: 'unknownType' as MediaContextType, data: {} },
        )

        expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalled()
      })

      it('should not check for a topic switch without an active context', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.Library,
          searchTerms: '',
        })
        mediaBrowsingStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(llm.calls.map(call => call.operation)).not.toContain(
          'media.topicSwitch',
        )
      })
    })

    describe('Status request routing', () => {
      beforeEach(() => {
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
          mockDiscord,
        )

        expect(downloadStatusStrategy.handleRequest).toHaveBeenCalledWith({
          message: statusMessage,
          messages: [statusMessage],
          userId: mockUserId,
          discord: mockDiscord,
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
          await handler.handleRequest(
            message,
            [message],
            mockUserId,
            mockDiscord,
          )
          expect(downloadStatusStrategy.handleRequest).toHaveBeenCalled()
          jest.clearAllMocks()
        }
      })
    })

    describe('Download request routing', () => {
      it('should route to movieDownloadStrategy for Movies media type', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.External,
          searchTerms: 'The Matrix',
        })
        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to tvDownloadStrategy for Shows media type', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Shows,
          searchIntent: SearchIntent.External,
          searchTerms: 'Breaking Bad',
        })
        tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(tvDownloadStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })

      it('should use LLM classification for Both media type and route to movie', async () => {
        // First call: getMediaTypeAndIntent returns Both
        llm.script('media.intent', {
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.External,
          searchTerms: 'The Matrix',
        })

        // Second call: classifyMediaType returns movie
        llm.script('media.classifyType', { mediaType: 'movie' })

        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(llm.calls).toHaveLength(2)
        expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })

      it('should use LLM classification for Both media type and route to TV', async () => {
        // First call: getMediaTypeAndIntent returns Both
        llm.script('media.intent', {
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.External,
          searchTerms: 'Breaking Bad',
        })

        // Second call: classifyMediaType returns tv_show
        llm.script('media.classifyType', { mediaType: 'tv_show' })

        tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(llm.calls).toHaveLength(2)
        expect(tvDownloadStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })
    })

    describe('Delete request routing', () => {
      it('should route to movieDeleteStrategy for Movies with Delete intent', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.Delete,
          searchTerms: 'The Matrix',
        })
        movieDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(movieDeleteStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })

      it('should route to tvDeleteStrategy for Shows with Delete intent', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Shows,
          searchIntent: SearchIntent.Delete,
          searchTerms: 'Breaking Bad',
        })
        tvDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(tvDeleteStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })
    })

    describe('Browse request routing', () => {
      beforeEach(() => {
        mediaBrowsingStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )
      })

      it('should route to mediaBrowsingStrategy when SearchIntent is Library', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.Library,
          searchTerms: 'action movies',
        })

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          discord: mockDiscord,
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
        llm.script('media.intent', {
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.Both,
          searchTerms: 'action',
        })

        const result = await handler.handleRequest(
          browseMessage,
          [browseMessage],
          mockUserId,
          mockDiscord,
        )

        expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalled()
        expect(result).toBe(mockStrategyResult)
      })
    })

    describe('Error handling', () => {
      it('should throw error when strategy fails', async () => {
        const error = new Error('Strategy failed')
        llm.script('media.intent', {
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.External,
          searchTerms: 'The Matrix',
        })
        movieDownloadStrategy.handleRequest.mockRejectedValue(error)

        await expect(
          handler.handleRequest(
            mockMessage,
            mockMessages,
            mockUserId,
            mockDiscord,
          ),
        ).rejects.toThrow('Strategy failed')
      })

      it('should handle getMediaTypeAndIntent errors gracefully with defaults', async () => {
        llm.script('media.intent', new Error('LLM call failed'))
        mediaBrowsingStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        // Should fallback to default (Both, Library) and route to browsing
        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
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

      llm.script('media.intent', expectedResponse)

      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(llm.calls[0]).toMatchObject({
        operation: 'media.intent',
        role: 'reasoning',
      })
    })

    it('should return defaults when LLM response is invalid', async () => {
      llm.script('media.intent', 'invalid json')

      mediaBrowsingStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      // Should fallback to browsing strategy with defaults
      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(mediaBrowsingStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should make the intent call through the LlmClient', async () => {
      llm.script('media.intent', {
        mediaType: MediaRequestType.Both,
        searchIntent: SearchIntent.Library,
        searchTerms: '',
      })

      mediaBrowsingStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(llm.calls.map(call => call.operation)).toContain('media.intent')
    })
  })

  describe('routeDownloadRequest', () => {
    it('should route directly to movieDownloadStrategy for Movies type', async () => {
      llm.script('media.intent', {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.External,
        searchTerms: 'Inception',
      })
      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalledWith({
        message: mockMessage,
        messages: mockMessages,
        userId: mockUserId,
        discord: mockDiscord,
        state: undefined,
      })
    })

    it('should route directly to tvDownloadStrategy for Shows type', async () => {
      llm.script('media.intent', {
        mediaType: MediaRequestType.Shows,
        searchIntent: SearchIntent.External,
        searchTerms: 'Breaking Bad',
      })
      tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(tvDownloadStrategy.handleRequest).toHaveBeenCalledWith({
        message: mockMessage,
        messages: mockMessages,
        userId: mockUserId,
        discord: mockDiscord,
        state: undefined,
      })
    })

    it('should use LLM classification for Both type', async () => {
      // First call for intent detection
      llm.script('media.intent', {
        mediaType: MediaRequestType.Both,
        searchIntent: SearchIntent.External,
        searchTerms: 'Inception',
      })

      // Second call for classification
      llm.script('media.classifyType', { mediaType: 'movie' })

      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(llm.calls).toHaveLength(2)
      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
    })

    describe('quality from the message', () => {
      it('puts a 4k request on the movie strategy params as up_to_4k', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.External,
          searchTerms: 'Dune',
          quality: '4k',
        })
        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(movieDownloadStrategy.handleRequest).toHaveBeenCalledWith({
          message: mockMessage,
          messages: mockMessages,
          userId: mockUserId,
          discord: mockDiscord,
          state: undefined,
          qualityTier: QualityTier.UpTo4k,
        })
      })

      it('puts a 720p request on the TV strategy params as up_to_720p', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Shows,
          searchIntent: SearchIntent.External,
          searchTerms: 'The Office',
          quality: '720p',
        })
        tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(tvDownloadStrategy.handleRequest).toHaveBeenCalledWith(
          expect.objectContaining({ qualityTier: QualityTier.UpTo720p }),
        )
      })

      it('carries the tier through LLM classification for Both type', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.External,
          searchTerms: 'Severance',
          quality: '1080p',
        })
        llm.script('media.classifyType', { mediaType: 'tv_show' })
        tvDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

        await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(tvDownloadStrategy.handleRequest).toHaveBeenCalledWith(
          expect.objectContaining({ qualityTier: QualityTier.Hd }),
        )
      })

      it('omits the tier for a null quality', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.External,
          searchTerms: 'Dune',
          quality: null,
        })
        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        const [params] = movieDownloadStrategy.handleRequest.mock.calls[0]
        expect(params).not.toHaveProperty('qualityTier')
      })

      it('omits the tier for an invalid quality and still routes the download', async () => {
        llm.script('media.intent', {
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.External,
          searchTerms: 'Dune',
          quality: 'super-mega-hd',
        })
        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        const result = await handler.handleRequest(
          mockMessage,
          mockMessages,
          mockUserId,
          mockDiscord,
        )

        expect(result).toBe(mockStrategyResult)
        expect(mediaBrowsingStrategy.handleRequest).not.toHaveBeenCalled()
        const [params] = movieDownloadStrategy.handleRequest.mock.calls[0]
        expect(params).not.toHaveProperty('qualityTier')
      })
    })
  })

  describe('routeDeleteRequest', () => {
    it('should route directly to movieDeleteStrategy for Movies type', async () => {
      llm.script('media.intent', {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.Delete,
        searchTerms: 'The Matrix',
      })
      movieDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(movieDeleteStrategy.handleRequest).toHaveBeenCalledWith({
        message: mockMessage,
        messages: mockMessages,
        userId: mockUserId,
        discord: mockDiscord,
        state: undefined,
      })
    })

    it('should route directly to tvDeleteStrategy for Shows type', async () => {
      llm.script('media.intent', {
        mediaType: MediaRequestType.Shows,
        searchIntent: SearchIntent.Delete,
        searchTerms: 'Breaking Bad',
      })
      tvDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(tvDeleteStrategy.handleRequest).toHaveBeenCalledWith({
        message: mockMessage,
        messages: mockMessages,
        userId: mockUserId,
        discord: mockDiscord,
        state: undefined,
      })
    })

    it('should use LLM classification for Both type', async () => {
      // First call for intent detection
      llm.script('media.intent', {
        mediaType: MediaRequestType.Both,
        searchIntent: SearchIntent.Delete,
        searchTerms: 'Breaking Bad',
      })

      // Second call for classification
      llm.script('media.classifyType', { mediaType: 'tv_show' })

      tvDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(llm.calls).toHaveLength(2)
      expect(tvDeleteStrategy.handleRequest).toHaveBeenCalled()
    })
  })

  describe('Helper methods', () => {
    beforeEach(() => {
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
        await handler.handleRequest(message, [message], mockUserId, mockDiscord)
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
        llm.script('media.intent', {
          mediaType: MediaRequestType.Movies,
          searchIntent: SearchIntent.External,
          searchTerms: 'The Matrix',
        })
        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        await handler.handleRequest(message, [message], mockUserId, mockDiscord)
        expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
        jest.clearAllMocks()
      }
    })

    it('should correctly identify delete requests with SearchIntent.Delete', async () => {
      llm.script('media.intent', {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.Delete,
        searchTerms: 'The Matrix',
      })
      movieDeleteStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(movieDeleteStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should successfully classify media type as movie', async () => {
      // First call for intent detection
      llm.script('media.intent', {
        mediaType: MediaRequestType.Both,
        searchIntent: SearchIntent.External,
        searchTerms: 'The Avengers',
      })

      // Second call for classification
      llm.script('media.classifyType', { mediaType: 'movie' })

      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
    })

    it('should default to movie classification on LLM error', async () => {
      // First call for intent detection
      llm.script('media.intent', {
        mediaType: MediaRequestType.Both,
        searchIntent: SearchIntent.External,
        searchTerms: 'Something',
      })

      // Second call fails
      llm.script('media.classifyType', new Error('Classification failed'))

      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      await handler.handleRequest(
        mockMessage,
        mockMessages,
        mockUserId,
        mockDiscord,
      )

      // Should default to movie strategy
      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
    })
  })

  describe('Topic Switch Detection', () => {
    const movieContext = {
      type: MediaContextType.MovieDownload,
      data: { type: 'movie', timestamp: Date.now(), isActive: true },
    }

    it.each([
      ["what's the weather?", MediaContextType.MovieDownload],
      ['actually nevermind', MediaContextType.TvDownload],
      ['calculate 2+2', MediaContextType.MovieDelete],
      ['stop', MediaContextType.TvDelete],
    ])(
      'reroutes "%s" out of a %s context without running a strategy',
      async (content, type) => {
        const message = new HumanMessage({ content })
        llm.script('media.topicSwitch', 'SWITCH')

        const result = await handler.handleRequest(
          message,
          [message],
          mockUserId,
          mockDiscord,
          { type, data: movieContext.data },
        )

        expect(result).toEqual({ images: [], messages: [], reroute: true })
        expect(result.pendingContext).toBeUndefined()
        for (const strategy of [
          movieDownloadStrategy,
          tvDownloadStrategy,
          movieDeleteStrategy,
          tvDeleteStrategy,
          mediaBrowsingStrategy,
        ]) {
          expect(strategy.handleRequest).not.toHaveBeenCalled()
        }
        expect(llm.calls.map(call => call.operation)).not.toContain(
          'media.intent',
        )
      },
    )

    it.each(['first one', 'season 1', 'the one from 2010'])(
      'continues the context when the user says "%s"',
      async content => {
        const message = new HumanMessage({ content })
        llm.script('media.topicSwitch', 'CONTINUE')
        movieDownloadStrategy.handleRequest.mockResolvedValue(
          mockStrategyResult,
        )

        const result = await handler.handleRequest(
          message,
          [message],
          mockUserId,
          mockDiscord,
          movieContext,
        )

        expect(result).toBe(mockStrategyResult)
        expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
      },
    )

    it('should handle case-insensitive SWITCH responses', async () => {
      const message = new HumanMessage({ content: 'never mind' })
      llm.script('media.topicSwitch', 'switch')

      const result = await handler.handleRequest(
        message,
        [message],
        mockUserId,
        mockDiscord,
        movieContext,
      )

      expect(result.reroute).toBe(true)
    })

    it('should keep the context when topic switch detection fails', async () => {
      const message = new HumanMessage({ content: 'some message' })
      llm.script('media.topicSwitch', new Error('LLM timeout'))
      movieDownloadStrategy.handleRequest.mockResolvedValue(mockStrategyResult)

      const result = await handler.handleRequest(
        message,
        [message],
        mockUserId,
        mockDiscord,
        movieContext,
      )

      expect(result.reroute).toBeUndefined()
      expect(movieDownloadStrategy.handleRequest).toHaveBeenCalled()
    })
  })

  describe('detectTopicSwitch', () => {
    it('should return false for a continuation', async () => {
      llm.script('media.topicSwitch', 'CONTINUE')

      const result = await handler.detectTopicSwitch(
        new HumanMessage({ content: 'The first one' }),
      )

      expect(result).toBe(false)
    })

    it('should return true for a switch', async () => {
      llm.script('media.topicSwitch', 'SWITCH')

      const result = await handler.detectTopicSwitch(
        new HumanMessage({ content: "What's the weather like?" }),
      )

      expect(result).toBe(true)
    })

    it('should assume no switch when the LLM call fails', async () => {
      llm.script('media.topicSwitch', new Error('OpenAI API error'))

      const result = await handler.detectTopicSwitch(
        new HumanMessage({ content: 'Some message' }),
      )

      expect(result).toBe(false)
    })
  })
})
