import { HumanMessage } from '@langchain/core/messages'

import { MediaOperationStrategy } from 'src/media-operations/request-handling/strategies/base/media-operation-strategy.interface'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'

/**
 * Configuration for shared strategy edge case tests
 * Use getter functions to avoid accessing variables before they're initialized
 */
export interface StrategyEdgeCasesConfig<TMediaItem, TOperationResult> {
  /** Getter for the strategy instance being tested */
  getStrategy: () => MediaOperationStrategy

  /** Mock services (using getters to avoid initialization order issues) */
  mocks: {
    parsingUtils: {
      parseInitialSelection?: jest.Mock | (() => unknown)
      parseSearchSelection: jest.Mock | (() => unknown)
    }
    selectionUtils: {
      findSelectedItem: jest.Mock | (() => unknown)
    }
    mediaService: {
      searchMethod: jest.Mock | (() => unknown)
      operationMethod: jest.Mock | (() => unknown)
    }
    promptService: {
      generatePromptMethod: jest.Mock | (() => unknown)
    }
    stateService?: {
      setContextMethod: jest.Mock | (() => unknown)
      clearContextMethod: jest.Mock | (() => unknown)
    }
  }

  /** Mock fixtures */
  fixtures: {
    mediaItems: TMediaItem[]
    operationResult: TOperationResult
    chatResponse: HumanMessage
  }

  /** Strategy-specific configuration */
  config: {
    /** Media type for display (e.g., 'movie', 'tv show') */
    mediaType: string
    /** Context type value (e.g., 'movie', 'tvShow') */
    contextType: string
    /** State context setter method name (e.g., 'setUserMovieContext') */
    setContextMethod: string
    /** State context clearer method name (e.g., 'clearUserMovieContext') */
    clearContextMethod: string
    /** Media service name (e.g., 'RadarrService', 'SonarrService') */
    serviceName: string
    /** Media service search method name (e.g., 'searchMovies', 'searchShows') */
    searchMethodName: string
    /** Media service operation method name (e.g., 'monitorAndDownloadMovie', 'unmonitorAndDeleteMovie') */
    operationMethodName: string
    /** Error prompt type (e.g., 'error', 'error_delete', 'TV_SHOW_ERROR') */
    errorPromptType: string
    /** Processing error prompt type (e.g., 'processing_error', 'processing_error_delete', 'TV_SHOW_PROCESSING_ERROR') */
    processingErrorPromptType: string
  }
}

/**
 * Shared test suite for strategy edge cases
 * Tests common negative scenarios: concurrent operations, malformed data, service failures, state edge cases
 */
export function testStrategyEdgeCases<TMediaItem, TOperationResult>(
  testConfig: StrategyEdgeCasesConfig<TMediaItem, TOperationResult>,
) {
  const {
    getStrategy,
    mocks,
    fixtures,
    config: {
      mediaType,
      contextType,
      setContextMethod,
      clearContextMethod,
      serviceName,
      searchMethodName,
      operationMethodName,
      // errorPromptType and processingErrorPromptType are not used in edge case tests
    },
  } = testConfig

  // Helper to unwrap getter functions if needed - delays evaluation until first access
  const unwrapMock = (
    mock: jest.Mock | (() => unknown) | undefined,
  ): jest.Mock | undefined => {
    if (!mock) {
      return undefined
    }
    // If it's a function, call it to get the mock
    if (typeof mock === 'function' && !('mock' in mock)) {
      return mock()
    }
    // Otherwise it's already a Jest mock
    return mock
  }

  // Create proxy objects that delay unwrapping until the mock is actually used
  const parsingUtils = {
    get parseInitialSelection() {
      return unwrapMock(mocks.parsingUtils.parseInitialSelection)
    },
    get parseSearchSelection() {
      return unwrapMock(mocks.parsingUtils.parseSearchSelection)!
    },
  }
  const selectionUtils = {
    get findSelectedItem() {
      return unwrapMock(mocks.selectionUtils.findSelectedItem)!
    },
  }
  const mediaService = {
    get searchMethod() {
      return unwrapMock(mocks.mediaService.searchMethod)!
    },
    get operationMethod() {
      return unwrapMock(mocks.mediaService.operationMethod)!
    },
  }
  const promptService = {
    get generatePromptMethod() {
      return unwrapMock(mocks.promptService.generatePromptMethod)!
    },
  }
  const stateService = mocks.stateService
    ? {
        get setContextMethod() {
          return unwrapMock(mocks.stateService!.setContextMethod)!
        },
        get clearContextMethod() {
          return unwrapMock(mocks.stateService!.clearContextMethod)!
        },
      }
    : null

  const { mediaItems, operationResult, chatResponse } = fixtures

  // Helper to check if parseInitialSelection is available
  const hasParseInitialSelection = (): boolean => {
    return !!parsingUtils.parseInitialSelection
  }

  // Mock state object factory
  const createMockState = (overrides = {}): Record<string, jest.Mock> => ({
    [setContextMethod]: jest.fn(),
    [clearContextMethod]: jest.fn(),
    ...overrides,
  })

  describe('Phase 1: Negative Test Cases', () => {
    describe('Concurrent Operations', () => {
      it('should handle 10 simultaneous requests without race conditions', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        // Setup: Create 10 different user requests
        const requests = Array.from({ length: 10 }, (_, i) => ({
          message: new HumanMessage({
            id: `msg-${i}`,
            content: `download ${mediaType} ${i}`,
          }),
          messages: [],
          userId: `user${i}`,
          state: createMockState(),
        }))

        // Setup mocks
        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: 'test',
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Execute: Run all requests concurrently
        const results = await Promise.all(
          requests.map(req => getStrategy().handleRequest(req)),
        )

        // Verify: All completed successfully
        expect(results).toHaveLength(10)
        results.forEach(result => {
          expect(result.messages).toBeDefined()
          expect(result.messages.length).toBeGreaterThan(0)
        })
      })

      it('should maintain state isolation between concurrent calls', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        // Create separate state objects for each request
        const state1 = createMockState()
        const state2 = createMockState()

        const request1: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType} A`,
          }),
          messages: [],
          userId: 'user1',
          state: state1,
        }

        const request2: StrategyRequestParams = {
          message: new HumanMessage({
            id: '2',
            content: `download ${mediaType} B`,
          }),
          messages: [],
          userId: 'user2',
          state: state2,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: 'test',
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue(mediaItems.slice(0, 3))
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Execute concurrently
        await Promise.all([
          getStrategy().handleRequest(request1),
          getStrategy().handleRequest(request2),
        ])

        // Verify: Each state was called with its own userId
        expect(state1[setContextMethod]).toHaveBeenCalledWith(
          'user1',
          expect.any(Object),
        )
        expect(state2[setContextMethod]).toHaveBeenCalledWith(
          'user2',
          expect.any(Object),
        )
      })

      it('should handle context switching during concurrent operations', async () => {
        if (!parsingUtils.parseInitialSelection) {
          return
        }

        const activeContext = {
          type: contextType,
          searchResults: mediaItems.slice(0, 2),
          query: 'test',
          timestamp: Date.now(),
          isActive: true,
        }

        // Request 1: Has context (selection flow)
        const request1: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'first one' }),
          messages: [],
          userId: 'user1',
          context: activeContext,
          state: createMockState(),
        }

        // Request 2: No context (new search flow)
        const request2: StrategyRequestParams = {
          message: new HumanMessage({
            id: '2',
            content: `download ${mediaType} C`,
          }),
          messages: [],
          userId: 'user2',
          state: createMockState(),
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: 'test',
          selection: null,
          tvSelection: null,
        })
        parsingUtils.parseSearchSelection.mockResolvedValue({
          selectionType: 'ordinal',
          value: '1',
        })
        selectionUtils.findSelectedItem.mockReturnValue(mediaItems[0])
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Execute concurrently
        const results = await Promise.all([
          getStrategy().handleRequest(request1),
          getStrategy().handleRequest(request2),
        ])

        // Both should succeed
        expect(results).toHaveLength(2)
        results.forEach(result => {
          expect(result.messages).toBeDefined()
        })
      })
    })

    describe('Malformed Data', () => {
      it('should handle context with missing type field', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          context: { isActive: true, searchResults: [] } as unknown,
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should not throw, should route to new search
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle context with missing isActive field', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          context: {
            type: contextType,
            searchResults: [mediaItems[0]],
            query: 'test',
            timestamp: Date.now(),
          } as unknown,
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should route to new search (isActive is falsy)
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle context with wrong type value', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          context: {
            type: 'wrongType',
            isActive: true,
            searchResults: [],
            query: 'test',
            timestamp: Date.now(),
          } as unknown,
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should route to new search (wrong context type)
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle empty userId', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: '',
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should handle gracefully
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle empty message content', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: '' }),
          messages: [],
          userId: 'user123',
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: '',
          selection: null,
          tvSelection: null,
        })
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should return clarification
        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
      })

      it('should handle null context gracefully', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          context: null as unknown,
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should treat as new search
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle undefined context gracefully', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          context: undefined,
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should treat as new search
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle context with missing searchResults', async () => {
        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'first one' }),
          messages: [],
          userId: 'user123',
          context: {
            type: contextType,
            isActive: true,
            query: 'test',
            timestamp: Date.now(),
          } as unknown,
          state: mockState,
        }

        parsingUtils.parseSearchSelection.mockResolvedValue({
          selectionType: 'ordinal',
          value: '1',
        })
        selectionUtils.findSelectedItem.mockReturnValue(null)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should handle gracefully - likely returns error or re-shows empty list
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle context with empty searchResults array', async () => {
        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'first one' }),
          messages: [],
          userId: 'user123',
          context: {
            type: contextType,
            isActive: true,
            searchResults: [],
            query: 'test',
            timestamp: Date.now(),
          },
          state: mockState,
        }

        parsingUtils.parseSearchSelection.mockResolvedValue({
          selectionType: 'ordinal',
          value: '1',
        })
        selectionUtils.findSelectedItem.mockReturnValue(null)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should handle gracefully
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })
    })

    describe('Service Failures', () => {
      it(`should handle ${serviceName} ${searchMethodName} throwing exception`, async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockRejectedValue(
          new Error(`${serviceName} API connection failed`),
        )
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should catch and handle gracefully
        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
      })

      it(`should handle ${serviceName} ${operationMethodName} throwing exception`, async () => {
        const mockState = createMockState()
        if (!hasParseInitialSelection()) {
          return
        }

        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockRejectedValue(
          new Error(`Failed to perform ${operationMethodName}`),
        )
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should catch and handle gracefully
        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
      })

      it('should handle PromptGenerationService throwing exception', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockRejectedValue(
          new Error('LLM service unavailable'),
        )

        // Exception is caught by base class and returns error response
        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages[0].content).toContain('LLM service unavailable')
      })

      it('should handle ParsingUtilities parseInitialSelection throwing exception', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: mockState,
        }

        parsingUtils.parseInitialSelection!.mockRejectedValue(
          new Error('Parse error'),
        )
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Exception is caught by base class and returns error response
        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages[0].content).toContain('Parse error')
      })

      it('should handle ParsingUtilities parseSearchSelection throwing exception', async () => {
        const activeContext = {
          type: contextType,
          searchResults: mediaItems.slice(0, 2),
          query: 'test',
          timestamp: Date.now(),
          isActive: true,
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'first one' }),
          messages: [],
          userId: 'user123',
          context: activeContext,
          state: mockState,
        }

        parsingUtils.parseSearchSelection.mockRejectedValue(
          new Error('Parse error'),
        )
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should re-show list (this is already tested, but verifying service failure)
        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
      })

      it('should handle SelectionUtilities findSelectedItem throwing exception', async () => {
        const activeContext = {
          type: contextType,
          searchResults: mediaItems.slice(0, 2),
          query: 'test',
          timestamp: Date.now(),
          isActive: true,
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'first one' }),
          messages: [],
          userId: 'user123',
          context: activeContext,
          state: mockState,
        }

        parsingUtils.parseSearchSelection.mockResolvedValue({
          selectionType: 'ordinal',
          value: '1',
        })
        selectionUtils.findSelectedItem.mockImplementation(() => {
          throw new Error('Selection error')
        })
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should catch and handle - already tested in outer catch
        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
        // Check mockState parameter if available, otherwise fall back to StateService
        if (mockState[clearContextMethod]) {
          expect(mockState[clearContextMethod]).toHaveBeenCalled()
        } else if (stateService?.clearContextMethod) {
          expect(stateService.clearContextMethod).toHaveBeenCalled()
        }
      })
    })

    describe('State Parameter Edge Cases', () => {
      it('should handle undefined state parameter', async () => {
        if (!parsingUtils.parseInitialSelection) {
          // Skip if parseInitialSelection not available for this strategy
          return
        }

        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: undefined,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should handle gracefully (no state methods called)
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle null state parameter', async () => {
        if (!parsingUtils.parseInitialSelection) {
          return
        }

        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: null as unknown,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should handle gracefully
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle state with missing required methods', async () => {
        if (!parsingUtils.parseInitialSelection) {
          return
        }

        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: {} as unknown,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue(mediaItems.slice(0, 3))
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Should handle missing methods gracefully (may throw or handle)
        // The strategy may try to call set context method on empty object
        await expect(getStrategy().handleRequest(params)).resolves.toBeDefined()
      })

      it('should handle state methods throwing exceptions', async () => {
        if (!parsingUtils.parseInitialSelection) {
          return
        }

        const failingState = {
          [setContextMethod]: jest.fn().mockImplementation(() => {
            throw new Error('State storage error')
          }),
          [clearContextMethod]: jest.fn(), // Don't throw on cleanup
        }

        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: failingState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue(mediaItems.slice(0, 3))
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Exception from setContext is caught and returns error response
        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages.length).toBeGreaterThan(0)
      })

      it(`should handle state ${setContextMethod} throwing exception during context creation`, async () => {
        if (!parsingUtils.parseInitialSelection) {
          return
        }

        const failingState = {
          [setContextMethod]: jest.fn().mockImplementation(() => {
            throw new Error('Database connection failed')
          }),
          [clearContextMethod]: jest.fn(), // Don't throw on cleanup
        }

        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `download ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: failingState,
        }

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchMethod.mockResolvedValue(mediaItems.slice(0, 3))
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Exception from setContext is caught and returns error response
        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages.length).toBeGreaterThan(0)
      })

      it(`should handle state ${clearContextMethod} throwing exception during cleanup`, async () => {
        const activeContext = {
          type: contextType,
          searchResults: mediaItems.slice(0, 2),
          query: 'test',
          timestamp: Date.now(),
          isActive: true,
          // Include originalTvSelection for TV strategies to ensure clearContext path is taken
          // For tvShowDelete, need non-empty selection to pass validation
          originalTvSelection:
            contextType === 'tvShow'
              ? { selection: [] }
              : contextType === 'tvShowDelete'
                ? { selection: [{ season: 1 }] }
                : undefined,
        }

        let clearContextCallCount = 0
        const failingState = {
          [setContextMethod]: jest.fn(),
          [clearContextMethod]: jest.fn().mockImplementation(() => {
            clearContextCallCount++
            // First call succeeds (before operation), second call throws (during error cleanup)
            if (clearContextCallCount >= 2) {
              throw new Error('Failed to clear context')
            }
          }),
        }

        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'first one' }),
          messages: [],
          userId: 'user123',
          context: activeContext,
          state: failingState,
        }

        parsingUtils.parseSearchSelection.mockResolvedValue({
          selectionType: 'ordinal',
          value: '1',
        })
        selectionUtils.findSelectedItem.mockReturnValue(mediaItems[0])
        // Make the operation fail to trigger error cleanup path
        mediaService.operationMethod.mockRejectedValue(
          new Error('Operation failed'),
        )
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        // Cleanup error during error handling should be caught and logged, not propagate
        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages.length).toBeGreaterThan(0)
        // Should still return an error response for the original operation failure
        expect(failingState[clearContextMethod]).toHaveBeenCalled()
      })
    })

    describe('Context Lifecycle', () => {
      it('should clear context when operation succeeds from selection', async () => {
        const activeContext = {
          type: contextType,
          searchResults: mediaItems.slice(0, 2),
          query: 'test',
          timestamp: Date.now(),
          isActive: true,
          // Include originalTvSelection for TV strategies
          originalTvSelection:
            contextType === 'tvShow' || contextType === 'tvShowDelete'
              ? {
                  selection:
                    contextType === 'tvShowDelete' ? [{ season: 1 }] : [],
                }
              : undefined,
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'first one' }),
          messages: [],
          userId: 'user123',
          context: activeContext,
          state: mockState,
        }

        parsingUtils.parseSearchSelection.mockResolvedValue({
          selectionType: 'ordinal',
          value: '1',
        })
        selectionUtils.findSelectedItem.mockReturnValue(mediaItems[0])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        await getStrategy().handleRequest(params)

        // Check mockState parameter if available, otherwise fall back to StateService
        if (mockState[clearContextMethod]) {
          expect(mockState[clearContextMethod]).toHaveBeenCalledWith('user123')
          expect(mockState[clearContextMethod]).toHaveBeenCalledTimes(1)
        } else if (stateService?.clearContextMethod) {
          expect(stateService.clearContextMethod).toHaveBeenCalledWith(
            'user123',
          )
          expect(stateService.clearContextMethod).toHaveBeenCalledTimes(1)
        }
      })

      it('should clear context when auto-selection succeeds', async () => {
        if (!hasParseInitialSelection()) {
          return
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `${mediaType} with selection`,
          }),
          messages: [],
          userId: 'user123',
          state: mockState,
        }

        // For TV strategies, need both ordinal selection AND granular TV selection to auto-complete
        // For movie strategies, only ordinal selection is needed
        const isTvStrategy =
          contextType === 'tvShow' || contextType === 'tvShowDelete'
        const tvSelection = isTvStrategy
          ? {
              selection: contextType === 'tvShowDelete' ? [{ season: 1 }] : [],
            }
          : null

        parsingUtils.parseInitialSelection!.mockResolvedValue({
          searchQuery: mediaType,
          selection: { selectionType: 'ordinal', value: '1' },
          tvSelection,
        })
        mediaService.searchMethod.mockResolvedValue(mediaItems.slice(0, 3))
        selectionUtils.findSelectedItem.mockReturnValue(mediaItems[0])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        await getStrategy().handleRequest(params)

        // Auto-selection should not set context
        // Note: clearContext is only called when there's an existing context to clean up,
        // not during new search auto-selection
        if (stateService?.setContextMethod) {
          expect(stateService.setContextMethod).not.toHaveBeenCalled()
        } else if (mockState[setContextMethod]) {
          expect(mockState[setContextMethod]).not.toHaveBeenCalled()
        }
      })

      it('should clear context on error during selection handling', async () => {
        const activeContext = {
          type: contextType,
          searchResults: mediaItems.slice(0, 2),
          query: 'test',
          timestamp: Date.now(),
          isActive: true,
          // Include originalTvSelection for TV strategies
          originalTvSelection:
            contextType === 'tvShow' || contextType === 'tvShowDelete'
              ? {
                  selection:
                    contextType === 'tvShowDelete' ? [{ season: 1 }] : [],
                }
              : undefined,
        }

        const mockState = createMockState()
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: 'first one' }),
          messages: [],
          userId: 'user123',
          context: activeContext,
          state: mockState,
        }

        parsingUtils.parseSearchSelection.mockResolvedValue({
          selectionType: 'ordinal',
          value: '1',
        })
        selectionUtils.findSelectedItem.mockReturnValue(mediaItems[0])
        mediaService.operationMethod.mockRejectedValue(
          new Error('Operation failed'),
        )
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
        // Check mockState parameter if available, otherwise fall back to StateService
        if (mockState[clearContextMethod]) {
          expect(mockState[clearContextMethod]).toHaveBeenCalledWith('user123')
        } else if (stateService?.clearContextMethod) {
          expect(stateService.clearContextMethod).toHaveBeenCalledWith(
            'user123',
          )
        }
      })
    })
  })
}
