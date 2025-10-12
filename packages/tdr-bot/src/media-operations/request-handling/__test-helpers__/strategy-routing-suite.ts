import { HumanMessage } from '@langchain/core/messages'

import { MediaOperationStrategy } from 'src/media-operations/request-handling/strategies/base/media-operation-strategy.interface'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'

/**
 * Configuration for shared strategy routing tests
 * Use getter functions to avoid accessing variables before they're initialized
 */
export interface StrategyRoutingConfig<TMediaItem, TOperationResult> {
  /** Getter for the strategy instance being tested */
  getStrategy: () => MediaOperationStrategy

  /** Mock services (using getters to avoid initialization order issues) */
  mocks: {
    parsingUtils: {
      parseInitialSelection:
        | jest.MockedFunction<any>
        | { (): jest.MockedFunction<any> }
      parseSearchSelection:
        | jest.MockedFunction<any>
        | { (): jest.MockedFunction<any> }
      parseTvShowSelection?:
        | jest.MockedFunction<any>
        | { (): jest.MockedFunction<any> }
    }
    selectionUtils: {
      findSelectedItem:
        | jest.MockedFunction<any>
        | { (): jest.MockedFunction<any> }
    }
    mediaService: {
      searchOrLibraryMethod:
        | jest.MockedFunction<any>
        | { (): jest.MockedFunction<any> }
      operationMethod:
        | jest.MockedFunction<any>
        | { (): jest.MockedFunction<any> }
    }
    promptService: {
      generatePromptMethod:
        | jest.MockedFunction<any>
        | { (): jest.MockedFunction<any> }
    }
  }

  /** Test fixtures */
  fixtures: {
    validContext: any // Active context matching the strategy type
    mediaItems: TMediaItem[]
    operationResult: TOperationResult
    chatResponse: HumanMessage
  }

  /** Strategy-specific configuration */
  config: {
    /** Media type for display (e.g., 'movie', 'tv show') */
    mediaType: string
    /** Context type value (e.g., 'movie', 'movieDelete', 'tvShow', 'tvShowDelete') */
    contextType: string
    /** Wrong context type for negative testing (e.g., 'tv_show', 'movie') */
    wrongContextType: string
    /** Inactive context type (usually same as contextType) */
    inactiveContextType: string
    /** Example user message for routing tests */
    exampleMessage: string
  }

  /** Mock state with context methods */
  mockState: Record<string, jest.Mock>
}

/**
 * Shared test suite for strategy routing logic
 * Tests how strategies route requests based on context state: no context, wrong type, inactive, active
 *
 * @example
 * testStrategyRouting({
 *   getStrategy: () => strategy,
 *   mocks: {
 *     parsingUtils: {
 *       parseInitialSelection: () => parsingUtilities.parseInitialSelection,
 *       parseSearchSelection: () => parsingUtilities.parseSearchSelection,
 *     },
 *     selectionUtils: {
 *       findSelectedItem: () => selectionUtilities.findSelectedMovie,
 *     },
 *     mediaService: {
 *       searchOrLibraryMethod: () => radarrService.searchMovies,
 *       operationMethod: () => radarrService.monitorAndDownloadMovie,
 *     },
 *     promptService: {
 *       generatePromptMethod: () => promptService.generateMoviePrompt,
 *     },
 *   },
 *   fixtures: {
 *     validContext: movieContext,
 *     mediaItems: [mockMovie1, mockMovie2],
 *     operationResult: mockSuccessResult,
 *     chatResponse: mockChatResponse,
 *   },
 *   config: {
 *     mediaType: 'movie',
 *     contextType: 'movie',
 *     wrongContextType: 'tv_show',
 *     inactiveContextType: 'movie',
 *     exampleMessage: 'download matrix',
 *   },
 *   mockState,
 * })
 */
export function testStrategyRouting<TMediaItem, TOperationResult>(
  testConfig: StrategyRoutingConfig<TMediaItem, TOperationResult>,
) {
  const {
    getStrategy,
    mocks,
    fixtures,
    config: {
      mediaType,
      contextType,
      wrongContextType,
      inactiveContextType,
      exampleMessage,
    },
    mockState,
  } = testConfig

  // Helper to unwrap getter functions if needed - delays evaluation until first access
  const unwrapMock = <T>(mock: T | { (): T } | undefined): T | undefined => {
    if (!mock) {
      return undefined
    }
    // Check if it's a Jest mock first (has mock property)
    if (mock && typeof mock === 'object' && 'mock' in mock) {
      return mock as T
    }
    // Otherwise, if it's a function, call it to get the mock
    return typeof mock === 'function' ? (mock as { (): T })() : mock
  }

  // Create proxy objects that delay unwrapping until the mock is actually used
  const parsingUtils = {
    get parseInitialSelection() {
      return unwrapMock(mocks.parsingUtils.parseInitialSelection)
    },
    get parseSearchSelection() {
      return unwrapMock(mocks.parsingUtils.parseSearchSelection)
    },
    get parseTvShowSelection() {
      return unwrapMock(mocks.parsingUtils.parseTvShowSelection)
    },
  }
  const selectionUtils = {
    get findSelectedItem() {
      return unwrapMock(mocks.selectionUtils.findSelectedItem)
    },
  }
  const mediaService = {
    get searchOrLibraryMethod() {
      return unwrapMock(mocks.mediaService.searchOrLibraryMethod)
    },
    get operationMethod() {
      return unwrapMock(mocks.mediaService.operationMethod)
    },
  }
  const promptService = {
    get generatePromptMethod() {
      return unwrapMock(mocks.promptService.generatePromptMethod)
    },
  }

  const { validContext, mediaItems, operationResult, chatResponse } = fixtures

  describe('Request Routing', () => {
    it.each([
      {
        scenario: 'no context',
        context: undefined,
      },
      {
        scenario: 'wrong type',
        context: { type: wrongContextType, isActive: true },
      },
      {
        scenario: 'inactive context',
        context: {
          type: inactiveContextType,
          isActive: false,
          searchResults: [mediaItems[0]],
          query: 'test',
          timestamp: Date.now(),
        },
      },
    ])(
      `should route to new ${mediaType} operation when $scenario`,
      async ({ context }) => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({ id: '1', content: exampleMessage }),
          messages: [],
          userId: 'user123',
          context,
          state: mockState,
        }

        parsingUtils.parseInitialSelection.mockResolvedValue({
          searchQuery: mediaType,
          selection: null,
          tvSelection: null,
        })
        mediaService.searchOrLibraryMethod.mockResolvedValue([mediaItems[0]])
        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        const result = await getStrategy().handleRequest(params)

        expect(result.messages).toBeDefined()
        expect(result.messages.length).toBeGreaterThan(0)
      },
    )

    it(`should route to selection handling when context type is ${contextType} and isActive`, async () => {
      const params: StrategyRequestParams = {
        message: new HumanMessage({ id: '1', content: 'first one' }),
        messages: [],
        userId: 'user123',
        context: validContext,
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

      expect(parsingUtils.parseInitialSelection).not.toHaveBeenCalled()
      expect(result.messages).toBeDefined()
    })
  })
}
