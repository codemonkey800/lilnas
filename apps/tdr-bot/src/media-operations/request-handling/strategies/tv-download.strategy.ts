import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'

import { SonarrService } from 'src/media/services/sonarr.service'
import type { SeriesSearchResult } from 'src/media/types/sonarr.types'
import type {
  StrategyRequestParams,
  StrategyResult,
} from 'src/media-operations/request-handling/types'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import type { TvShowSelection } from 'src/schemas/tv-show'
import { StateService } from 'src/state/state.service'

import { BaseMediaStrategy } from './base/base-media-strategy'
import { MAX_SEARCH_RESULTS } from './base/strategy.constants'
import type { TvShowSelectionContext } from './base/strategy.types'

/**
 * Strategy for handling TV show download requests.
 * Supports complex multi-turn flows with granular selection:
 * 1. New Search: Initial TV show download search with optional auto-selection
 * 2. Selection: User selecting from previously shown search results
 * 3. Granular Selection: User specifying seasons/episodes to download
 *
 * Extracted from LLMService methods:
 * - handleNewTvShowSearch() (lines 3261-3571)
 * - handleTvShowSelection() (lines 3573-3752)
 * - downloadTvShow() (lines 1236-1309)
 */
@Injectable()
export class TvDownloadStrategy extends BaseMediaStrategy {
  protected readonly logger = new Logger(TvDownloadStrategy.name)
  protected readonly strategyName = 'TvDownloadStrategy'

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
   * Handle TV show download request.
   * Routes to either new search or selection handling based on context.
   */
  protected async executeRequest(
    params: StrategyRequestParams,
  ): Promise<StrategyResult> {
    const { message, messages, context, userId } = params

    this.logger.log(
      { userId, hasContext: !!context, strategy: this.strategyName },
      'Strategy execution started',
    )

    // If we have an active TV show context, this is a selection
    const tvShowContext = context as TvShowSelectionContext | undefined
    if (tvShowContext?.type === 'tvShow' && tvShowContext.isActive) {
      return await this.handleTvShowSelection(
        message,
        messages,
        tvShowContext,
        userId,
      )
    }

    // Otherwise, it's a new search
    return await this.handleNewTvShowSearch(message, messages, userId)
  }

  /**
   * Handle new TV show search with complex auto-selection logic.
   * Extracted from handleNewTvShowSearch() in llm.service.ts (lines 3261-3571)
   */
  private async handleNewTvShowSearch(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, content: message.content },
      'Starting new TV show search',
    )

    // Parse both search query and selection criteria upfront
    const messageContent = this.getMessageContent(message)
    const { searchQuery, selection, tvSelection } =
      await this.parsingUtilities.parseInitialSelection(messageContent)

    if (!searchQuery.trim()) {
      const clarificationResponse =
        await this.promptService.generateTvShowChatResponse(
          messages,
          'TV_SHOW_CLARIFICATION',
        )
      return {
        images: [],
        messages: messages.concat(clarificationResponse),
      }
    }

    try {
      // Search for TV shows using SonarrService
      const searchResults = await this.sonarrService.searchShows(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: searchResults.length,
          hasShowSelection: !!selection,
          hasGranularSelection: !!tvSelection?.selection,
        },
        'TV show search completed',
      )

      if (searchResults.length === 0) {
        const noResultsResponse =
          await this.promptService.generateTvShowChatResponse(
            messages,
            'TV_SHOW_NO_RESULTS',
            { searchQuery },
          )
        return {
          images: [],
          messages: messages.concat(noResultsResponse),
        }
      }

      // Smart auto-selection: Only apply when user provides BOTH search selection (ordinal/year only) AND granular TV selection
      if (
        selection &&
        (selection.selectionType === 'ordinal' ||
          selection.selectionType === 'year') &&
        tvSelection &&
        Object.prototype.hasOwnProperty.call(tvSelection, 'selection') &&
        searchResults.length > 0
      ) {
        const selectedShow = this.selectionUtilities.findSelectedShow(
          selection,
          searchResults,
        )
        if (selectedShow) {
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              selectionType: selection.selectionType,
              selectionValue: selection.value,
              tvSelection,
            },
            'Auto-applying complete TV show specification (search selection + granular selection)',
          )

          // Generate acknowledgment and download directly
          const response = await this.promptService.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SUCCESS',
            {
              selectedShow,
              downloadResult: {
                seriesAdded: true,
                seriesUpdated: false,
                searchTriggered: true,
              },
              autoApplied: true,
              selectionCriteria: `${selection.selectionType}: ${selection.value}`,
              granularSelection: tvSelection,
            },
          )

          // Start download process
          const downloadResult =
            await this.sonarrService.monitorAndDownloadSeries(
              selectedShow.tvdbId,
              tvSelection,
            )

          if (!downloadResult.success) {
            // Override response with error if download failed
            const errorResponse =
              await this.promptService.generateTvShowChatResponse(
                messages,
                'TV_SHOW_ERROR',
                {
                  selectedShow,
                  errorMessage: `Failed to add "${selectedShow.title}" to downloads: ${downloadResult.error}`,
                },
              )
            return {
              images: [],
              messages: messages.concat(errorResponse),
            }
          }

          return {
            images: [],
            messages: messages.concat(response),
          }
        } else {
          this.logger.warn(
            { userId, selection, searchResultsCount: searchResults.length },
            'Could not find selected show from complete specification, falling back to list',
          )
        }
      }

      // Show-only auto-selection: Apply when user provides ordinal/year selection but no granular selection
      if (
        selection &&
        (selection.selectionType === 'ordinal' ||
          selection.selectionType === 'year') &&
        (!tvSelection ||
          !Object.prototype.hasOwnProperty.call(tvSelection, 'selection')) &&
        searchResults.length > 0
      ) {
        const selectedShow = this.selectionUtilities.findSelectedShow(
          selection,
          searchResults,
        )
        if (selectedShow) {
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              selectionType: selection.selectionType,
              selectionValue: selection.value,
            },
            'Auto-selecting TV show for granular selection phase',
          )

          // Store single selected show in context for granular selection
          const tvShowContext = {
            type: 'tvShow' as const,
            searchResults: [selectedShow], // Only store the selected show
            query: searchQuery,
            timestamp: Date.now(),
            isActive: true,
            originalSearchSelection: selection,
            originalTvSelection: tvSelection || undefined,
          }

          // Store context in ContextManagementService
          await this.contextService.setContext(userId, 'tv', tvShowContext)

          const granularSelectionResponse =
            await this.promptService.generateTvShowChatResponse(
              messages,
              'TV_SHOW_GRANULAR_SELECTION_NEEDED',
              { selectedShow },
            )

          return {
            images: [],
            messages: messages.concat(granularSelectionResponse),
          }
        } else {
          this.logger.warn(
            { userId, selection, searchResultsCount: searchResults.length },
            'Could not find selected show from ordinal/year selection, falling back to list',
          )
        }
      }

      if (searchResults.length === 1) {
        // Only one result - but we still need granular selection
        this.logger.log(
          { userId, tvdbId: searchResults[0].tvdbId },
          'Single result found, checking for granular selection',
        )

        // If we have granular selection, apply it directly
        if (
          tvSelection &&
          Object.prototype.hasOwnProperty.call(tvSelection, 'selection')
        ) {
          this.logger.log(
            { userId, tvdbId: searchResults[0].tvdbId },
            'Single show with granular selection, downloading directly',
          )

          const response = await this.promptService.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SUCCESS',
            {
              selectedShow: searchResults[0],
              downloadResult: {
                seriesAdded: true,
                seriesUpdated: false,
                searchTriggered: true,
              },
              autoApplied: true,
              granularSelection: tvSelection,
            },
          )

          const downloadResult =
            await this.sonarrService.monitorAndDownloadSeries(
              searchResults[0].tvdbId,
              tvSelection,
            )

          if (!downloadResult.success) {
            const errorResponse =
              await this.promptService.generateTvShowChatResponse(
                messages,
                'TV_SHOW_ERROR',
                {
                  selectedShow: searchResults[0],
                  errorMessage: `Failed to add "${searchResults[0].title}" to downloads: ${downloadResult.error}`,
                },
              )
            return {
              images: [],
              messages: messages.concat(errorResponse),
            }
          }

          return {
            images: [],
            messages: messages.concat(response),
          }
        }

        // Store context and ask for granular selection
        const tvShowContext = {
          type: 'tvShow' as const,
          searchResults: searchResults.slice(0, 1),
          query: searchQuery,
          timestamp: Date.now(),
          isActive: true,
          originalSearchSelection: selection || undefined,
          originalTvSelection: tvSelection || undefined,
        }

        // Store context in ContextManagementService
        await this.contextService.setContext(userId, 'tv', tvShowContext)

        const selectionResponse =
          await this.promptService.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SELECTION_NEEDED',
            { searchQuery, shows: searchResults.slice(0, 1) },
          )

        return {
          images: [],
          messages: messages.concat(selectionResponse),
        }
      }

      // Multiple results - store context and ask user to choose
      const tvShowContext = {
        type: 'tvShow' as const,
        searchResults: searchResults.slice(0, MAX_SEARCH_RESULTS),
        query: searchQuery,
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: selection || undefined,
        originalTvSelection: tvSelection || undefined,
      }

      // Store context in ContextManagementService
      await this.contextService.setContext(userId, 'tv', tvShowContext)

      // Create selection prompt
      const selectionResponse =
        await this.promptService.generateTvShowChatResponse(
          messages,
          'TV_SHOW_SELECTION_NEEDED',
          {
            searchQuery,
            shows: searchResults.slice(0, MAX_SEARCH_RESULTS),
          },
        )

      return {
        images: [],
        messages: messages.concat(selectionResponse),
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, searchQuery },
        'Failed to search for TV shows',
      )

      const errorResponse = await this.promptService.generateTvShowChatResponse(
        messages,
        'TV_SHOW_ERROR',
        {
          searchQuery,
          errorMessage: `Couldn't search for "${searchQuery}" right now. The Sonarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  /**
   * Handle TV show selection with granular season/episode selection.
   * Extracted from handleTvShowSelection() in llm.service.ts (lines 3573-3752)
   */
  private async handleTvShowSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    tvShowContext: TvShowSelectionContext,
    userId: string,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing TV show selection',
    )

    try {
      // Check if this is a show selection (ordinal, title, etc.) or a granular selection
      if (tvShowContext.searchResults.length > 1) {
        // Multiple shows - first need to select which show
        const searchSelection = await this.parsingUtilities
          .parseSearchSelection(this.getMessageContent(message))
          .catch(() => null)

        // If no selection was parsed, ask user to clarify
        if (!searchSelection) {
          const clarificationResponse =
            await this.promptService.generateTvShowChatResponse(
              messages,
              'TV_SHOW_SELECTION_NEEDED',
              {
                searchQuery: tvShowContext.query,
                shows: tvShowContext.searchResults,
              },
            )
          return {
            images: [],
            messages: messages.concat(clarificationResponse),
          }
        }

        const selectedShow = this.selectionUtilities.findSelectedShow(
          searchSelection,
          tvShowContext.searchResults,
        )

        if (!selectedShow) {
          const clarificationResponse =
            await this.promptService.generateTvShowChatResponse(
              messages,
              'TV_SHOW_SELECTION_NEEDED',
              {
                searchQuery: tvShowContext.query,
                shows: tvShowContext.searchResults,
              },
            )
          return {
            images: [],
            messages: messages.concat(clarificationResponse),
          }
        }

        // Show selected - check if we have stored granular selection to apply
        if (
          tvShowContext.originalTvSelection &&
          Object.prototype.hasOwnProperty.call(
            tvShowContext.originalTvSelection,
            'selection',
          )
        ) {
          // We have the original TV selection (either undefined for entire series or array for specific) - apply it automatically
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              originalTvSelection: tvShowContext.originalTvSelection,
            },
            'Auto-applying stored granular selection after show selection',
          )

          // Clear context and download the TV show with stored granular selection
          await this.contextService.clearContext(userId)
          return await this.downloadTvShow(
            selectedShow,
            tvShowContext.originalTvSelection,
            message,
            messages,
            userId,
          )
        } else {
          // No stored granular selection or empty selection - ask user for it
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              originalTvSelection: tvShowContext.originalTvSelection,
            },
            'No granular selection found, asking user for season/episode selection',
          )

          const updatedContext = {
            ...tvShowContext,
            searchResults: [selectedShow],
          }
          // Store context in ContextManagementService
          await this.contextService.setContext(userId, 'tv', updatedContext)

          const granularSelectionResponse =
            await this.promptService.generateTvShowChatResponse(
              messages,
              'TV_SHOW_SELECTION_NEEDED',
              { searchQuery: tvShowContext.query, shows: [selectedShow] },
            )

          return {
            images: [],
            messages: messages.concat(granularSelectionResponse),
          }
        }
      }

      // Single show selected - parse granular selection (seasons/episodes)
      const messageContent = this.getMessageContent(message)

      const tvShowSelection = await this.parsingUtilities
        .parseTvShowSelection(messageContent)
        .catch(() => null)
      this.logger.log(
        { userId, selection: tvShowSelection },
        'Parsed TV show selection',
      )

      // If no granular selection was parsed, ask user to specify what to download
      if (!tvShowSelection) {
        const granularSelectionResponse =
          await this.promptService.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SELECTION_NEEDED',
            {
              searchQuery: tvShowContext.query,
              shows: tvShowContext.searchResults,
            },
          )
        return {
          images: [],
          messages: messages.concat(granularSelectionResponse),
        }
      }

      const selectedShow = tvShowContext.searchResults[0]

      // Clear context and download the TV show
      await this.contextService.clearContext(userId)
      return await this.downloadTvShow(
        selectedShow,
        tvShowSelection,
        message,
        messages,
        userId,
      )
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process TV show selection',
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

      const errorResponse = await this.promptService.generateTvShowChatResponse(
        messages,
        'TV_SHOW_PROCESSING_ERROR',
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
   * Execute TV show download via SonarrService with granular selection.
   * Extracted from downloadTvShow() in llm.service.ts (lines 1236-1309)
   */
  private async downloadTvShow(
    show: SeriesSearchResult,
    tvSelection: TvShowSelection,
    _originalMessage: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<StrategyResult> {
    this.logger.log(
      {
        userId,
        showTitle: show.title,
        tvdbId: show.tvdbId,
        selection: tvSelection,
      },
      'Attempting to download TV show',
    )

    try {
      const result = await this.sonarrService.monitorAndDownloadSeries(
        show.tvdbId,
        tvSelection,
      )

      if (result.success) {
        const successResponse =
          await this.promptService.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SUCCESS',
            {
              selectedShow: show,
              downloadResult: result,
              granularSelection: tvSelection,
            },
          )

        return {
          images: [],
          messages: messages.concat(successResponse),
        }
      } else {
        const errorResponse =
          await this.promptService.generateTvShowChatResponse(
            messages,
            'TV_SHOW_ERROR',
            {
              selectedShow: show,
              errorMessage: `Failed to add "${show.title}" to downloads: ${result.error}`,
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
        'Failed to download TV show',
      )

      const errorResponse = await this.promptService.generateTvShowChatResponse(
        messages,
        'TV_SHOW_ERROR',
        {
          selectedShow: show,
          errorMessage: `Couldn't add "${show.title}" to downloads. The Sonarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }
}
