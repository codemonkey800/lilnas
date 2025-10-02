import { HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { ChatOpenAI } from '@langchain/openai'
import { Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { SearchSelection, SearchSelectionSchema } from 'src/schemas/search-selection'
import { RetryService } from 'src/utils/retry.service'

import { RETRY_CONFIGS } from './media-error-handler.utils'

/**
 * Parse search selection (ordinal/year) from user message using LLM.
 * This is the exact same logic used in both MovieOperationsService and TvOperationsService.
 */
export async function parseSearchSelection(
  selectionText: string,
  reasoningModel: ChatOpenAI,
  retryService: RetryService,
  selectionParsingPrompt: HumanMessage,
  logger?: Logger,
): Promise<SearchSelection> {
  if (logger) {
    logger.log(
      { selectionText },
      'DEBUG: Starting parseSearchSelection with input',
    )
  }

  try {
    const response = await retryService.executeWithRetry(
      () =>
        reasoningModel.invoke([
          selectionParsingPrompt,
          new HumanMessage({ id: nanoid(), content: selectionText }),
        ]),
      RETRY_CONFIGS.DEFAULT,
      'OpenAI-parseSearchSelection',
    )

    const rawResponse = response.content.toString()
    if (logger) {
      logger.log(
        { rawResponse, selectionText },
        'DEBUG: Raw LLM response for search selection parsing',
      )
    }

    const parsed = JSON.parse(rawResponse)
    const validatedResult = SearchSelectionSchema.parse(parsed)

    if (logger) {
      logger.log(
        { validatedResult },
        'DEBUG: Successfully parsed and validated search selection',
      )
    }

    return validatedResult
  } catch (error) {
    if (logger) {
      logger.error(
        { error: getErrorMessage(error), selectionText },
        'DEBUG: Failed to parse search selection',
      )
    }
    throw error
  }
}

/**
 * Extract search query from user message using LLM with configurable fallback.
 * Unified implementation for both movie and TV search query extraction.
 */
export async function extractSearchQueryWithLLM(
  content: string,
  reasoningModel: ChatOpenAI,
  retryService: RetryService,
  extractionPrompt: HumanMessage,
  fallbackTerms: string[],
  logger?: Logger,
): Promise<string> {
  try {
    const response = await retryService.executeWithRetry(
      () =>
        reasoningModel.invoke([
          extractionPrompt,
          new HumanMessage({ id: nanoid(), content }),
        ]),
      RETRY_CONFIGS.DEFAULT,
      'OpenAI-extractSearchQuery',
    )

    const extractedQuery = response.content.toString().trim()
    // Remove quotes if LLM wrapped the query
    const cleanedQuery = extractedQuery.replace(/^["']|["']$/g, '').trim()

    if (logger) {
      logger.log(
        { originalContent: content, extractedQuery, cleanedQuery },
        'Extracted search query using LLM',
      )
    }

    return cleanedQuery || content // Fallback to original if empty
  } catch (error) {
    if (logger) {
      logger.error(
        { error: getErrorMessage(error), content },
        'Failed to extract search query with LLM, using fallback',
      )
    }

    // Simple fallback extraction: remove action words and domain-specific terms
    let cleaned = content.toLowerCase()

    // Remove common action words
    cleaned = cleaned.replace(
      /\b(download|add|get|find|search for|look for)\b/gi,
      '',
    )

    // Remove domain-specific terms
    const termsPattern = new RegExp(`\\b(${fallbackTerms.join('|')})\\b`, 'gi')
    cleaned = cleaned.replace(termsPattern, '')

    return cleaned.trim()
  }
}
