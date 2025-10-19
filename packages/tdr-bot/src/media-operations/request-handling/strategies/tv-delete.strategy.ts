import { HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'

import { SonarrService } from 'src/media/services/sonarr.service'
import type {
  StrategyRequestParams,
  StrategyResult,
} from 'src/media-operations/request-handling/types'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import type { SearchSelection } from 'src/schemas/search-selection'
import type { TvShowSelection } from 'src/schemas/tv-show'
import { StateService } from 'src/state/state.service'

import { BaseMediaStrategy } from './base/base-media-strategy'
import { MAX_SEARCH_RESULTS } from './base/strategy.constants'
import type { TvShowDeleteContext } from './base/strategy.types'

/**
 * Strategy for handling TV show deletion requests.
 * This is the most complex strategy due to granular deletion support:
 * 1. New Delete: Search library with complex validation logic
 * 2. Selection: Multi-turn conversation requiring both show and granular selection
 * 3. Validation: Must have valid selection data before deletion
 *
 * Extracted from LLMService methods:
 * - handleNewTvShowDelete() (lines 1558-1828)
 * - handleTvShowDeleteSelection() (lines 1833-1960)
 * - deleteTvShow() (lines 3757-3873)
 */
@Injectable()
export class TvDeleteStrategy extends BaseMediaStrategy {
  protected readonly logger = new Logger(TvDeleteStrategy.name)
  protected readonly strategyName = 'TvDeleteStrategy'

  constructor(
    private readonly sonarrService: SonarrService,
    private readonly promptService: PromptGenerationService,
    private readonly parsingUtilities: ParsingUtilities,
    private readonly selectionUtilities: SelectionUtilities,
    state: StateService,
    contextService: ContextManagementService,
  ) {
    super()
    this.stateService = state
    this.contextService = contextService
  }

  /**
   * Handle TV show delete request.
   * Routes to either new delete or selection handling based on context.
   */
  protected async executeRequest(
    params: StrategyRequestParams,
  ): Promise<StrategyResult> {
    const { message, messages, context, userId } = params

    this.logger.log(
      { userId, hasContext: !!context, strategy: this.strategyName },
      'Strategy execution started',
    )

    // If we have an active TV show delete context, this is a selection
    const tvShowDeleteContext = context as TvShowDeleteContext | undefined
    if (
      tvShowDeleteContext?.type === 'tvShowDelete' &&
      tvShowDeleteContext.isActive
    ) {
      return await this.handleTvShowDeleteSelection(
        message,
        messages,
        tvShowDeleteContext,
        userId,
      )
    }

    // Otherwise, it's a new delete request
    return await this.handleNewTvShowDelete(message, messages, userId)
  }

  /**
   * Handle new TV show delete request with complex validation.
   * Extracted from handleNewTvShowDelete() in llm.service.ts (lines 1558-1828)
   */
  private async handleNewTvShowDelete(
    message: HumanMessage,
    messages: HumanMessage[],
    userId: string,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, content: message.content },
      'Starting new TV show delete',
    )

    // Parse both search query and selections upfront
    const messageContent = this.getMessageContent(message)

    try {
      const searchQuery =
        await this.parsingUtilities.extractTvDeleteQueryWithLLM(messageContent)

      if (!searchQuery.trim()) {
        const clarificationResponse =
          await this.promptService.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_NO_RESULTS',
            {
              searchQuery: '',
            },
          )
        return {
          images: [],
          messages: messages.concat(clarificationResponse),
        }
      }

      // Parse initial selections (both search and series selection)
      let searchSelection: SearchSelection | null = null
      let tvSelection: TvShowSelection | null = null

      try {
        // Try to parse search selection (which show to select)
        searchSelection = await this.parsingUtilities
          .parseSearchSelection(messageContent)
          .catch(() => null)
        // Try to parse TV show selection (which parts to delete)
        tvSelection = await this.parsingUtilities
          .parseTvShowSelection(messageContent)
          .catch(() => null)
      } catch (error) {
        this.logger.log(
          { error: getErrorMessage(error) },
          'Failed to parse initial selections, will ask user for clarification',
        )
      }

      // Search library for TV shows using SonarrService
      const libraryResults =
        await this.sonarrService.getLibrarySeries(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: libraryResults.length,
          hasSearchSelection: !!searchSelection,
          hasTvSelection: !!tvSelection,
        },
        'TV show library search for delete completed',
      )

      if (libraryResults.length === 0) {
        const noResultsResponse =
          await this.promptService.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_NO_RESULTS',
            { searchQuery },
          )
        return {
          images: [],
          messages: messages.concat(noResultsResponse),
        }
      }

      // Limit library results to maximum
      const transformedResults = libraryResults.slice(0, MAX_SEARCH_RESULTS)

      // Apply selection validation logic based on our plan
      if (libraryResults.length === 1) {
        // Single result - only need series selection
        this.logger.log(
          {
            userId,
            tvSelection,
            tvSelectionExists: !!tvSelection,
            tvSelectionHasSelection: !!tvSelection?.selection,
            tvSelectionLength: tvSelection?.selection?.length || 0,
            searchSelection,
            searchSelectionExists: !!searchSelection,
          },
          'DEBUG: Evaluating delete criteria for single result',
        )

        if (tvSelection?.selection && tvSelection.selection.length > 0) {
          // Has both result (implied single) and series selection
          this.logger.log(
            { userId, showTitle: libraryResults[0].title, tvSelection },
            'Single result with series selection, proceeding with delete',
          )
          return await this.deleteTvShow(
            transformedResults[0],
            tvSelection,
            message,
            messages,
            userId,
          )
        } else if (tvSelection && Object.keys(tvSelection).length === 0) {
          // Empty tvSelection object means "entire series" - proceed automatically
          this.logger.log(
            { userId, showTitle: libraryResults[0].title },
            'Single result with entire series selection, proceeding with delete',
          )
          return await this.deleteTvShow(
            transformedResults[0],
            tvSelection,
            message,
            messages,
            userId,
          )
        } else {
          // Missing series selection - create context for single result case
          const tvShowDeleteContext = {
            type: 'tvShowDelete' as const,
            searchResults: transformedResults,
            query: searchQuery,
            timestamp: Date.now(),
            isActive: true,
            originalSearchSelection: searchSelection || undefined,
            originalTvSelection: tvSelection || undefined,
          }

          // Store context in ContextManagementService
          await this.contextService.setContext(
            userId,
            'tvDelete',
            tvShowDeleteContext,
          )

          const needSeriesResponse =
            await this.promptService.generateTvShowDeleteChatResponse(
              messages,
              'TV_SHOW_DELETE_NEED_SERIES_SELECTION',
              {
                selectedShow: transformedResults[0],
              },
            )
          return {
            images: [],
            messages: messages.concat(needSeriesResponse),
          }
        }
      } else {
        // Multiple results - need both result and series selection
        this.logger.log(
          {
            userId,
            searchSelectionExists: !!searchSelection,
            tvSelectionExists: !!tvSelection,
            tvSelectionHasSelection: !!(
              tvSelection?.selection && tvSelection.selection.length > 0
            ),
            tvSelectionIsEntireSeries: !!(
              tvSelection && Object.keys(tvSelection).length === 0
            ),
            resultsCount: transformedResults.length,
          },
          'DEBUG: Evaluating delete criteria for multiple results',
        )

        if (
          searchSelection &&
          ((tvSelection?.selection && tvSelection.selection.length > 0) ||
            (tvSelection && Object.keys(tvSelection).length === 0))
        ) {
          // Has both selections (either specific episodes/seasons or entire series)
          const selectedShow =
            this.selectionUtilities.findSelectedTvShowFromLibrary(
              searchSelection,
              transformedResults,
            )
          if (selectedShow) {
            this.logger.log(
              { userId, showTitle: selectedShow.title, tvSelection },
              'Multiple results with both selections, proceeding with delete',
            )
            return await this.deleteTvShow(
              selectedShow,
              tvSelection,
              message,
              messages,
              userId,
            )
          }
          // If we have both selections but the search selection didn't match, ask for result selection
          this.logger.warn(
            { userId, searchSelection, tvSelection },
            'Could not find selected show from library specification, falling back to list',
          )
        }

        // Store context for multi-turn conversation
        const tvShowDeleteContext = {
          type: 'tvShowDelete' as const,
          searchResults: transformedResults,
          query: searchQuery,
          timestamp: Date.now(),
          isActive: true,
          originalSearchSelection: searchSelection || undefined,
          originalTvSelection: tvSelection || undefined,
        }

        // Store context in ContextManagementService
        await this.contextService.setContext(
          userId,
          'tvDelete',
          tvShowDeleteContext,
        )

        // Determine what we need to ask for
        if (!searchSelection && !tvSelection) {
          // Need both selections
          const response =
            await this.promptService.generateTvShowDeleteChatResponse(
              messages,
              'TV_SHOW_DELETE_MULTIPLE_RESULTS_NEED_BOTH',
              {
                searchResults: transformedResults,
                searchQuery,
              },
            )
          return {
            images: [],
            messages: messages.concat(response),
          }
        } else if (!searchSelection || (searchSelection && tvSelection)) {
          // Need result selection (either no search selection, or search selection didn't match)
          const response =
            await this.promptService.generateTvShowDeleteChatResponse(
              messages,
              'TV_SHOW_DELETE_NEED_RESULT_SELECTION',
              {
                searchResults: transformedResults,
                searchQuery,
              },
            )
          return {
            images: [],
            messages: messages.concat(response),
          }
        } else {
          // Need series selection (have valid search selection but no TV selection)
          const response =
            await this.promptService.generateTvShowDeleteChatResponse(
              messages,
              'TV_SHOW_DELETE_NEED_SERIES_SELECTION',
              {
                searchResults: transformedResults,
                searchQuery,
              },
            )
          return {
            images: [],
            messages: messages.concat(response),
          }
        }
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to search library for TV show delete',
      )

      const errorResponse =
        await this.promptService.generateTvShowDeleteChatResponse(
          messages,
          'TV_SHOW_DELETE_ERROR',
          {
            errorMessage: `Couldn't search library right now. The Sonarr service might be unavailable.`,
          },
        )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  /**
   * Handle TV show delete selection when context exists.
   * Extracted from handleTvShowDeleteSelection() in llm.service.ts (lines 1833-1960)
   */
  private async handleTvShowDeleteSelection(
    message: HumanMessage,
    messages: HumanMessage[],
    tvShowDeleteContext: TvShowDeleteContext,
    userId: string,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing TV show delete selection',
    )

    try {
      // Parse the user's new selections
      const messageContent = this.getMessageContent(message)

      let searchSelection: SearchSelection | null = null
      let tvSelection: TvShowSelection | null = null

      try {
        searchSelection = await this.parsingUtilities
          .parseSearchSelection(messageContent)
          .catch(() => null)
        tvSelection = await this.parsingUtilities
          .parseTvShowSelection(messageContent)
          .catch(() => null)
      } catch (error) {
        this.logger.log(
          { error: getErrorMessage(error) },
          'Failed to parse selections from user message',
        )
      }

      // Combine with existing context selections
      const finalSearchSelection =
        searchSelection || tvShowDeleteContext.originalSearchSelection
      const finalTvSelection =
        tvSelection || tvShowDeleteContext.originalTvSelection

      // Validate we have both required selections
      if (
        tvShowDeleteContext.searchResults.length > 1 &&
        !finalSearchSelection
      ) {
        // Still need result selection
        const response =
          await this.promptService.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_NEED_RESULT_SELECTION',
            {
              searchResults: tvShowDeleteContext.searchResults,
              searchQuery: tvShowDeleteContext.query,
            },
          )
        return {
          images: [],
          messages: messages.concat(response),
        }
      }

      // Check if we have a valid TV selection (either specific parts or entire series)
      const isEntireSeries =
        finalTvSelection && Object.keys(finalTvSelection).length === 0
      const hasValidSelection =
        finalTvSelection?.selection && finalTvSelection.selection.length > 0

      if (!isEntireSeries && !hasValidSelection) {
        // Still need series selection
        const selectedShow =
          tvShowDeleteContext.searchResults.length === 1
            ? tvShowDeleteContext.searchResults[0]
            : finalSearchSelection
              ? this.selectionUtilities.findSelectedTvShowFromLibrary(
                  finalSearchSelection,
                  tvShowDeleteContext.searchResults,
                )
              : null

        const response =
          await this.promptService.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_NEED_SERIES_SELECTION',
            {
              selectedShow: selectedShow || undefined,
              searchResults: tvShowDeleteContext.searchResults,
              searchQuery: tvShowDeleteContext.query,
            },
          )
        return {
          images: [],
          messages: messages.concat(response),
        }
      }

      // Find the selected show
      const selectedShow =
        tvShowDeleteContext.searchResults.length === 1
          ? tvShowDeleteContext.searchResults[0]
          : finalSearchSelection
            ? this.selectionUtilities.findSelectedTvShowFromLibrary(
                finalSearchSelection,
                tvShowDeleteContext.searchResults,
              )
            : null

      if (!selectedShow) {
        const response =
          await this.promptService.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_NEED_RESULT_SELECTION',
            {
              searchResults: tvShowDeleteContext.searchResults,
              searchQuery: tvShowDeleteContext.query,
            },
          )
        return {
          images: [],
          messages: messages.concat(response),
        }
      }

      // Clear context and proceed with delete
      await this.contextService.clearContext(userId)
      return await this.deleteTvShow(
        selectedShow,
        finalTvSelection,
        message,
        messages,
        userId,
      )
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process TV show delete selection',
      )

      // Clear context on error
      try {
        await this.contextService.clearContext(userId)
      } catch (clearError) {
        this.logger.warn(
          { error: getErrorMessage(clearError), userId },
          'Failed to clear context during error cleanup',
        )
      }

      const errorResponse =
        await this.promptService.generateTvShowDeleteChatResponse(
          messages,
          'TV_SHOW_DELETE_ERROR',
          {
            errorMessage:
              'Had trouble processing your selection. Please try searching again.',
          },
        )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  /**
   * Delete a TV show from the library with validation.
   * Extracted from deleteTvShow() in llm.service.ts (lines 3757-3873)
   */
  private async deleteTvShow(
    show: { id: number; tvdbId: number; title: string; year?: number },
    selection: TvShowSelection,
    _originalMessage: HumanMessage,
    messages: HumanMessage[],
    userId: string,
  ): Promise<StrategyResult> {
    // VALIDATION GATE: Ensure we have valid selection data before proceeding
    // Note: Empty object {} is valid and means "entire series"
    const isEntireSeries = selection && Object.keys(selection).length === 0
    const hasValidSelection =
      selection?.selection && selection.selection.length > 0

    if (!selection || (!isEntireSeries && !hasValidSelection)) {
      this.logger.error(
        {
          userId,
          showTitle: show.title,
          selection,
        },
        'VALIDATION GATE: Invalid TV selection provided to deleteTvShow',
      )

      const errorResponse =
        await this.promptService.generateTvShowDeleteChatResponse(
          messages,
          'TV_SHOW_DELETE_ERROR',
          {
            selectedShow: show,
            errorMessage:
              'Invalid selection data - cannot proceed with deletion',
          },
        )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }

    this.logger.log(
      {
        userId,
        showTitle: show.title,
        tvdbId: show.tvdbId,
        seriesId: show.id,
        selection,
      },
      'Attempting to delete TV show',
    )

    try {
      const result = await this.sonarrService.unmonitorAndDeleteSeries(
        show.tvdbId,
        {
          selection: selection.selection,
          deleteFiles: true, // Always delete files for user-initiated deletes
        },
      )

      if (result.success) {
        this.logger.log(
          {
            userId,
            showTitle: show.title,
            situationType: 'TV_SHOW_DELETE_SUCCESS',
            deleteResult: result,
          },
          'DEBUG: Generating TV show delete success response',
        )

        const successResponse =
          await this.promptService.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_SUCCESS',
            {
              selectedShow: show,
              deleteResult: result,
            },
          )

        return {
          images: [],
          messages: messages.concat(successResponse),
        }
      } else {
        const errorResponse =
          await this.promptService.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_ERROR',
            {
              selectedShow: show,
              errorMessage: `Failed to delete "${show.title}": ${result.error}`,
            },
          )

        return {
          images: [],
          messages: messages.concat(errorResponse),
        }
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, showTitle: show.title },
        'Failed to delete TV show',
      )

      const errorResponse =
        await this.promptService.generateTvShowDeleteChatResponse(
          messages,
          'TV_SHOW_DELETE_ERROR',
          {
            selectedShow: show,
            errorMessage: `Couldn't delete "${show.title}". The Sonarr service might be unavailable.`,
          },
        )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }
}
