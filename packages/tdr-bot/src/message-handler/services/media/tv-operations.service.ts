import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { MAX_SEARCH_RESULTS } from 'src/constants/llm'
import { SonarrService } from 'src/media/services/sonarr.service'
import {
  LibrarySearchResult,
  SeriesSearchResult,
  UnmonitorAndDeleteSeriesResult,
} from 'src/media/types/sonarr.types'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { SearchSelection } from 'src/schemas/search-selection'
import {
  TvShowDeleteContext,
  TvShowSelection,
  TvShowSelectionContext,
  TvShowSelectionSchema,
} from 'src/schemas/tv-show'
import { StateService } from 'src/state/state.service'
import {
  EXTRACT_TV_SEARCH_QUERY_PROMPT,
  MOVIE_SELECTION_PARSING_PROMPT,
  TV_SHOW_SELECTION_PARSING_PROMPT,
} from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

import {
  MediaOperationResponse,
  MediaOperationsInterface,
} from './media-operations.interface'
import { createChatModel, createReasoningModel } from './utils/llm-model.utils'
import {
  handleEmptyResults,
  handleOperationError,
  RETRY_CONFIGS,
  validateAndHandleSearchQuery,
} from './utils/media-error-handler.utils'
import {
  buildResponse,
  executeMediaOperation,
  extractMessageContent,
  findSelectedMediaItem,
} from './utils/media-operations.utils'
import {
  extractSearchQueryWithLLM,
  parseSearchSelection,
} from './utils/media-parsing.utils'

/**
 * Service handling TV show-specific operations including search, selection, and deletion.
 * Extracted from LLMService to provide focused TV show functionality.
 *
 * Key differences from MovieOperationsService:
 * - 2-phase selection: show selection + granular selection (seasons/episodes)
 * - More complex auto-selection logic due to granular requirements
 * - Validation gate for delete operations to ensure valid selection data
 */
@Injectable()
export class TvOperationsService
  implements
    MediaOperationsInterface<
      TvShowSelectionContext | TvShowDeleteContext,
      MediaOperationResponse
    >
{
  private readonly logger = new Logger(TvOperationsService.name)

  constructor(
    private readonly sonarrService: SonarrService,
    private readonly contextService: ContextManagementService,
    private readonly promptService: PromptGenerationService,
    private readonly retryService: RetryService,
    private readonly stateService: StateService,
  ) {}

  /**
   * Handle new TV show search request
   *
   * Smart auto-selection logic:
   * 1. Ordinal/year + granular selection → auto-download
   * 2. Ordinal/year only → store context, ask for granular
   * 3. Single result + granular → auto-download
   * 4. Single result only → store context, ask for granular
   * 5. Multiple results → store context, ask for show selection
   */
  async handleSearch(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<MediaOperationResponse> {
    this.logger.log(
      { userId, content: message.content },
      'Starting new TV show search',
    )

    // Parse both search query and selection criteria upfront
    const messageContent = extractMessageContent(message)
    const { searchQuery, selection, tvSelection } =
      await this.parseInitialSelection(messageContent)

    // Validate search query
    const validation = await validateAndHandleSearchQuery(
      searchQuery,
      messages,
      () => this.generateTvShowResponse(messages, 'TV_SHOW_CLARIFICATION'),
    )
    if (!validation.isValid) {
      return validation.response!
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
        return await handleEmptyResults(
          'search',
          searchQuery,
          messages,
          context =>
            this.generateTvShowResponse(
              messages,
              'TV_SHOW_NO_RESULTS',
              context,
            ),
        )
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
        const autoSelectionResult = await this.tryAutoCompleteSelection(
          selection,
          tvSelection,
          searchResults,
          userId,
          messages,
        )

        if (autoSelectionResult) {
          return autoSelectionResult
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
        const partialSelectionResult = await this.tryAutoShowSelection(
          selection,
          tvSelection,
          searchResults,
          searchQuery,
          userId,
          messages,
        )

        if (partialSelectionResult) {
          return partialSelectionResult
        }
      }

      // Handle single result
      if (searchResults.length === 1) {
        return await this.handleSingleSearchResult(
          searchResults[0],
          tvSelection,
          searchQuery,
          selection,
          userId,
          messages,
        )
      }

      // Multiple results - store context and ask user to choose
      const tvShowContext: TvShowSelectionContext = {
        searchResults: searchResults.slice(0, MAX_SEARCH_RESULTS),
        query: searchQuery,
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: selection || undefined,
        originalTvSelection: tvSelection || undefined,
      }

      await this.contextService.setContext(
        userId,
        'tv_selection',
        tvShowContext,
      )

      const selectionResponse = await this.generateTvShowResponse(
        messages,
        'TV_SHOW_SELECTION_NEEDED',
        {
          searchQuery,
          shows: searchResults.slice(0, MAX_SEARCH_RESULTS),
        },
      )

      return buildResponse(messages, selectionResponse)
    } catch (error) {
      return await handleOperationError(
        error,
        { operation: 'search for TV shows', userId, searchQuery },
        messages,
        errorMessage =>
          this.generateTvShowResponse(messages, 'TV_SHOW_ERROR', {
            searchQuery,
            errorMessage,
          }),
        this.logger,
      )
    }
  }

  /**
   * Handle TV show selection from search results
   *
   * Handles 2-phase selection:
   * 1. If multiple shows: parse show selection first
   * 2. If single show: parse granular selection (seasons/episodes)
   */
  async handleSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    tvShowContext: TvShowSelectionContext,
    userId: string,
  ): Promise<MediaOperationResponse> {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing TV show selection',
    )

    try {
      // Check if this is a show selection (ordinal, title, etc.) or a granular selection
      if (tvShowContext.searchResults.length > 1) {
        return await this.handleMultiShowSelection(
          message,
          messages,
          tvShowContext,
          userId,
        )
      }

      // Single show selected - parse granular selection (seasons/episodes)
      return await this.handleGranularSelection(
        message,
        messages,
        tvShowContext,
        userId,
      )
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process TV show selection',
      )

      // Clear context on error
      await this.contextService.clearContext(userId)

      const errorResponse = await this.generateTvShowResponse(
        messages,
        'TV_SHOW_PROCESSING_ERROR',
        {
          errorMessage:
            'Had trouble processing your selection. Please try searching again.',
        },
      )

      return buildResponse(messages, errorResponse)
    }
  }

  /**
   * Handle new TV show delete request
   *
   * Complex flow due to granular selection requirements:
   * - Single result + granular selection → auto-delete
   * - Single result without selection → ask for granular
   * - Multiple results + both selections → auto-delete
   * - Multiple results + partial selections → ask for missing
   */
  async handleDelete(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<MediaOperationResponse> {
    this.logger.log(
      { userId, content: message.content },
      'Starting new TV show delete',
    )

    // Parse both search query and selection criteria upfront
    const messageContent = extractMessageContent(message)
    const { searchQuery, selection, tvSelection } =
      await this.parseInitialSelection(messageContent)

    if (!searchQuery.trim()) {
      const clarificationResponse = await this.generateTvShowDeleteResponse(
        messages,
        'TV_SHOW_DELETE_CLARIFICATION',
      )
      return buildResponse(messages, clarificationResponse)
    }

    try {
      // Search library for TV shows using SonarrService
      const libraryResults =
        await this.sonarrService.getLibrarySeries(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: libraryResults.length,
          hasSelection: !!selection,
          hasGranularSelection: !!tvSelection?.selection,
        },
        'TV show library search for delete completed',
      )

      if (libraryResults.length === 0) {
        const noResultsResponse = await this.generateTvShowDeleteResponse(
          messages,
          'TV_SHOW_DELETE_NO_RESULTS',
          { searchQuery },
        )
        return buildResponse(messages, noResultsResponse)
      }

      // Smart auto-selection for complete delete specifications
      if (
        selection &&
        (selection.selectionType === 'ordinal' ||
          selection.selectionType === 'year') &&
        tvSelection &&
        Object.prototype.hasOwnProperty.call(tvSelection, 'selection') &&
        libraryResults.length > 0
      ) {
        const autoDeleteResult = await this.tryAutoCompleteDelete(
          selection,
          tvSelection,
          libraryResults,
          userId,
          message,
          messages,
        )

        if (autoDeleteResult) {
          return autoDeleteResult
        }
      }

      // Handle single result
      if (libraryResults.length === 1) {
        return await this.handleSingleDeleteResult(
          libraryResults[0],
          tvSelection,
          searchQuery,
          selection,
          userId,
          message,
          messages,
        )
      }

      // Handle multiple results with context storage
      return await this.handleMultipleDeleteResults(
        libraryResults,
        searchQuery,
        selection,
        tvSelection,
        userId,
        messages,
      )
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, searchQuery },
        'Failed to search library for TV show delete',
      )

      const errorResponse = await this.generateTvShowDeleteResponse(
        messages,
        'TV_SHOW_DELETE_ERROR',
        {
          searchQuery,
          errorMessage: `Couldn't search library for "${searchQuery}" right now. The Sonarr service might be unavailable.`,
        },
      )

      return buildResponse(messages, errorResponse)
    }
  }

  /**
   * Handle TV show delete selection
   *
   * Complex multi-turn conversation handling:
   * - Parse combined selections (show + granular)
   * - Validate required selections are present
   * - Merge with stored context selections if needed
   */
  async handleDeleteSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    tvShowDeleteContext: TvShowDeleteContext,
    userId: string,
  ): Promise<MediaOperationResponse> {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing TV show delete selection',
    )

    try {
      // Check if this is a show selection or a granular selection
      if (tvShowDeleteContext.searchResults.length > 1) {
        return await this.handleMultiShowDeleteSelection(
          message,
          messages,
          tvShowDeleteContext,
          userId,
        )
      }

      // Single show - parse granular selection
      return await this.handleGranularDeleteSelection(
        message,
        messages,
        tvShowDeleteContext,
        userId,
      )
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process TV show delete selection',
      )

      // Clear context on error
      await this.contextService.clearContext(userId)

      const errorResponse = await this.generateTvShowDeleteResponse(
        messages,
        'TV_SHOW_DELETE_PROCESSING_ERROR',
        {
          errorMessage:
            'Had trouble processing your selection. Please try searching again.',
        },
      )

      return buildResponse(messages, errorResponse)
    }
  }

  // Private helper methods

  /**
   * Handle multiple show selection (first phase of 2-phase selection)
   */
  private async handleMultiShowSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    tvShowContext: TvShowSelectionContext,
    userId: string,
  ): Promise<MediaOperationResponse> {
    const messageContent = extractMessageContent(message)
    const searchSelection = await parseSearchSelection(
      messageContent,
      this.getReasoningModel(),
      this.retryService,
      MOVIE_SELECTION_PARSING_PROMPT,
      this.logger,
    ).catch(() => null)

    if (!searchSelection) {
      const clarificationResponse = await this.generateTvShowResponse(
        messages,
        'TV_SHOW_SELECTION_NEEDED',
        {
          searchQuery: tvShowContext.query,
          shows: tvShowContext.searchResults,
        },
      )
      return buildResponse(messages, clarificationResponse)
    }

    const selectedShow = findSelectedMediaItem(
      searchSelection,
      tvShowContext.searchResults,
      this.logger,
      'TV show search results',
    )

    if (!selectedShow) {
      const clarificationResponse = await this.generateTvShowResponse(
        messages,
        'TV_SHOW_SELECTION_NEEDED',
        {
          searchQuery: tvShowContext.query,
          shows: tvShowContext.searchResults,
        },
      )
      return buildResponse(messages, clarificationResponse)
    }

    // Show selected - check if we have stored granular selection to apply
    if (
      tvShowContext.originalTvSelection &&
      Object.prototype.hasOwnProperty.call(
        tvShowContext.originalTvSelection,
        'selection',
      )
    ) {
      this.logger.log(
        {
          userId,
          tvdbId: selectedShow.tvdbId,
          originalTvSelection: tvShowContext.originalTvSelection,
        },
        'Auto-applying stored granular selection after show selection',
      )

      await this.contextService.clearContext(userId)
      return await this.downloadTvShow(
        selectedShow,
        tvShowContext.originalTvSelection,
        message,
        messages,
        userId,
      )
    }

    // No stored granular selection - ask user for it
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
    await this.contextService.setContext(userId, 'tv_selection', updatedContext)

    const granularSelectionResponse = await this.generateTvShowResponse(
      messages,
      'TV_SHOW_SELECTION_NEEDED',
      { searchQuery: tvShowContext.query, shows: [selectedShow] },
    )

    return buildResponse(messages, granularSelectionResponse)
  }

  /**
   * Handle granular selection (seasons/episodes) for a single show
   */
  private async handleGranularSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    tvShowContext: TvShowSelectionContext,
    userId: string,
  ): Promise<MediaOperationResponse> {
    const messageContent = extractMessageContent(message)
    const tvShowSelection = await this.parseTvShowSelection(
      messageContent,
    ).catch(() => null)

    this.logger.log(
      { userId, selection: tvShowSelection },
      'Parsed TV show selection',
    )

    if (!tvShowSelection) {
      const granularSelectionResponse = await this.generateTvShowResponse(
        messages,
        'TV_SHOW_SELECTION_NEEDED',
        {
          searchQuery: tvShowContext.query,
          shows: tvShowContext.searchResults,
        },
      )
      return buildResponse(messages, granularSelectionResponse)
    }

    const selectedShow = tvShowContext.searchResults[0]

    await this.contextService.clearContext(userId)
    return await this.downloadTvShow(
      selectedShow,
      tvShowSelection,
      message,
      messages,
      userId,
    )
  }

  /**
   * Handle multiple show delete selection
   */
  private async handleMultiShowDeleteSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    tvShowDeleteContext: TvShowDeleteContext,
    userId: string,
  ): Promise<MediaOperationResponse> {
    const messageContent = extractMessageContent(message)
    const searchSelection = await parseSearchSelection(
      messageContent,
      this.getReasoningModel(),
      this.retryService,
      MOVIE_SELECTION_PARSING_PROMPT,
      this.logger,
    ).catch(() => null)

    if (!searchSelection) {
      const clarificationResponse = await this.generateTvShowDeleteResponse(
        messages,
        'TV_SHOW_DELETE_NEED_RESULT_SELECTION',
        {
          searchResults: tvShowDeleteContext.searchResults,
          searchQuery: tvShowDeleteContext.query,
        },
      )
      return buildResponse(messages, clarificationResponse)
    }

    const selectedShow = findSelectedMediaItem(
      searchSelection,
      tvShowDeleteContext.searchResults,
      this.logger,
      'TV show library results',
    )

    if (!selectedShow) {
      const clarificationResponse = await this.generateTvShowDeleteResponse(
        messages,
        'TV_SHOW_DELETE_NEED_RESULT_SELECTION',
        {
          searchResults: tvShowDeleteContext.searchResults,
          searchQuery: tvShowDeleteContext.query,
        },
      )
      return buildResponse(messages, clarificationResponse)
    }

    // Show selected - check if we have stored granular selection to apply
    if (
      tvShowDeleteContext.originalTvSelection &&
      Object.prototype.hasOwnProperty.call(
        tvShowDeleteContext.originalTvSelection,
        'selection',
      )
    ) {
      this.logger.log(
        {
          userId,
          tvdbId: selectedShow.tvdbId,
          originalTvSelection: tvShowDeleteContext.originalTvSelection,
        },
        'Auto-applying stored granular selection after show delete selection',
      )

      await this.contextService.clearContext(userId)
      return await this.deleteTvShow(
        selectedShow,
        tvShowDeleteContext.originalTvSelection,
        message,
        messages,
        userId,
      )
    }

    // No stored granular selection - ask user for it
    const updatedContext = {
      ...tvShowDeleteContext,
      searchResults: [selectedShow],
    }
    await this.contextService.setContext(userId, 'tv_delete', updatedContext)

    const granularSelectionResponse = await this.generateTvShowDeleteResponse(
      messages,
      'TV_SHOW_DELETE_NEED_SERIES_SELECTION',
      { selectedShow },
    )

    return buildResponse(messages, granularSelectionResponse)
  }

  /**
   * Handle granular delete selection for a single show
   */
  private async handleGranularDeleteSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    tvShowDeleteContext: TvShowDeleteContext,
    userId: string,
  ): Promise<MediaOperationResponse> {
    const messageContent = extractMessageContent(message)
    const tvShowSelection = await this.parseTvShowSelection(
      messageContent,
    ).catch(() => null)

    this.logger.log(
      { userId, selection: tvShowSelection },
      'Parsed TV show delete selection',
    )

    if (!tvShowSelection) {
      const granularSelectionResponse = await this.generateTvShowDeleteResponse(
        messages,
        'TV_SHOW_DELETE_NEED_SERIES_SELECTION',
        { selectedShow: tvShowDeleteContext.searchResults[0] },
      )
      return buildResponse(messages, granularSelectionResponse)
    }

    const selectedShow = tvShowDeleteContext.searchResults[0]

    await this.contextService.clearContext(userId)
    return await this.deleteTvShow(
      selectedShow,
      tvShowSelection,
      message,
      messages,
      userId,
    )
  }

  /**
   * Try auto-selection with complete specification (show + granular)
   */
  private async tryAutoCompleteSelection(
    selection: SearchSelection,
    tvSelection: TvShowSelection,
    searchResults: SeriesSearchResult[],
    userId: string,
    messages: BaseMessage[],
  ): Promise<MediaOperationResponse | null> {
    const selectedShow = findSelectedMediaItem(
      selection,
      searchResults,
      this.logger,
      'TV show complete specification',
    )
    if (!selectedShow) {
      this.logger.warn(
        { userId, selection, searchResultsCount: searchResults.length },
        'Could not find selected show from complete specification, falling back to list',
      )
      return null
    }

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

    const response = await this.generateTvShowResponse(
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

    const downloadResult = await this.sonarrService.monitorAndDownloadSeries(
      selectedShow.tvdbId,
      tvSelection,
    )

    if (!downloadResult.success) {
      const errorResponse = await this.generateTvShowResponse(
        messages,
        'TV_SHOW_ERROR',
        {
          selectedShow,
          errorMessage: `Failed to add "${selectedShow.title}" to downloads: ${downloadResult.error}`,
        },
      )
      return buildResponse(messages, errorResponse)
    }

    return buildResponse(messages, response)
  }

  /**
   * Try auto-selection with show-only (partial specification)
   */
  private async tryAutoShowSelection(
    selection: SearchSelection,
    tvSelection: TvShowSelection | null,
    searchResults: SeriesSearchResult[],
    searchQuery: string,
    userId: string,
    messages: BaseMessage[],
  ): Promise<MediaOperationResponse | null> {
    const selectedShow = findSelectedMediaItem(
      selection,
      searchResults,
      this.logger,
      'TV show auto-selection',
    )
    if (!selectedShow) {
      this.logger.warn(
        { userId, selection, searchResultsCount: searchResults.length },
        'Could not find selected show from ordinal/year selection, falling back to list',
      )
      return null
    }

    this.logger.log(
      {
        userId,
        tvdbId: selectedShow.tvdbId,
        selectionType: selection.selectionType,
        selectionValue: selection.value,
      },
      'Auto-selecting TV show for granular selection phase',
    )

    const tvShowContext: TvShowSelectionContext = {
      searchResults: [selectedShow],
      query: searchQuery,
      timestamp: Date.now(),
      isActive: true,
      originalSearchSelection: selection,
      originalTvSelection: tvSelection || undefined,
    }

    await this.contextService.setContext(userId, 'tv_selection', tvShowContext)

    const granularSelectionResponse = await this.generateTvShowResponse(
      messages,
      'TV_SHOW_GRANULAR_SELECTION_NEEDED',
      { selectedShow },
    )

    return buildResponse(messages, granularSelectionResponse)
  }

  /**
   * Handle single search result
   */
  private async handleSingleSearchResult(
    show: SeriesSearchResult,
    tvSelection: TvShowSelection | null,
    searchQuery: string,
    selection: SearchSelection | null,
    userId: string,
    messages: BaseMessage[],
  ): Promise<MediaOperationResponse> {
    this.logger.log(
      { userId, tvdbId: show.tvdbId },
      'Single result found, checking for granular selection',
    )

    if (
      tvSelection &&
      Object.prototype.hasOwnProperty.call(tvSelection, 'selection')
    ) {
      this.logger.log(
        { userId, tvdbId: show.tvdbId },
        'Single show with granular selection, downloading directly',
      )

      const response = await this.generateTvShowResponse(
        messages,
        'TV_SHOW_SUCCESS',
        {
          selectedShow: show,
          downloadResult: {
            seriesAdded: true,
            seriesUpdated: false,
            searchTriggered: true,
          },
          autoApplied: true,
          granularSelection: tvSelection,
        },
      )

      const downloadResult = await this.sonarrService.monitorAndDownloadSeries(
        show.tvdbId,
        tvSelection,
      )

      if (!downloadResult.success) {
        const errorResponse = await this.generateTvShowResponse(
          messages,
          'TV_SHOW_ERROR',
          {
            selectedShow: show,
            errorMessage: `Failed to add "${show.title}" to downloads: ${downloadResult.error}`,
          },
        )
        return buildResponse(messages, errorResponse)
      }

      return buildResponse(messages, response)
    }

    // Store context and ask for granular selection
    const tvShowContext: TvShowSelectionContext = {
      searchResults: [show],
      query: searchQuery,
      timestamp: Date.now(),
      isActive: true,
      originalSearchSelection: selection || undefined,
      originalTvSelection: tvSelection || undefined,
    }

    await this.contextService.setContext(userId, 'tv_selection', tvShowContext)

    const selectionResponse = await this.generateTvShowResponse(
      messages,
      'TV_SHOW_SELECTION_NEEDED',
      { searchQuery, shows: [show] },
    )

    return buildResponse(messages, selectionResponse)
  }

  /**
   * Try auto-complete delete with full specification
   */
  private async tryAutoCompleteDelete(
    selection: SearchSelection,
    tvSelection: TvShowSelection,
    libraryResults: LibrarySearchResult[],
    userId: string,
    message: HumanMessage,
    messages: BaseMessage[],
  ): Promise<MediaOperationResponse | null> {
    const selectedShow = findSelectedMediaItem(
      selection,
      libraryResults,
      this.logger,
      'TV show library delete specification',
    )
    if (!selectedShow) {
      this.logger.warn(
        { userId, selection, searchResultsCount: libraryResults.length },
        'Could not find selected show from library specification, falling back to list',
      )
      return null
    }

    this.logger.log(
      {
        userId,
        tvdbId: selectedShow.tvdbId,
        selectionType: selection.selectionType,
        selectionValue: selection.value,
        tvSelection,
      },
      'Auto-applying complete TV show delete specification',
    )

    return await this.deleteTvShow(
      selectedShow,
      tvSelection,
      message,
      messages,
      userId,
    )
  }

  /**
   * Handle single delete result
   */
  private async handleSingleDeleteResult(
    show: LibrarySearchResult,
    tvSelection: TvShowSelection | null,
    searchQuery: string,
    selection: SearchSelection | null,
    userId: string,
    message: HumanMessage,
    messages: BaseMessage[],
  ): Promise<MediaOperationResponse> {
    this.logger.log(
      { userId, tvdbId: show.tvdbId },
      'Single result found in library for delete',
    )

    if (
      tvSelection &&
      Object.prototype.hasOwnProperty.call(tvSelection, 'selection')
    ) {
      this.logger.log(
        { userId, tvdbId: show.tvdbId },
        'Single show with granular selection, deleting directly',
      )

      return await this.deleteTvShow(
        show,
        tvSelection,
        message,
        messages,
        userId,
      )
    }

    // Store context and ask for granular selection
    const tvShowDeleteContext: TvShowDeleteContext = {
      searchResults: [show],
      query: searchQuery,
      timestamp: Date.now(),
      isActive: true,
      originalSearchSelection: selection || undefined,
      originalTvSelection: tvSelection || undefined,
    }

    await this.contextService.setContext(
      userId,
      'tv_delete',
      tvShowDeleteContext,
    )

    const selectionResponse = await this.generateTvShowDeleteResponse(
      messages,
      'TV_SHOW_DELETE_NEED_SERIES_SELECTION',
      { selectedShow: show },
    )

    return buildResponse(messages, selectionResponse)
  }

  /**
   * Handle multiple delete results
   */
  private async handleMultipleDeleteResults(
    libraryResults: LibrarySearchResult[],
    searchQuery: string,
    selection: SearchSelection | null,
    tvSelection: TvShowSelection | null,
    userId: string,
    messages: BaseMessage[],
  ): Promise<MediaOperationResponse> {
    const tvShowDeleteContext: TvShowDeleteContext = {
      searchResults: libraryResults.slice(0, MAX_SEARCH_RESULTS),
      query: searchQuery,
      timestamp: Date.now(),
      isActive: true,
      originalSearchSelection: selection || undefined,
      originalTvSelection: tvSelection || undefined,
    }

    await this.contextService.setContext(
      userId,
      'tv_delete',
      tvShowDeleteContext,
    )

    const selectionResponse = await this.generateTvShowDeleteResponse(
      messages,
      'TV_SHOW_DELETE_MULTIPLE_RESULTS_NEED_BOTH',
      {
        searchQuery,
        searchResults: libraryResults.slice(0, MAX_SEARCH_RESULTS),
      },
    )

    return buildResponse(messages, selectionResponse)
  }

  /**
   * Download a selected TV show
   */
  private async downloadTvShow(
    show: SeriesSearchResult,
    selection: TvShowSelection,
    _originalMessage: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<MediaOperationResponse> {
    return await executeMediaOperation(
      show,
      show =>
        this.sonarrService.monitorAndDownloadSeries(show.tvdbId, selection),
      (show, result) =>
        this.generateTvShowResponse(messages, 'TV_SHOW_SUCCESS', {
          selectedShow: show,
          downloadResult: result,
        }),
      (show, error) =>
        this.generateTvShowResponse(messages, 'TV_SHOW_ERROR', {
          selectedShow: show,
          errorMessage: error,
        }),
      messages,
      this.logger,
      userId,
      'download TV show',
    )
  }

  /**
   * Delete a TV show with validation gate
   */
  private async deleteTvShow(
    show: LibrarySearchResult,
    selection: TvShowSelection,
    _originalMessage: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<MediaOperationResponse> {
    // VALIDATION GATE: Ensure we have valid selection data before proceeding
    if (
      !selection ||
      !selection.selection ||
      selection.selection.length === 0
    ) {
      this.logger.error(
        {
          userId,
          showTitle: show.title,
          selection,
        },
        'VALIDATION GATE: Invalid TV selection provided to deleteTvShow',
      )

      const errorResponse = await this.generateTvShowDeleteResponse(
        messages,
        'TV_SHOW_DELETE_ERROR',
        {
          selectedShow: show,
          errorMessage: 'Invalid selection data - cannot proceed with deletion',
        },
      )

      return buildResponse(messages, errorResponse)
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

    return await executeMediaOperation(
      show,
      show =>
        this.sonarrService.unmonitorAndDeleteSeries(show.tvdbId, {
          selection: selection.selection,
          deleteFiles: true,
        }),
      (show, result) =>
        this.generateTvShowDeleteResponse(messages, 'TV_SHOW_DELETE_SUCCESS', {
          selectedShow: show,
          deleteResult: result,
        }),
      (show, error) =>
        this.generateTvShowDeleteResponse(messages, 'TV_SHOW_DELETE_ERROR', {
          selectedShow: show,
          errorMessage: error,
        }),
      messages,
      this.logger,
      userId,
      'delete TV show',
    )
  }

  /**
   * Parse initial selection from user message
   */
  private async parseInitialSelection(messageContent: string): Promise<{
    searchQuery: string
    selection: SearchSelection | null
    tvSelection: TvShowSelection | null
  }> {
    this.logger.log(
      { messageContent },
      'Parsing initial selection with search query and selection criteria',
    )

    try {
      const [searchQuery, searchSelection, tvSelection] = await Promise.all([
        extractSearchQueryWithLLM(
          messageContent,
          this.getReasoningModel(),
          this.retryService,
          EXTRACT_TV_SEARCH_QUERY_PROMPT,
          ['show', 'series', 'tv', 'television', 'the'],
          this.logger,
        ),
        parseSearchSelection(
          messageContent,
          this.getReasoningModel(),
          this.retryService,
          MOVIE_SELECTION_PARSING_PROMPT,
          this.logger,
        ).catch(() => null),
        this.parseTvShowSelection(messageContent).catch(() => null),
      ])

      this.logger.log(
        {
          searchQuery,
          searchSelection,
          tvSelection,
        },
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

      const searchQuery = await extractSearchQueryWithLLM(
        messageContent,
        this.getReasoningModel(),
        this.retryService,
        EXTRACT_TV_SEARCH_QUERY_PROMPT,
        ['show', 'series', 'tv', 'television', 'the'],
        this.logger,
      )
      return {
        searchQuery,
        selection: null,
        tvSelection: null,
      }
    }
  }

  /**
   * Parse TV show selection (seasons/episodes) from user message
   */
  private async parseTvShowSelection(
    selectionText: string,
  ): Promise<TvShowSelection> {
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
        RETRY_CONFIGS.DEFAULT,
        'OpenAI-parseTvShowSelection',
      )

      const rawResponse = response.content.toString()
      this.logger.log(
        { rawResponse, selectionText },
        'DEBUG: Raw LLM response for TV show selection parsing',
      )

      const parsed = JSON.parse(rawResponse)

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

  /**
   * Generate TV show response using PromptGenerationService
   */
  private async generateTvShowResponse(
    messages: BaseMessage[],
    situation:
      | 'TV_SHOW_CLARIFICATION'
      | 'TV_SHOW_NO_RESULTS'
      | 'TV_SHOW_SELECTION_NEEDED'
      | 'TV_SHOW_GRANULAR_SELECTION_NEEDED'
      | 'TV_SHOW_ERROR'
      | 'TV_SHOW_SUCCESS'
      | 'TV_SHOW_PROCESSING_ERROR',
    context?: {
      searchQuery?: string
      shows?: SeriesSearchResult[]
      selectedShow?: SeriesSearchResult
      errorMessage?: string
      downloadResult?: unknown
      autoApplied?: boolean
      selectionCriteria?: string
      granularSelection?: TvShowSelection | null
    },
  ): Promise<HumanMessage> {
    return this.promptService.generateTvShowPrompt(
      messages,
      this.getChatModel(),
      situation,
      context,
    )
  }

  /**
   * Generate TV show delete response using PromptGenerationService
   */
  private async generateTvShowDeleteResponse(
    messages: BaseMessage[],
    situation:
      | 'TV_SHOW_DELETE_CLARIFICATION'
      | 'TV_SHOW_DELETE_NO_RESULTS'
      | 'TV_SHOW_DELETE_MULTIPLE_RESULTS_NEED_BOTH'
      | 'TV_SHOW_DELETE_NEED_RESULT_SELECTION'
      | 'TV_SHOW_DELETE_NEED_SERIES_SELECTION'
      | 'TV_SHOW_DELETE_ERROR'
      | 'TV_SHOW_DELETE_SUCCESS'
      | 'TV_SHOW_DELETE_PROCESSING_ERROR',
    context?: {
      selectedShow?: LibrarySearchResult
      deleteResult?: unknown
      errorMessage?: string
      searchResults?: LibrarySearchResult[]
      searchQuery?: string
    },
  ): Promise<HumanMessage> {
    return this.promptService.generateTvShowDeletePrompt(
      messages,
      this.getChatModel(),
      situation,
      context
        ? {
            ...context,
            deleteResult: context.deleteResult as
              | UnmonitorAndDeleteSeriesResult
              | undefined,
          }
        : {},
    )
  }

  /**
   * Get reasoning model for LLM calls
   */
  private getReasoningModel() {
    return createReasoningModel(this.stateService, this.logger)
  }

  /**
   * Get chat model for response generation
   */
  private getChatModel() {
    return createChatModel(this.stateService, this.logger)
  }
}
