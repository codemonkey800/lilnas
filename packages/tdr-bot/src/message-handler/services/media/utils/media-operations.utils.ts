import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Logger } from '@nestjs/common'

import { MAX_SEARCH_RESULTS } from 'src/constants/llm'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { MediaOperationResponse } from 'src/message-handler/services/media/media-operations.interface'
import { SearchSelection } from 'src/schemas/search-selection'

/**
 * Generic media item interface that all media types should extend
 */
interface MediaItem {
  tmdbId: number
  title: string
  year?: number
}

/**
 * Generic operation result interface
 */
interface OperationResult {
  success: boolean
  error?: string
}

/**
 * Context object for media operations
 */
interface MediaContext<T extends MediaItem> {
  searchResults: T[]
  query: string
  timestamp: number
  isActive: boolean
}

/**
 * Generic auto-selection utility that handles smart selection for both search and delete operations.
 * Eliminates duplication between tryAutoSelection and tryAutoDeleteSelection methods.
 */
export async function tryAutoMediaSelection<T extends MediaItem>(
  selection: SearchSelection | null,
  results: T[],
  userId: string,
  messages: BaseMessage[],
  operation: (item: T) => Promise<OperationResult>,
  successResponseGenerator: (
    item: T,
    result: OperationResult,
    context: {
      autoApplied: boolean
      selectionCriteria: string
    },
  ) => Promise<HumanMessage>,
  errorResponseGenerator: (item: T, error: string) => Promise<HumanMessage>,
  logger: Logger,
  logContext: string,
): Promise<MediaOperationResponse | null> {
  if (
    !selection ||
    !(
      selection.selectionType === 'ordinal' ||
      selection.selectionType === 'year'
    ) ||
    results.length === 0
  ) {
    return null
  }

  const selectedItem = findSelectedMediaItem(
    selection,
    results,
    logger,
    logContext,
  )
  if (!selectedItem) {
    logger.warn(
      { userId, selection, searchResultsCount: results.length },
      `Could not find selected ${logContext} from specification, falling back to list`,
    )
    return null
  }

  logger.log(
    {
      userId,
      tmdbId: selectedItem.tmdbId,
      selectionType: selection.selectionType,
      selectionValue: selection.value,
      itemTitle: selectedItem.title,
    },
    `Auto-applying ${logContext} selection (explicit search selection provided)`,
  )

  try {
    const operationResult = await operation(selectedItem)

    if (!operationResult.success) {
      const errorResponse = await errorResponseGenerator(
        selectedItem,
        operationResult.error || 'Unknown error',
      )
      return buildResponse(messages, errorResponse)
    }

    const successResponse = await successResponseGenerator(
      selectedItem,
      operationResult,
      {
        autoApplied: true,
        selectionCriteria: `${selection.selectionType}: ${selection.value}`,
      },
    )

    return buildResponse(messages, successResponse)
  } catch (error) {
    logger.error(
      { error: getErrorMessage(error), userId, itemTitle: selectedItem.title },
      `Failed to execute auto-selection operation for ${logContext}`,
    )

    const errorResponse = await errorResponseGenerator(
      selectedItem,
      `Couldn't process "${selectedItem.title}". The service might be unavailable.`,
    )
    return buildResponse(messages, errorResponse)
  }
}

/**
 * Generic single result handler that processes a single search/library result directly.
 * Eliminates duplication between handleSingleSearchResult and handleSingleLibraryResult.
 */
export async function handleSingleResult<T extends MediaItem>(
  results: T[],
  operation: (item: T) => Promise<MediaOperationResponse>,
  logger: Logger,
  userId: string,
  logContext: string,
): Promise<MediaOperationResponse | null> {
  if (results.length !== 1) {
    return null
  }

  logger.log(
    { userId, tmdbId: results[0].tmdbId },
    `Single result found in ${logContext}, processing directly`,
  )

  return await operation(results[0])
}

/**
 * Generic multiple results handler that stores context and asks for user selection.
 * Eliminates duplication between handleMultipleSearchResults and handleMultipleLibraryResults.
 */
export async function handleMultipleResults<T extends MediaItem>(
  results: T[],
  searchQuery: string,
  userId: string,
  messages: BaseMessage[],
  contextType: string,
  contextService: ContextManagementService,
  responseGenerator: (context: {
    searchQuery: string
    items: T[]
  }) => Promise<HumanMessage>,
): Promise<MediaOperationResponse> {
  const limitedResults = results.slice(0, MAX_SEARCH_RESULTS)

  const mediaContext: MediaContext<T> = {
    searchResults: limitedResults,
    query: searchQuery,
    timestamp: Date.now(),
    isActive: true,
  }

  await contextService.setContext(userId, contextType, mediaContext)

  const selectionResponse = await responseGenerator({
    searchQuery,
    items: limitedResults,
  })

  return buildResponse(messages, selectionResponse)
}

/**
 * Generic operation executor that handles the common pattern of executing
 * a media operation and generating appropriate success/error responses.
 * Eliminates duplication between downloadMovie and deleteMovie methods.
 */
export async function executeMediaOperation<T extends MediaItem>(
  item: T,
  operation: (item: T) => Promise<OperationResult>,
  successResponseGenerator: (
    item: T,
    result: OperationResult,
  ) => Promise<HumanMessage>,
  errorResponseGenerator: (item: T, error: string) => Promise<HumanMessage>,
  messages: BaseMessage[],
  logger: Logger,
  userId: string,
  operationName: string,
): Promise<MediaOperationResponse> {
  logger.log(
    { userId, itemTitle: item.title, tmdbId: item.tmdbId },
    `Attempting to ${operationName}`,
  )

  try {
    const result = await operation(item)

    if (result.success) {
      const successResponse = await successResponseGenerator(item, result)
      return buildResponse(messages, successResponse)
    } else {
      const errorResponse = await errorResponseGenerator(
        item,
        `Failed to ${operationName} "${item.title}": ${result.error}`,
      )
      return buildResponse(messages, errorResponse)
    }
  } catch (error) {
    logger.error(
      { error: getErrorMessage(error), userId, itemTitle: item.title },
      `Failed to ${operationName}`,
    )

    const errorResponse = await errorResponseGenerator(
      item,
      `Couldn't ${operationName} "${item.title}". The service might be unavailable.`,
    )

    return buildResponse(messages, errorResponse)
  }
}

/**
 * Generic media item finder that works with any media type.
 * Centralizes the selection logic that was duplicated in findSelectedMovie methods.
 */
export function findSelectedMediaItem<T extends MediaItem>(
  selection: SearchSelection,
  items: T[],
  logger: Logger,
  logContext: string,
): T | null {
  const { selectionType, value } = selection

  logger.log(
    { selectionType, value, itemCount: items.length },
    `Finding selected item from ${logContext}`,
  )

  try {
    switch (selectionType) {
      case 'ordinal': {
        const index = parseInt(value) - 1
        if (index >= 0 && index < items.length) {
          const selected = items[index]
          logger.log(
            { index, selectedItem: selected.title },
            `Found item by ordinal selection from ${logContext}`,
          )
          return selected
        }
        break
      }

      case 'year': {
        const targetYear = parseInt(value)
        const found = items.find(item => item.year === targetYear)
        if (found) {
          logger.log(
            { targetYear, selectedItem: found.title },
            `Found item by year selection from ${logContext}`,
          )
          return found
        }
        break
      }
    }

    logger.warn(
      { selection, itemCount: items.length },
      `Could not find selected item from criteria in ${logContext}`,
    )
    return null
  } catch (error) {
    logger.error(
      { error: getErrorMessage(error), selection },
      `Error finding selected item in ${logContext}`,
    )
    return null
  }
}

/**
 * Build standardized response object.
 * Already exists in MovieOperationsService but extracted here for consistency.
 */
export function buildResponse(
  messages: BaseMessage[],
  response: HumanMessage,
): MediaOperationResponse {
  return {
    images: [],
    messages: messages.concat(response),
  }
}

/**
 * Extract message content as string.
 * Already exists in MovieOperationsService but extracted here for consistency.
 */
export function extractMessageContent(message: HumanMessage): string {
  return typeof message.content === 'string'
    ? message.content
    : message.content.toString()
}
