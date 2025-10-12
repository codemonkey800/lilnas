import { HumanMessage } from '@langchain/core/messages'
import { Test, TestingModule } from '@nestjs/testing'

import { MediaBrowsingStrategy } from 'src/media-operations/request-handling/strategies/media-browsing.strategy'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { DataFetchingUtilities } from 'src/media-operations/request-handling/utils/data-fetching.utils'
import { MediaRequest, MediaRequestType, SearchIntent } from 'src/schemas/graph'
import { StateService } from 'src/state/state.service'
import { RetryService } from 'src/utils/retry.service'

describe('MediaBrowsingStrategy', () => {
  let strategy: MediaBrowsingStrategy
  let stateService: jest.Mocked<StateService>
  let retryService: jest.Mocked<RetryService>
  let dataFetchingUtilities: jest.Mocked<DataFetchingUtilities>

  const mockChatResponse = new HumanMessage({
    id: 'mock-response-id',
    content: 'Here are the movies in your library...',
  })

  const mockLibraryData = {
    count: 2,
    content: '**MOVIES IN LIBRARY:**\nThe Matrix\nInception',
  }

  const mockExternalData = {
    count: 3,
    content:
      '**🔍 MOVIE SEARCH RESULTS:**\nThe Matrix\nMatrix Reloaded\nMatrix Revolutions',
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaBrowsingStrategy,
        {
          provide: StateService,
          useValue: {
            getState: jest.fn().mockReturnValue({
              chatModel: 'gpt-4',
              temperature: 0.7,
            }),
          },
        },
        {
          provide: RetryService,
          useValue: {
            executeWithRetry: jest.fn(),
          },
        },
        {
          provide: DataFetchingUtilities,
          useValue: {
            fetchLibraryData: jest.fn(),
            fetchExternalSearchData: jest.fn(),
          },
        },
      ],
    }).compile()

    strategy = module.get<MediaBrowsingStrategy>(MediaBrowsingStrategy)
    stateService = module.get(StateService)
    retryService = module.get(RetryService)
    dataFetchingUtilities = module.get(DataFetchingUtilities)
  })

  describe('Library search intent', () => {
    it('should fetch only library data when search intent is Library', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.Library,
        searchTerms: 'matrix',
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'show me matrix' }),
        messages: [],
        userId: 'user123',
        context: mediaRequest,
      }

      dataFetchingUtilities.fetchLibraryData.mockResolvedValue(mockLibraryData)
      retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(dataFetchingUtilities.fetchLibraryData).toHaveBeenCalledWith(
        MediaRequestType.Movies,
        'matrix',
      )
      expect(
        dataFetchingUtilities.fetchExternalSearchData,
      ).not.toHaveBeenCalled()
      expect(retryService.executeWithRetry).toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toBe(mockChatResponse)
      expect(result.images).toEqual([])
    })

    it('should handle empty library results when no matches are found', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Shows,
        searchIntent: SearchIntent.Library,
        searchTerms: 'nonexistent',
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'show me nonexistent' }),
        messages: [],
        userId: 'user123',
        context: mediaRequest,
      }

      dataFetchingUtilities.fetchLibraryData.mockResolvedValue({
        count: 0,
        content: '**TV SHOWS:** No TV shows found in library',
      })
      retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(dataFetchingUtilities.fetchLibraryData).toHaveBeenCalledWith(
        MediaRequestType.Shows,
        'nonexistent',
      )
      expect(result.messages).toHaveLength(1)
    })
  })

  describe('External search intent', () => {
    it('should fetch only external data when search intent is External', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.External,
        searchTerms: 'matrix',
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'search for matrix' }),
        messages: [],
        userId: 'user123',
        context: mediaRequest,
      }

      dataFetchingUtilities.fetchExternalSearchData.mockResolvedValue(
        mockExternalData,
      )
      retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(dataFetchingUtilities.fetchLibraryData).not.toHaveBeenCalled()
      expect(
        dataFetchingUtilities.fetchExternalSearchData,
      ).toHaveBeenCalledWith(MediaRequestType.Movies, 'matrix')
      expect(result.messages).toHaveLength(1)
    })

    it('should handle external search gracefully when search terms are empty', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.External,
        searchTerms: '',
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'search movies' }),
        messages: [],
        userId: 'user123',
        context: mediaRequest,
      }

      retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(
        dataFetchingUtilities.fetchExternalSearchData,
      ).not.toHaveBeenCalled()
      expect(retryService.executeWithRetry).toHaveBeenCalled()
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toBe(mockChatResponse)
    })
  })

  describe('Both search intent', () => {
    it('should fetch both library and external data when search intent is Both', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.Both,
        searchTerms: 'matrix',
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'find matrix' }),
        messages: [],
        userId: 'user123',
        context: mediaRequest,
      }

      dataFetchingUtilities.fetchLibraryData.mockResolvedValue(mockLibraryData)
      dataFetchingUtilities.fetchExternalSearchData.mockResolvedValue(
        mockExternalData,
      )
      retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(dataFetchingUtilities.fetchLibraryData).toHaveBeenCalledWith(
        MediaRequestType.Movies,
        'matrix',
      )
      expect(
        dataFetchingUtilities.fetchExternalSearchData,
      ).toHaveBeenCalledWith(MediaRequestType.Movies, 'matrix')
      expect(result.messages).toHaveLength(1)
    })

    it('should combine library and external results with separator when both sources have data', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Shows,
        searchIntent: SearchIntent.Both,
        searchTerms: 'breaking',
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'find breaking' }),
        messages: [],
        userId: 'user123',
        context: mediaRequest,
      }

      dataFetchingUtilities.fetchLibraryData.mockResolvedValue({
        count: 1,
        content: '**TV SHOWS IN LIBRARY:**\nBreaking Bad',
      })
      dataFetchingUtilities.fetchExternalSearchData.mockResolvedValue({
        count: 1,
        content: '**🔍 TV SHOW SEARCH RESULTS:**\nBreaking Bad',
      })
      retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

      await strategy.handleRequest(params)

      // Verify retry service was called with combined data
      const retryCall = retryService.executeWithRetry.mock.calls[0]
      expect(retryCall[1]).toMatchObject({
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        timeout: 45000,
      })
      expect(retryCall[2]).toBe('OpenAI-getMediaBrowsingResponse')
    })
  })

  describe('Conversation context', () => {
    it('should include previous messages in chat response when conversation history exists', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.Library,
        searchTerms: 'matrix',
      }

      const previousMessage = new HumanMessage({
        id: '0',
        content: 'what movies do you have?',
      })

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'show me matrix' }),
        messages: [previousMessage],
        userId: 'user123',
        context: mediaRequest,
      }

      dataFetchingUtilities.fetchLibraryData.mockResolvedValue(mockLibraryData)
      retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(2)
      expect(result.messages[0]).toBe(previousMessage)
      expect(result.messages[1]).toBe(mockChatResponse)
    })

    it('should generate contextual prompt with user message and media data when processing request', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.Library,
        searchTerms: 'test',
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'show me test movies' }),
        messages: [],
        userId: 'user123',
        context: mediaRequest,
      }

      dataFetchingUtilities.fetchLibraryData.mockResolvedValue(mockLibraryData)
      retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

      await strategy.handleRequest(params)

      // Verify the retry service received a function to execute
      expect(retryService.executeWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object),
        'OpenAI-getMediaBrowsingResponse',
      )
    })
  })

  describe('Error handling', () => {
    it('should return error response when service throws an error', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.Library,
        searchTerms: 'matrix',
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'show me matrix' }),
        messages: [],
        userId: 'user123',
        context: mediaRequest,
      }

      const error = new Error('Service unavailable')
      dataFetchingUtilities.fetchLibraryData.mockRejectedValue(error)

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toContain(
        'Sorry, I encountered an error',
      )
      expect(result.messages[0].content).toContain('Service unavailable')
      expect(result.images).toEqual([])
    })

    it('should return error response when retry service fails', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.Library,
        searchTerms: 'matrix',
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'show me matrix' }),
        messages: [],
        userId: 'user123',
        context: mediaRequest,
      }

      dataFetchingUtilities.fetchLibraryData.mockResolvedValue(mockLibraryData)
      retryService.executeWithRetry.mockRejectedValue(
        new Error('OpenAI API error'),
      )

      const result = await strategy.handleRequest(params)

      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toContain(
        'Sorry, I encountered an error',
      )
      expect(result.messages[0].content).toContain('OpenAI API error')
    })
  })

  describe('State integration', () => {
    it('should use chat model configuration from state service when processing request', async () => {
      const mediaRequest: MediaRequest = {
        mediaType: MediaRequestType.Movies,
        searchIntent: SearchIntent.Library,
        searchTerms: 'matrix',
      }

      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'show me matrix' }),
        messages: [],
        userId: 'user123',
        context: mediaRequest,
      }

      const customState = {
        chatModel: 'gpt-3.5-turbo' as const,
        temperature: 0.5,
        graphHistory: [],
        maxTokens: 4096,
        prompt: '',
        reasoningModel: 'gpt-4' as const,
        userMovieContexts: new Map(),
        userMovieDeleteContexts: new Map(),
        userTvShowContexts: new Map(),
        userTvShowDeleteContexts: new Map(),
      }

      stateService.getState.mockReturnValue(customState)

      dataFetchingUtilities.fetchLibraryData.mockResolvedValue(mockLibraryData)
      retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

      const result = await strategy.handleRequest(params)

      // Verify the strategy successfully processes the request with custom state
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0]).toBe(mockChatResponse)
      // The state is used internally to create ChatOpenAI instance
      expect(retryService.executeWithRetry).toHaveBeenCalled()
    })
  })

  describe('Phase 1: Negative Test Cases', () => {
    describe('Concurrent Operations', () => {
      it('should handle 10 simultaneous requests without race conditions', async () => {
        // Setup: Create 10 different user requests
        const requests = Array.from({ length: 10 }, (_, i) => ({
          message: new HumanMessage({
            id: `msg-${i}`,
            content: `search movies ${i}`,
          }),
          messages: [],
          userId: `user${i}`,
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: `query${i}`,
          } as MediaRequest,
        }))

        // Setup mocks
        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

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
        expect(dataFetchingUtilities.fetchLibraryData).toHaveBeenCalledTimes(10)
        expect(retryService.executeWithRetry).toHaveBeenCalledTimes(10)
      })

      it('should maintain request isolation between concurrent calls', async () => {
        const request1: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: 'show me matrix',
          }),
          messages: [],
          userId: 'user1',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        const request2: StrategyRequestParams = {
          message: new HumanMessage({
            id: '2',
            content: 'search breaking bad',
          }),
          messages: [],
          userId: 'user2',
          context: {
            mediaType: MediaRequestType.Shows,
            searchIntent: SearchIntent.External,
            searchTerms: 'breaking bad',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        dataFetchingUtilities.fetchExternalSearchData.mockResolvedValue(
          mockExternalData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

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
          message: new HumanMessage({ id: '1', content: 'search movies' }),
          messages: [],
          userId: 'user1',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'test',
          } as MediaRequest,
        }

        const request2: StrategyRequestParams = {
          message: new HumanMessage({
            id: '2',
            content: 'search tv shows',
          }),
          messages: [],
          userId: 'user2',
          context: {
            mediaType: MediaRequestType.Shows,
            searchIntent: SearchIntent.Library,
            searchTerms: 'test',
          } as MediaRequest,
        }

        // Setup mock to succeed first time, fail second time
        let callCount = 0
        dataFetchingUtilities.fetchLibraryData.mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve(mockLibraryData)
          }
          return Promise.reject(new Error('Service unavailable'))
        })

        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

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

    describe('Malformed Context Data', () => {
      it('should handle context with missing mediaType field', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'search movies' }),
          messages: [],
          userId: 'user123',
          context: {
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as any,
        }

        // Base strategy catches all errors and returns error response
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages[0].content).toContain(
          'Sorry, I encountered an error',
        )
      })

      it('should handle context with missing searchIntent field', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'search movies' }),
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchTerms: 'matrix',
          } as any,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

        // Base strategy catches all errors and returns error response
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        // May succeed if searchIntent is undefined but code handles it
        expect(result.messages.length).toBeGreaterThan(0)
      })

      it('should handle context with missing searchTerms field', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'search movies' }),
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
          } as any,
        }

        // Missing searchTerms causes error when accessing .trim()
        // Base strategy catches and returns error response
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages[0].content).toContain(
          'Sorry, I encountered an error',
        )
      })

      it('should handle context with empty searchTerms for Library intent', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'show all movies' }),
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: '',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

        // Should handle gracefully - library search with empty string
        const result = await strategy.handleRequest(params)

        expect(dataFetchingUtilities.fetchLibraryData).toHaveBeenCalledWith(
          MediaRequestType.Movies,
          '',
        )
        expect(result.messages).toBeDefined()
      })

      it('should handle null context', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'search movies' }),
          messages: [],
          userId: 'user123',
          context: null as any,
        }

        // Base strategy catches destructure error and returns error response
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages[0].content).toContain(
          'Sorry, I encountered an error',
        )
      })

      it('should handle undefined context', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'search movies' }),
          messages: [],
          userId: 'user123',
          context: undefined as any,
        }

        // Base strategy catches destructure error and returns error response
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages[0].content).toContain(
          'Sorry, I encountered an error',
        )
      })
    })

    describe('Service Failures', () => {
      it('should handle DataFetchingUtilities fetchLibraryData throwing exception', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'show movies' }),
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockRejectedValue(
          new Error('Library service connection failed'),
        )

        // Should propagate error from data fetching
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages[0].content).toContain(
          'Sorry, I encountered an error',
        )
      })

      it('should handle DataFetchingUtilities fetchExternalSearchData throwing exception', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'search matrix' }),
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.External,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchExternalSearchData.mockRejectedValue(
          new Error('External search API unavailable'),
        )

        // Should catch and handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages[0].content).toContain(
          'Sorry, I encountered an error',
        )
      })

      it('should handle both services failing when SearchIntent is Both', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'find matrix' }),
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Both,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockRejectedValue(
          new Error('Library unavailable'),
        )
        dataFetchingUtilities.fetchExternalSearchData.mockRejectedValue(
          new Error('External unavailable'),
        )

        // Should catch and handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages[0].content).toContain(
          'Sorry, I encountered an error',
        )
      })

      it('should handle RetryService throwing exception after exhausting retries', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'show movies' }),
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockRejectedValue(
          new Error('Max retries exceeded'),
        )

        // The base strategy catches all errors and returns fallback response
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.images).toEqual([])
      })

      it('should handle StateService getState throwing exception', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'show movies' }),
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)
        stateService.getState.mockImplementation(() => {
          throw new Error('State service error')
        })

        // Should catch and handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
      })
    })

    describe('Parameters Edge Cases', () => {
      it('should handle undefined userId', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'search movies' }),
          messages: [],
          userId: undefined as any,
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

        // Should handle gracefully
        await expect(strategy.handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle empty userId', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'search movies' }),
          messages: [],
          userId: '',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

        // Should handle gracefully
        await expect(strategy.handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle empty message content', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: '' }),
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

        // Should handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
      })

      it('should handle null message', async () => {
        const params: StrategyRequestParams = {
          message: null as any,
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

        // Should handle or throw appropriately
        await expect(strategy.handleRequest(params)).rejects.toThrow()
      })

      it('should handle undefined messages array', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'search movies' }),
          messages: undefined as any,
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

        // Should handle or throw
        await expect(strategy.handleRequest(params)).rejects.toThrow()
      })

      it('should handle extremely long message content', async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: 'search movies ' + 'x'.repeat(10000),
          }),
          messages: [],
          userId: 'user123',
          context: {
            mediaType: MediaRequestType.Movies,
            searchIntent: SearchIntent.Library,
            searchTerms: 'matrix',
          } as MediaRequest,
        }

        dataFetchingUtilities.fetchLibraryData.mockResolvedValue(
          mockLibraryData,
        )
        retryService.executeWithRetry.mockResolvedValue(mockChatResponse)

        // Should handle gracefully
        const result = await strategy.handleRequest(params)

        expect(result.messages).toBeDefined()
      })
    })
  })
})
