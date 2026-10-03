import { HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { LlmClient } from 'src/llm/client/llm-client'
import {
  SearchSelection,
  SearchSelectionSchema,
} from 'src/schemas/search-selection'
import { TvShowSelection, TvShowSelectionSchema } from 'src/schemas/tv-show'
import {
  EXTRACT_SEARCH_QUERY_PROMPT,
  EXTRACT_TV_SEARCH_QUERY_PROMPT,
  MOVIE_SELECTION_PARSING_PROMPT,
  TV_SHOW_SELECTION_PARSING_PROMPT,
} from 'src/utils/prompts'

/**
 * Parsing utilities for extracting structured data from user messages
 *
 * Extracted from llm.service.ts for reuse across strategies
 */
@Injectable()
export class ParsingUtilities {
  private readonly logger = new Logger(ParsingUtilities.name)

  constructor(private readonly llm: LlmClient) {}

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
   *
   * Searches are by title, so an empty extraction (the user asked by genre,
   * actor, director or decade) comes back empty for the strategies to ask for
   * a title - not the raw message, which would search for the whole sentence.
   */
  async extractSearchQueryWithLLM(content: string): Promise<string> {
    try {
      const response = await this.llm.call({
        operation: 'media.extractQuery',
        role: 'reasoning',
        messages: [
          EXTRACT_SEARCH_QUERY_PROMPT,
          new HumanMessage({ id: nanoid(), content }),
        ],
      })

      const extractedQuery = response.output.trim()
      this.logger.log(
        { originalContent: content, extractedQuery },
        'Extracted search query using LLM',
      )

      return extractedQuery
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
      const response = await this.llm.call({
        operation: 'media.extractTvQuery',
        role: 'reasoning',
        messages: [
          EXTRACT_TV_SEARCH_QUERY_PROMPT,
          new HumanMessage({ id: nanoid(), content }),
        ],
      })

      const extractedQuery = response.output.trim()

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
      const response = await this.llm.call({
        operation: 'media.parseSelection',
        role: 'reasoning',
        messages: [
          MOVIE_SELECTION_PARSING_PROMPT,
          new HumanMessage({ id: nanoid(), content: selectionText }),
        ],
        schema: SearchSelectionSchema,
      })

      const validated = response.output
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
      const response = await this.llm.call({
        operation: 'media.parseTvSelection',
        role: 'reasoning',
        messages: [
          TV_SHOW_SELECTION_PARSING_PROMPT,
          new HumanMessage({ id: nanoid(), content: selectionText }),
        ],
        schema: TvShowSelectionSchema,
      })

      const validated = response.output
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
