import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Logger } from '@nestjs/common'

import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { MediaOperationResponse } from 'src/message-handler/services/media/media-operations.interface'

import { buildResponse } from './media-operations.utils'

/**
 * Context for operation errors
 */
interface OperationErrorContext {
  operation: string
  userId?: string
  searchQuery?: string
  itemTitle?: string
  [key: string]: unknown
}

/**
 * Options for error handling behavior
 */
interface ErrorHandlingOptions {
  shouldClearContext?: boolean
  customFallbackMessage?: string
}

/**
 * Generic error handler that standardizes error logging, context cleanup, and response generation.
 * Eliminates the repeated try-catch-log-respond patterns across all main methods.
 */
export async function handleOperationError(
  error: unknown,
  context: OperationErrorContext,
  messages: BaseMessage[],
  responseGenerator: (errorMessage: string) => Promise<HumanMessage>,
  logger: Logger,
  contextService?: ContextManagementService,
  options: ErrorHandlingOptions = {},
): Promise<MediaOperationResponse> {
  const { shouldClearContext = false, customFallbackMessage } = options

  // Log the error with full context
  logger.error(
    { error: getErrorMessage(error), ...context },
    `Failed to ${context.operation}`,
  )

  // Clear context if requested and service is available
  if (shouldClearContext && contextService && context.userId) {
    try {
      await contextService.clearContext(context.userId)
    } catch (contextError) {
      logger.warn(
        { error: getErrorMessage(contextError), userId: context.userId },
        'Failed to clear context during error handling',
      )
    }
  }

  // Generate appropriate error message
  const fallbackMessage =
    customFallbackMessage ||
    `Had trouble ${context.operation}. Please try again.`

  const errorResponse = await responseGenerator(fallbackMessage)
  return buildResponse(messages, errorResponse)
}

/**
 * Validates search query and provides standardized error responses.
 * Eliminates duplication of empty query validation in handleSearch and handleDelete.
 */
interface QueryValidationResult {
  isValid: boolean
  response?: MediaOperationResponse
}

export async function validateAndHandleSearchQuery(
  searchQuery: string,
  messages: BaseMessage[],
  clarificationResponseGenerator: () => Promise<HumanMessage>,
): Promise<QueryValidationResult> {
  if (!searchQuery.trim()) {
    const clarificationResponse = await clarificationResponseGenerator()
    return {
      isValid: false,
      response: buildResponse(messages, clarificationResponse),
    }
  }

  return {
    isValid: true,
  }
}

/**
 * Handles empty results with consistent messaging and response generation.
 */
export async function handleEmptyResults(
  operation: string,
  searchQuery: string,
  messages: BaseMessage[],
  noResultsResponseGenerator: (context: {
    searchQuery: string
  }) => Promise<HumanMessage>,
): Promise<MediaOperationResponse> {
  const noResultsResponse = await noResultsResponseGenerator({ searchQuery })
  return buildResponse(messages, noResultsResponse)
}

/**
 * Centralized retry configuration constants
 */
export const RETRY_CONFIGS = {
  DEFAULT: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    timeout: 15000,
  },
  LLM: {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    timeout: 30000,
  },
} as const

/**
 * Standard error messages for common scenarios
 */
export const ERROR_MESSAGES = {
  SERVICE_UNAVAILABLE: (serviceName: string) =>
    `The ${serviceName} service might be unavailable`,
  PROCESSING_ERROR: 'Had trouble processing your request',
  SELECTION_ERROR:
    'Had trouble processing your selection. Please try searching again.',
  OPERATION_FAILED: (operation: string, itemTitle: string) =>
    `Failed to ${operation} "${itemTitle}"`,
  TIMEOUT_ERROR: 'The operation timed out. Please try again.',
  NETWORK_ERROR:
    'Network connection issue. Please check your connection and try again.',
} as const
