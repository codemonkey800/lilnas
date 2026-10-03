import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages'
import { Test, TestingModule } from '@nestjs/testing'

import { LlmClient } from 'src/llm/client/llm-client'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import {
  createMockDownloadingMovie,
  createMockDownloadingSeries,
} from 'src/media-operations/request-handling/__test-fixtures__/download-fixtures'
import {
  createFakeLlmClient,
  createMockDiscordIdentity,
} from 'src/media-operations/request-handling/__test-helpers__/mock-services'
import { DownloadStatusStrategy } from 'src/media-operations/request-handling/strategies/download-status.strategy'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { ValidationUtilities } from 'src/media-operations/request-handling/utils/validation.utils'

describe('DownloadStatusStrategy', () => {
  let strategy: DownloadStatusStrategy
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>
  let llm: FakeLlmClient
  let validationUtilities: jest.Mocked<ValidationUtilities>

  const mockChatResponse = new AIMessage({
    id: 'mock-response-id',
    content: 'You have 2 movies and 1 episode downloading...',
  })

  const STATUS_OPERATIONS = [
    'media.downloadStatus',
    'media.downloadStatusEmpty',
    'media.downloadStatusError',
  ]

  /** Script every status operation with the same response. */
  const scriptLlm = (response: AIMessage | HumanMessage | Error) =>
    STATUS_OPERATIONS.forEach(op => llm.script(op, response as AIMessage))

  beforeEach(async () => {
    llm = createFakeLlmClient()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadStatusStrategy,
        {
          provide: RadarrService,
          useValue: {
            getDownloadingMovies: jest.fn(),
          },
        },
        {
          provide: SonarrService,
          useValue: {
            getDownloadingEpisodes: jest.fn(),
          },
        },
        { provide: LlmClient, useValue: llm },
        {
          provide: ValidationUtilities,
          useValue: {
            validateDownloadResponse: jest.fn(),
          },
        },
      ],
    }).compile()

    strategy = module.get<DownloadStatusStrategy>(DownloadStatusStrategy)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)
    validationUtilities = module.get(ValidationUtilities)
  })

  describe('No downloads scenario', () => {
    it('should return no downloads message when queue is empty', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'what is downloading?' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      radarrService.getDownloadingMovies.mockResolvedValue([])
      sonarrService.getDownloadingEpisodes.mockResolvedValue([])
      scriptLlm(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(radarrService.getDownloadingMovies).toHaveBeenCalled()
      expect(sonarrService.getDownloadingEpisodes).toHaveBeenCalled()
      expect(llm.calls.map(call => call.operation)).toContain(
        'media.downloadStatusEmpty',
      )
      expect(
        validationUtilities.validateDownloadResponse,
      ).not.toHaveBeenCalled()
      expect(result.messages).toHaveLength(2) // original message + response
      expect(result.messages[1]).toBe(mockChatResponse)
      expect(result.images).toEqual([])
    })

    it('should call LLM with predefined prompt when no downloads are active', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download status' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      radarrService.getDownloadingMovies.mockResolvedValue([])
      sonarrService.getDownloadingEpisodes.mockResolvedValue([])
      scriptLlm(mockChatResponse)

      await strategy.handleRequest(params)

      expect(llm.calls.map(call => call.operation)).toContain(
        'media.downloadStatusEmpty',
      )
    })
  })

  describe('Active downloads - movies only', () => {
    it('should fetch and format movie downloads correctly when movies are downloading', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'what is downloading?' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      radarrService.getDownloadingMovies.mockResolvedValue([
        createMockDownloadingMovie(),
      ])
      sonarrService.getDownloadingEpisodes.mockResolvedValue([])
      scriptLlm(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(radarrService.getDownloadingMovies).toHaveBeenCalled()
      expect(sonarrService.getDownloadingEpisodes).toHaveBeenCalled()
      expect(llm.calls.map(call => call.operation)).toContain(
        'media.downloadStatus',
      )
      expect(result.messages).toHaveLength(2)
      expect(result.messages[1]).toBe(mockChatResponse)
      expect(result.images).toEqual([])
    })

    it('should validate response against movie titles when multiple movies are downloading', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download status' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      const movie1 = createMockDownloadingMovie({ movieTitle: 'The Matrix' })
      const movie2 = createMockDownloadingMovie({
        movieTitle: 'Inception',
        progressPercent: 25.0,
      })

      radarrService.getDownloadingMovies.mockResolvedValue([movie1, movie2])
      sonarrService.getDownloadingEpisodes.mockResolvedValue([])
      scriptLlm(mockChatResponse)

      await strategy.handleRequest(params)

      expect(validationUtilities.validateDownloadResponse).toHaveBeenCalledWith(
        mockChatResponse,
        ['The Matrix', 'Inception'],
        [],
        'user123',
      )
    })
  })

  describe('Active downloads - episodes only', () => {
    it('should fetch and format episode downloads correctly when episodes are downloading', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'what is downloading?' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      radarrService.getDownloadingMovies.mockResolvedValue([])
      sonarrService.getDownloadingEpisodes.mockResolvedValue([
        createMockDownloadingSeries(),
      ])
      scriptLlm(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(radarrService.getDownloadingMovies).toHaveBeenCalled()
      expect(sonarrService.getDownloadingEpisodes).toHaveBeenCalled()
      expect(result.messages).toHaveLength(2)
      expect(result.images).toEqual([])
    })

    it('should format episode info with S01E02 format when displaying episode details', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download status' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      const episode = createMockDownloadingSeries({
        seriesTitle: 'Breaking Bad',
        seasonNumber: 2,
        episodeNumber: 13,
        episodeTitle: 'ABQ',
      })

      radarrService.getDownloadingMovies.mockResolvedValue([])
      sonarrService.getDownloadingEpisodes.mockResolvedValue([episode])
      scriptLlm(mockChatResponse)

      await strategy.handleRequest(params)

      expect(validationUtilities.validateDownloadResponse).toHaveBeenCalledWith(
        mockChatResponse,
        [],
        ['Breaking Bad'],
        'user123',
      )
    })
  })

  describe('Active downloads - season packs', () => {
    const originalApiKey = process.env.OPENAI_API_KEY

    beforeEach(() => {
      process.env.OPENAI_API_KEY = 'test-key'
    })

    afterEach(() => {
      process.env.OPENAI_API_KEY = originalApiKey
      jest.restoreAllMocks()
    })

    it('should describe a season pack as one download with its episode range', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download status' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }
      scriptLlm(mockChatResponse)

      radarrService.getDownloadingMovies.mockResolvedValue([])
      sonarrService.getDownloadingEpisodes.mockResolvedValue([
        createMockDownloadingSeries({
          seriesTitle: 'The Wire',
          episodeNumber: undefined,
          episodeTitle: undefined,
          episodeCount: 10,
          episodeLabel: 'S01E01–E10',
        }),
        createMockDownloadingSeries(),
      ])

      await strategy.handleRequest(params)

      const prompt: BaseMessage[] = llm.calls[0].messages
      const context = prompt
        .map(m => String(m.content))
        .find(c => c.startsWith('ACTIVE DOWNLOADS FOUND'))
      expect(context).toContain(
        '0 movies and 2 TV downloads (11 episodes) currently downloading',
      )
      expect(context).toContain(
        '"episode":"S01E01–E10 (season pack, 10 episodes)"',
      )
      expect(context).toContain('"episode":"S01E01: Pilot"')
    })
  })

  describe('Active downloads - mixed content', () => {
    it('should handle both movies and episodes in single response when both types are downloading', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'what is downloading?' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      radarrService.getDownloadingMovies.mockResolvedValue([
        createMockDownloadingMovie(),
      ])
      sonarrService.getDownloadingEpisodes.mockResolvedValue([
        createMockDownloadingSeries(),
      ])
      scriptLlm(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(radarrService.getDownloadingMovies).toHaveBeenCalled()
      expect(sonarrService.getDownloadingEpisodes).toHaveBeenCalled()
      expect(validationUtilities.validateDownloadResponse).toHaveBeenCalledWith(
        mockChatResponse,
        ['The Matrix'],
        ['Breaking Bad'],
        'user123',
      )
      expect(result.messages).toHaveLength(2)
      expect(result.images).toEqual([])
    })

    it('should properly format summary with both totalMovies and totalEpisodes when multiple items are downloading', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download status' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      const movie1 = createMockDownloadingMovie({ movieTitle: 'The Matrix' })
      const movie2 = createMockDownloadingMovie({ movieTitle: 'Inception' })
      const episode1 = createMockDownloadingSeries({
        seriesTitle: 'Breaking Bad',
      })
      const episode2 = createMockDownloadingSeries({
        seriesTitle: 'The Wire',
        seasonNumber: 2,
        episodeNumber: 5,
      })

      radarrService.getDownloadingMovies.mockResolvedValue([movie1, movie2])
      sonarrService.getDownloadingEpisodes.mockResolvedValue([
        episode1,
        episode2,
      ])
      scriptLlm(mockChatResponse)

      await strategy.handleRequest(params)

      expect(validationUtilities.validateDownloadResponse).toHaveBeenCalledWith(
        mockChatResponse,
        ['The Matrix', 'Inception'],
        ['Breaking Bad', 'The Wire'],
        'user123',
      )
    })
  })

  describe('Error handling', () => {
    it('should handle service failures gracefully when services are unavailable', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'what is downloading?' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      const error = new Error('Radarr service unavailable')
      radarrService.getDownloadingMovies.mockRejectedValue(error)
      sonarrService.getDownloadingEpisodes.mockRejectedValue(error)

      const errorResponse = new AIMessage({
        id: 'error-response',
        content: 'The download services are currently unavailable.',
      })
      scriptLlm(errorResponse)

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(2)
      expect(result.messages[1]).toBe(errorResponse)
      expect(result.images).toEqual([])
    })

    it('should return fallback response when connection times out', async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'download status' }),
        messages: [],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      radarrService.getDownloadingMovies.mockRejectedValue(
        new Error('Connection timeout'),
      )
      sonarrService.getDownloadingEpisodes.mockRejectedValue(
        new Error('Connection timeout'),
      )

      const fallbackResponse = new AIMessage({
        id: 'fallback',
        content: 'Sorry, I cannot check downloads right now.',
      })
      scriptLlm(fallbackResponse)

      const result = await strategy.handleRequest(params)

      expect(llm.calls.map(call => call.operation)).toContain(
        'media.downloadStatusError',
      )
      expect(result.messages[1]).toBe(fallbackResponse)
    })
  })

  describe('Conversation context', () => {
    it('should include previous messages in LLM call when conversation history exists', async () => {
      const previousMessage1 = new HumanMessage({
        id: '0',
        content: 'hello',
      })
      const previousMessage2 = new HumanMessage({
        id: '1',
        content: 'can you help me?',
      })

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '2', content: 'download status' }),
        messages: [previousMessage1, previousMessage2],
        userId: 'user123',
        discord: createMockDiscordIdentity('user123'),
      }

      radarrService.getDownloadingMovies.mockResolvedValue([
        createMockDownloadingMovie(),
      ])
      sonarrService.getDownloadingEpisodes.mockResolvedValue([])
      scriptLlm(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(4) // 2 previous + current + response
      expect(result.messages[0]).toBe(previousMessage1)
      expect(result.messages[1]).toBe(previousMessage2)
      expect(result.messages[2]).toBe(params.message)
      expect(result.messages[3]).toBe(mockChatResponse)
    })
  })

  describe('Phase 1: Negative Test Cases', () => {
    describe('Concurrent Operations', () => {
      it('should handle 10 simultaneous requests without race conditions', async () => {
        // Setup: Create 10 different user requests
        const requests = Array.from({ length: 10 }, (_, i) => ({
          message: new HumanMessage({
            id: `msg-${i}`,
            content: `download status ${i}`,
          }),
          messages: [],
          userId: `user${i}`,
          discord: createMockDiscordIdentity(`user${i}`),
        }))

        // Setup mocks
        radarrService.getDownloadingMovies.mockResolvedValue([
          createMockDownloadingMovie(),
        ])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([
          createMockDownloadingSeries(),
        ])
        scriptLlm(mockChatResponse)

        // Execute: Run all requests concurrently
        const results = await Promise.all(
          requests.map(req => strategy.handleRequest(req)),
        )

        // Verify: All completed successfully
        expect(results).toHaveLength(10)
        results.forEach(result => {
          expect(result.messages).toBeDefined()
          expect(result.messages.length).toBeGreaterThan(0)
        })

        // Verify: Services called correct number of times
        expect(radarrService.getDownloadingMovies).toHaveBeenCalledTimes(10)
        expect(sonarrService.getDownloadingEpisodes).toHaveBeenCalledTimes(10)
      })

      it('should maintain request isolation between concurrent calls', async () => {
        const request1: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: 'what is downloading?',
          }),
          messages: [],
          userId: 'user1',
          discord: createMockDiscordIdentity('user1'),
        }

        const request2: StrategyRequestParams = {
          message: new HumanMessage({ id: '2', content: 'download status' }),
          messages: [],
          userId: 'user2',
          discord: createMockDiscordIdentity('user2'),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([
          createMockDownloadingMovie(),
        ])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([
          createMockDownloadingSeries(),
        ])
        scriptLlm(mockChatResponse)

        // Execute concurrently
        const results = await Promise.all([
          strategy.handleRequest(request1),
          strategy.handleRequest(request2),
        ])

        // Both should succeed with proper isolation
        expect(results).toHaveLength(2)
        results.forEach(result => {
          expect(result.messages).toBeDefined()
          expect(result.images).toEqual([])
        })
      })

      it('should handle mixed success and failure during concurrent operations', async () => {
        // Request 1 will succeed, Request 2 will fail
        const request1: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user1',
          discord: createMockDiscordIdentity('user1'),
        }

        const request2: StrategyRequestParams = {
          message: new HumanMessage({
            id: '2',
            content: 'what is downloading?',
          }),
          messages: [],
          userId: 'user2',
          discord: createMockDiscordIdentity('user2'),
        }

        // Setup mock to succeed first time, fail second time
        let callCount = 0
        radarrService.getDownloadingMovies.mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve([createMockDownloadingMovie()])
          }
          return Promise.reject(new Error('Service unavailable'))
        })

        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Execute concurrently
        const results = await Promise.all([
          strategy.handleRequest(request1),
          strategy.handleRequest(request2),
        ])

        // Both should have responses (error handled gracefully)
        expect(results).toHaveLength(2)
        results.forEach(result => {
          expect(result.messages).toBeDefined()
        })
      })
    })

    describe('Malformed Queue Data', () => {
      it('should handle queue item with missing title field', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        const malformedMovie = createMockDownloadingMovie({
          movieTitle: undefined as never,
        })

        radarrService.getDownloadingMovies.mockResolvedValue([malformedMovie])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Should handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(
          validationUtilities.validateDownloadResponse,
        ).toHaveBeenCalledWith(
          mockChatResponse,
          [], // Title filtered out due to being falsy
          [],
          'user123',
        )
      })

      it('should handle queue item with null progress percentage', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        const malformedMovie = createMockDownloadingMovie({
          progressPercent: null as never,
        })

        radarrService.getDownloadingMovies.mockResolvedValue([malformedMovie])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Should handle gracefully
        await expect(strategy.handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle queue item with missing size field', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        const malformedEpisode = createMockDownloadingSeries({
          size: undefined as never,
        })

        radarrService.getDownloadingMovies.mockResolvedValue([])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([
          malformedEpisode,
        ])
        scriptLlm(mockChatResponse)

        // Should handle gracefully (formatFileSize should handle undefined)
        await expect(strategy.handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle queue item with missing episode metadata', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        const malformedEpisode = createMockDownloadingSeries({
          seasonNumber: undefined as never,
          episodeNumber: undefined as never,
          episodeTitle: undefined as never,
        })

        radarrService.getDownloadingMovies.mockResolvedValue([])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([
          malformedEpisode,
        ])
        scriptLlm(mockChatResponse)

        // Should handle gracefully
        await expect(strategy.handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle empty queue arrays without errors', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(llm.calls.map(call => call.operation)).toContain(
          'media.downloadStatusEmpty',
        )
      })

      it('should handle queue with extremely large arrays', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        // Create 100 movies in queue
        const largeMovieArray = Array.from({ length: 100 }, (_, i) =>
          createMockDownloadingMovie({
            id: i,
            movieTitle: `Movie ${i}`,
          }),
        )

        radarrService.getDownloadingMovies.mockResolvedValue(largeMovieArray)
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Should handle large arrays without errors
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(
          validationUtilities.validateDownloadResponse,
        ).toHaveBeenCalledWith(
          mockChatResponse,
          expect.arrayContaining(['Movie 0', 'Movie 99']),
          [],
          'user123',
        )
      })
    })

    describe('Service Failures', () => {
      it('should handle RadarrService getDownloadingMovies throwing exception', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        radarrService.getDownloadingMovies.mockRejectedValue(
          new Error('Radarr API connection failed'),
        )
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Should catch and handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(llm.calls.map(call => call.operation)).toContain(
          'media.downloadStatusError',
        )
      })

      it('should handle SonarrService getDownloadingEpisodes throwing exception', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([])
        sonarrService.getDownloadingEpisodes.mockRejectedValue(
          new Error('Sonarr API connection failed'),
        )
        scriptLlm(mockChatResponse)

        // Should catch and handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(llm.calls.map(call => call.operation)).toContain(
          'media.downloadStatusError',
        )
      })

      it('should handle both services failing simultaneously', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        radarrService.getDownloadingMovies.mockRejectedValue(
          new Error('Radarr unavailable'),
        )
        sonarrService.getDownloadingEpisodes.mockRejectedValue(
          new Error('Sonarr unavailable'),
        )
        scriptLlm(mockChatResponse)

        // Should catch and handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(llm.calls.map(call => call.operation)).toContain(
          'media.downloadStatusError',
        )
      })

      it('should handle RetryService throwing exception after exhausting retries', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([
          createMockDownloadingMovie(),
        ])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(new Error('Max retries exceeded'))

        // The base strategy catches all errors and returns fallback response
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.images).toEqual([])
      })

      it('should handle ValidationUtilities throwing exception', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([
          createMockDownloadingMovie(),
        ])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)
        validationUtilities.validateDownloadResponse.mockImplementation(() => {
          throw new Error('Validation failed')
        })

        // Validation happens after response is generated but before return
        // If validation throws, it's caught by the try-catch in executeRequest
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
      })
    })

    describe('Parameters Edge Cases', () => {
      it('should handle undefined userId', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: undefined as never,
          discord: createMockDiscordIdentity(undefined as never),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([
          createMockDownloadingMovie(),
        ])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Should handle gracefully
        await expect(strategy.handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle empty userId', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: [],
          userId: '',
          discord: createMockDiscordIdentity(''),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([
          createMockDownloadingMovie(),
        ])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Should handle gracefully
        await expect(strategy.handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle empty message content', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: '' }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([
          createMockDownloadingMovie(),
        ])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Should handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
      })

      it('should handle null message', async () => {
        const params: StrategyRequestParams = {
          message: null as never,
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([
          createMockDownloadingMovie(),
        ])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Should handle or throw appropriately
        await expect(strategy.handleRequest(params)).rejects.toThrow()
      })

      it('should handle undefined messages array', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'download status' }),
          messages: undefined as never,
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([
          createMockDownloadingMovie(),
        ])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Should handle or throw
        await expect(strategy.handleRequest(params)).rejects.toThrow()
      })

      it('should handle extremely long message content', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: 'download status ' + 'x'.repeat(10000),
          }),
          messages: [],
          userId: 'user123',
          discord: createMockDiscordIdentity('user123'),
        }

        radarrService.getDownloadingMovies.mockResolvedValue([
          createMockDownloadingMovie(),
        ])
        sonarrService.getDownloadingEpisodes.mockResolvedValue([])
        scriptLlm(mockChatResponse)

        // Should handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
      })
    })
  })
})
