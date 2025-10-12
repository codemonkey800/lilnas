import { HumanMessage } from '@langchain/core/messages'

import { MediaOperationStrategy } from 'src/media-operations/request-handling/strategies/base/media-operation-strategy.interface'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'

/**
 * Configuration for shared selection behavior tests
 * Use getter functions to avoid accessing variables before they're initialized
 */
export interface SelectionBehaviorConfig<TMediaItem, TOperationResult> {
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
    stateService?: {
      setContextMethod:
        | jest.MockedFunction<any>
        | { (): jest.MockedFunction<any> }
      clearContextMethod:
        | jest.MockedFunction<any>
        | { (): jest.MockedFunction<any> }
    }
  }

  /** Test fixtures */
  fixtures: {
    mediaItems: TMediaItem[]
    operationResult: TOperationResult
    chatResponse: HumanMessage
    tvSelection?: any // For TV strategies
  }

  /** Strategy-specific configuration */
  config: {
    /** Media type for display (e.g., 'movie', 'tv show') */
    mediaType: string
    /** Context type value (e.g., 'movie', 'movieDelete', 'tvShow', 'tvShowDelete') */
    contextType: string
    /** State context setter method name (e.g., 'setUserMovieContext') */
    setContextMethod: string
    /** Whether this strategy supports ordinal selection */
    supportsOrdinalSelection: boolean
    /** Whether this strategy supports year selection */
    supportsYearSelection: boolean
    /** Whether this strategy is a TV strategy with TV-specific selection */
    supportsTvSelection: boolean
    /** Operation type: 'download' or 'delete' */
    operationType: 'download' | 'delete'
  }

  /** Mock state with context methods */
  mockState: Record<string, jest.Mock>
}

/**
 * Shared test suite for auto-selection behavior
 * Tests ordinal selection, year selection, and fallback behaviors
 *
 * @example
 * testSelectionBehavior({
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
 *     mediaItems: [mockMovie1, mockMovie2, mockMovie3],
 *     operationResult: mockSuccessResult,
 *     chatResponse: mockChatResponse,
 *   },
 *   config: {
 *     mediaType: 'movie',
 *     contextType: 'movie',
 *     setContextMethod: 'setUserMovieContext',
 *     supportsOrdinalSelection: true,
 *     supportsYearSelection: true,
 *     supportsTvSelection: false,
 *     operationType: 'download',
 *   },
 *   mockState,
 * })
 */
export function testSelectionBehavior<TMediaItem, TOperationResult>(
  testConfig: SelectionBehaviorConfig<TMediaItem, TOperationResult>,
) {
  const {
    getStrategy,
    mocks,
    fixtures,
    config: {
      mediaType,
      contextType,
      setContextMethod,
      supportsOrdinalSelection,
      supportsYearSelection,
      supportsTvSelection,
      operationType,
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
  const stateService = mocks.stateService
    ? {
        get setContextMethod() {
          return unwrapMock(mocks.stateService!.setContextMethod)
        },
        get clearContextMethod() {
          return unwrapMock(mocks.stateService!.clearContextMethod)
        },
      }
    : null

  const { mediaItems, operationResult, chatResponse, tvSelection } = fixtures

  // Ordinal Selection Tests
  if (supportsOrdinalSelection) {
    describe(`New ${mediaType} ${operationType} - Auto-Selection with Ordinal`, () => {
      it(`should auto-select and ${operationType} ${mediaType} when valid ordinal is provided in ${operationType} query`, async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `${operationType} the second ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: mockState,
        }

        parsingUtils.parseInitialSelection.mockResolvedValue({
          searchQuery: mediaType,
          selection: { selectionType: 'ordinal', value: '2' },
          tvSelection: supportsTvSelection ? tvSelection : null,
        })
        mediaService.searchOrLibraryMethod.mockResolvedValue(
          mediaItems.slice(0, 3),
        )
        selectionUtils.findSelectedItem.mockReturnValue(mediaItems[1])

        // TV strategies need parseTvShowSelection
        if (supportsTvSelection && parsingUtils.parseTvShowSelection) {
          parsingUtils.parseTvShowSelection.mockResolvedValue(tvSelection)
        }

        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        const result = await getStrategy().handleRequest(params)

        // Check mockState when provided in params, otherwise fall back to StateService
        if (mockState[setContextMethod]) {
          expect(mockState[setContextMethod]).not.toHaveBeenCalled()
        } else if (stateService?.setContextMethod) {
          expect(stateService.setContextMethod).not.toHaveBeenCalled()
        }
        expect(result.messages).toHaveLength(1)
      })

      it(`should fall back to showing list when ordinal is out of range`, async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `${operationType} the 99th ${mediaType}`,
          }),
          messages: [],
          userId: 'user123',
          state: mockState,
        }

        parsingUtils.parseInitialSelection.mockResolvedValue({
          searchQuery: mediaType,
          selection: { selectionType: 'ordinal', value: '99' },
          tvSelection: supportsTvSelection ? tvSelection : null,
        })
        mediaService.searchOrLibraryMethod.mockResolvedValue(
          mediaItems.slice(0, 3),
        )
        selectionUtils.findSelectedItem.mockReturnValue(null)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        const result = await getStrategy().handleRequest(params)

        // Check mockState when provided in params, otherwise fall back to StateService
        if (mockState[setContextMethod]) {
          expect(mockState[setContextMethod]).toHaveBeenCalledWith('user123', {
            type: contextType,
            searchResults: mediaItems.slice(0, 3),
            query: mediaType,
            timestamp: expect.any(Number),
            isActive: true,
          })
        } else if (stateService?.setContextMethod) {
          expect(stateService.setContextMethod).toHaveBeenCalledWith(
            'user123',
            {
              type: contextType,
              searchResults: mediaItems.slice(0, 3),
              query: mediaType,
              timestamp: expect.any(Number),
              isActive: true,
            },
          )
        }
        expect(mediaService.operationMethod).not.toHaveBeenCalled()
        expect(result.messages).toHaveLength(1)
      })
    })
  }

  // Year Selection Tests
  if (supportsYearSelection) {
    describe(`New ${mediaType} ${operationType} - Auto-Selection with Year`, () => {
      it(`should auto-select and ${operationType} ${mediaType} by year when year is provided in ${operationType} query`, async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `${operationType} ${mediaType} from 1999`,
          }),
          messages: [],
          userId: 'user123',
          state: mockState,
        }

        parsingUtils.parseInitialSelection.mockResolvedValue({
          searchQuery: mediaType,
          selection: { selectionType: 'year', value: '1999' },
          tvSelection: supportsTvSelection ? tvSelection : null,
        })
        mediaService.searchOrLibraryMethod.mockResolvedValue(
          mediaItems.slice(0, 3),
        )
        selectionUtils.findSelectedItem.mockReturnValue(mediaItems[0])

        // TV strategies need parseTvShowSelection
        if (supportsTvSelection && parsingUtils.parseTvShowSelection) {
          parsingUtils.parseTvShowSelection.mockResolvedValue(tvSelection)
        }

        mediaService.operationMethod.mockResolvedValue(operationResult)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        const result = await getStrategy().handleRequest(params)

        // Check mockState when provided in params, otherwise fall back to StateService
        if (mockState[setContextMethod]) {
          expect(mockState[setContextMethod]).not.toHaveBeenCalled()
        } else if (stateService?.setContextMethod) {
          expect(stateService.setContextMethod).not.toHaveBeenCalled()
        }
        expect(result.messages).toHaveLength(1)
      })

      it(`should fall back to showing list when year is not found in ${operationType} results`, async () => {
        const params: StrategyRequestParams = {
          message: new HumanMessage({
            id: '1',
            content: `${operationType} ${mediaType} from 2020`,
          }),
          messages: [],
          userId: 'user123',
          state: mockState,
        }

        parsingUtils.parseInitialSelection.mockResolvedValue({
          searchQuery: mediaType,
          selection: { selectionType: 'year', value: '2020' },
          tvSelection: supportsTvSelection ? tvSelection : null,
        })
        mediaService.searchOrLibraryMethod.mockResolvedValue(
          mediaItems.slice(0, 3),
        )
        selectionUtils.findSelectedItem.mockReturnValue(null)
        promptService.generatePromptMethod.mockResolvedValue(chatResponse)

        const result = await getStrategy().handleRequest(params)

        // Check mockState when provided in params, otherwise fall back to StateService
        if (mockState[setContextMethod]) {
          expect(mockState[setContextMethod]).toHaveBeenCalledWith('user123', {
            type: contextType,
            searchResults: mediaItems.slice(0, 3),
            query: mediaType,
            timestamp: expect.any(Number),
            isActive: true,
          })
        } else if (stateService?.setContextMethod) {
          expect(stateService.setContextMethod).toHaveBeenCalledWith(
            'user123',
            {
              type: contextType,
              searchResults: mediaItems.slice(0, 3),
              query: mediaType,
              timestamp: expect.any(Number),
              isActive: true,
            },
          )
        }
        expect(mediaService.operationMethod).not.toHaveBeenCalled()
        expect(result.messages).toHaveLength(1)
      })
    })
  }
}
