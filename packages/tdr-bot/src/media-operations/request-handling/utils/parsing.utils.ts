import { HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { REASONING_TEMPERATURE } from 'src/constants/llm'
import {
  SearchSelection,
  SearchSelectionSchema,
} from 'src/schemas/search-selection'
import { TvShowSelection, TvShowSelectionSchema } from 'src/schemas/tv-show'
import { StateService } from 'src/state/state.service'
import {
  EXTRACT_SEARCH_QUERY_PROMPT,
  EXTRACT_TV_SEARCH_QUERY_PROMPT,
  MOVIE_SELECTION_PARSING_PROMPT,
  TV_SHOW_SELECTION_PARSING_PROMPT,
} from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

/**
 * Parsing utilities for extracting structured data from user messages
 *
 * Extracted from llm.service.ts for reuse across strategies
 */
@Injectable()
export class ParsingUtilities {
  private readonly logger = new Logger(ParsingUtilities.name)

  constructor(
    private readonly state: StateService,
    private readonly retryService: RetryService,
  ) {}

  /**
   * Get reasoning model for parsing tasks
   */
  private getReasoningModel(): ChatOpenAI {
    const state = this.state.getState()
    return new ChatOpenAI({
      model: state.reasoningModel,
      temperature: REASONING_TEMPERATURE,
    })
  }

  /**
   * Parse initial selection from message (search query + selection criteria)
   * Extracted from llm.service.ts lines 2172-2218
   */
  async parseInitialSelection(messageContent: string): Promise<{
    searchQuery: string
    selection: SearchSelection | null
    tvSelection: TvShowSelection | null
  }> {
    this.logger.log(
      { messageContent },
      'Parsing initial selection with search query and selection criteria',
    )

    try {
      // Parse search query, search selection, and TV selection in parallel
      const [searchQuery, searchSelection, tvSelection] = await Promise.all([
        this.extractSearchQueryWithLLM(messageContent),
        this.parseSearchSelection(messageContent).catch(() => null),
        this.parseTvShowSelection(messageContent).catch(() => null),
      ])

      this.logger.log(
        { searchQuery, searchSelection, tvSelection },
        'Parsed initial selection components',
      )

      return {
        searchQuery,
        selection: searchSelection,
        tvSelection,
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), messageContent },
        'Failed to parse initial selection, using fallback',
      )

      // Fallback to just search query extraction
      const searchQuery = await this.extractSearchQueryWithLLM(messageContent)
      return {
        searchQuery,
        selection: null,
        tvSelection: null,
      }
    }
  }

  /**
   * Extract search query from message using LLM
   * Extracted from llm.service.ts lines 2220-2257
   */
  async extractSearchQueryWithLLM(content: string): Promise<string> {
    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            EXTRACT_SEARCH_QUERY_PROMPT,
            new HumanMessage({ id: nanoid(), content }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-extractSearchQuery',
      )

      const extractedQuery = response.content.toString().trim()
      this.logger.log(
        { originalContent: content, extractedQuery },
        'Extracted search query using LLM',
      )

      return extractedQuery || content // Fallback to original if empty
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), content },
        'Failed to extract search query with LLM, using fallback',
      )

      // Simple fallback extraction
      return content
        .toLowerCase()
        .replace(/\b(download|add|get|find|search for|look for)\b/gi, '')
        .replace(/\b(movie|film|the)\b/gi, '')
        .trim()
    }
  }

  /**
   * Extract TV show delete query from user message using LLM
   * Extracted from llm.service.ts lines 3964-4005
   */
  async extractTvDeleteQueryWithLLM(content: string): Promise<string> {
    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            EXTRACT_TV_SEARCH_QUERY_PROMPT,
            new HumanMessage({ id: nanoid(), content }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-extractTvDeleteQuery',
      )

      const extractedQuery = response.content.toString().trim()

      // Clean the extracted query by removing surrounding quotes
      const cleanedQuery = extractedQuery.replace(/^["']|["']$/g, '').trim()

      this.logger.log(
        { originalContent: content, extractedQuery, cleanedQuery },
        'Extracted TV delete query using LLM',
      )

      return cleanedQuery || content // Fallback to original if empty
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), content },
        'Failed to extract TV delete query with LLM, using fallback',
      )

      // Simple fallback extraction for delete operations
      return content
        .toLowerCase()
        .replace(/\b(delete|remove|unmonitor|get rid of)\b/gi, '')
        .replace(/\b(show|series|tv|television|the)\b/gi, '')
        .trim()
    }
  }

  /**
   * Parse search selection (ordinal, year, etc.) from user message
   * Extracted from llm.service.ts lines 2988-3052
   */
  async parseSearchSelection(selectionText: string): Promise<SearchSelection> {
    this.logger.log(
      { selectionText },
      'DEBUG: Starting parseSearchSelection with input',
    )

    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            MOVIE_SELECTION_PARSING_PROMPT,
            new HumanMessage({ id: nanoid(), content: selectionText }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-parseSearchSelection',
      )

      const rawResponse = response.content.toString()
      this.logger.log(
        { rawResponse, selectionText },
        'DEBUG: Raw LLM response for search selection parsing',
      )

      const parsed = JSON.parse(rawResponse)
      this.logger.log(
        { parsed, selectionText },
        'DEBUG: Parsed JSON for search selection (before schema validation)',
      )

      // Handle error responses from LLM
      if (parsed.error) {
        this.logger.log(
          { error: parsed.error, selectionText },
          'DEBUG: LLM returned error response for search selection',
        )
        throw new Error(`LLM parsing error: ${parsed.error}`)
      }

      const validated = SearchSelectionSchema.parse(parsed)
      this.logger.log(
        { validated, selectionText },
        'DEBUG: Successfully validated search selection',
      )

      return validated
    } catch (error) {
      this.logger.error(
        {
          error: getErrorMessage(error),
          selectionText,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
        },
        'Failed to parse search selection - no fallback, letting conversation flow handle it',
      )
      throw error
    }
  }

  /**
   * Parse TV show selection (seasons/episodes) from user message
   * Extracted from llm.service.ts lines 4007-4071
   */
  async parseTvShowSelection(selectionText: string): Promise<TvShowSelection> {
    this.logger.log(
      { selectionText },
      'DEBUG: Starting parseTvShowSelection with input',
    )

    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            TV_SHOW_SELECTION_PARSING_PROMPT,
            new HumanMessage({ id: nanoid(), content: selectionText }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-parseTvShowSelection',
      )

      const rawResponse = response.content.toString()
      this.logger.log(
        { rawResponse, selectionText },
        'DEBUG: Raw LLM response for TV show selection parsing',
      )

      const parsed = JSON.parse(rawResponse)
      this.logger.log(
        { parsed, selectionText },
        'DEBUG: Parsed JSON for TV show selection (before schema validation)',
      )

      // Handle error responses from LLM
      if (parsed.error) {
        this.logger.log(
          { error: parsed.error, selectionText },
          'DEBUG: LLM returned error response for TV show selection',
        )
        throw new Error(`LLM parsing error: ${parsed.error}`)
      }

      const validated = TvShowSelectionSchema.parse(parsed)
      this.logger.log(
        { validated, selectionText },
        'DEBUG: Successfully validated TV show selection',
      )

      return validated
    } catch (error) {
      this.logger.error(
        {
          error: getErrorMessage(error),
          selectionText,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
        },
        'Failed to parse TV show selection - no fallback, letting conversation flow handle it',
      )
      throw error
    }
  }
}
