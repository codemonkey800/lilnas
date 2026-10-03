import { HumanMessage } from '@langchain/core/messages'

import { createMockDiscordIdentity } from 'src/media-operations/request-handling/__test-helpers__/mock-services'
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
    /** Media service name (e.g., 'RadarrService', 'SonarrService') */
    serviceName: string
    /** Media service search method name (e.g., 'searchMovies', 'searchShows') */
    searchMethodName: string
    /** Media service operation method name (e.g., 'requestMovie', 'unmonitorAndDeleteMovie') */
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
      return mock() as jest.Mock
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
  const { mediaItems, operationResult, chatResponse } = fixtures

  // Helper to check if parseInitialSelection is available
  const hasParseInitialSelection = (): boolean => {
    return !!parsingUtils.parseInitialSelection
  }

  // Mock state object factory - no longer needs context methods
  const createMockState = (overrides = {}): Record<string, jest.Mock> => ({
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
          discord: createMockDiscordIdentity(`user${i}`),
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
          discord: createMockDiscordIdentity('user1'),
          state: state1,
        }

        const request2: StrategyRequestParams = {
          message: new HumanMessage({
            id: '2',
            content: `download ${mediaType} B`,
          }),
          messages: [],
          userId: 'user2',
          discord: createMockDiscordIdentity('user2'),
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
        const [result1, result2] = await Promise.all([
          getStrategy().handleRequest(request1),
          getStrategy().handleRequest(request2),
        ])

        // Each request carries its own pending context; nothing is shared
        expect(result1.pendingContext).toBeDefined()
        expect(result2.pendingContext).toBeDefined()
        expect(result1.pendingContext).not.toBe(result2.pendingContext)
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
          discord: createMockDiscordIdentity('user1'),
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
          discord: createMockDiscordIdentity('user2'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity(''),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
        // The failed selection is dropped, not carried forward
        expect(result.pendingContext).toBeUndefined()
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
          discord: createMockDiscordIdentity('user123'),
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
    })

    describe('Context Lifecycle', () => {
      it('should leave nothing pending when operation succeeds from selection', async () => {
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
          discord: createMockDiscordIdentity('user123'),
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

        const result = await getStrategy().handleRequest(params)

        expect(result.pendingContext).toBeUndefined()
      })

      it('should leave nothing pending when auto-selection succeeds', async () => {
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
          discord: createMockDiscordIdentity('user123'),
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

        const result = await getStrategy().handleRequest(params)

        // Auto-selection settles the request, so nothing is left pending
        expect(result.pendingContext).toBeUndefined()
      })

      it('should leave nothing pending on error during selection handling', async () => {
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
          discord: createMockDiscordIdentity('user123'),
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
        expect(result.pendingContext).toBeUndefined()
      })
    })
  })
}
