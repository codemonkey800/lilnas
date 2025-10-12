import { HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'

import { RadarrService } from 'src/media/services/radarr.service'
import type { MovieSearchResult } from 'src/media/types/radarr.types'
import type {
  StrategyRequestParams,
  StrategyResult,
} from 'src/media-operations/request-handling/types'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { StateService } from 'src/state/state.service'

import { BaseMediaStrategy } from './base/base-media-strategy'
import { MAX_SEARCH_RESULTS } from './base/strategy.constants'
import type {
  MovieOperationState,
  MovieSelectionContext,
} from './base/strategy.types'

/**
 * Strategy for handling movie download requests.
 * Supports two flows:
 * 1. New Search: Initial movie search with optional auto-selection
 * 2. Selection: User selecting from previously shown search results
 *
 * Extracted from LLMService methods:
 * - handleNewMovieSearch() (lines 910-1084)
 * - handleMovieSelection() (lines 1086-1171)
 * - downloadMovie() (lines 1173-1233)
 */
@Injectable()
export class MovieDownloadStrategy extends BaseMediaStrategy {
  protected readonly logger = new Logger(MovieDownloadStrategy.name)
  protected readonly strategyName = 'MovieDownloadStrategy'

  constructor(
    private readonly radarrService: RadarrService,
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
   * Get the state service to use (params.state if provided, otherwise this.stateService)
   */
  private getStateService(state?: MovieOperationState): MovieOperationState {
    return (state || this.stateService) as MovieOperationState
  }

  /**
   * Handle movie download request.
   * Routes to either new search or selection handling based on context.
   */
  protected async executeRequest(
    params: StrategyRequestParams,
  ): Promise<StrategyResult> {
    const { message, messages, context, userId, state } = params

    this.logger.log(
      { userId, hasContext: !!context, strategy: this.strategyName },
      'Strategy execution started',
    )

    const operationState = state as MovieOperationState | undefined

    // If we have an active movie context, this is a selection
    const movieContext = context as MovieSelectionContext | undefined
    if (movieContext?.type === 'movie' && movieContext.isActive) {
      return await this.handleMovieSelection(
        message,
        messages,
        movieContext,
        userId,
        operationState,
      )
    }

    // Otherwise, it's a new search
    return await this.handleNewMovieSearch(
      message,
      messages,
      userId,
      operationState,
    )
  }

  /**
   * Handle new movie search with optional auto-selection.
   * Extracted from handleNewMovieSearch() in llm.service.ts (lines 910-1084)
   */
  private async handleNewMovieSearch(
    message: HumanMessage,
    messages: HumanMessage[],
    userId: string,
    state?: MovieOperationState,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, content: message.content },
      'Starting new movie search',
    )

    // Parse both search query and selection criteria upfront
    const messageContent = this.getMessageContent(message)
    const { searchQuery, selection } =
      await this.parsingUtilities.parseInitialSelection(messageContent)

    if (!searchQuery.trim()) {
      const clarificationResponse =
        await this.promptService.generateMoviePrompt(
          messages,
          this.getChatModel(),
          'clarification',
        )
      return {
        images: [],
        messages: messages.concat(clarificationResponse),
      }
    }

    try {
      // Search for movies using RadarrService
      const startTime = Date.now()
      const searchResults = await this.radarrService.searchMovies(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: searchResults.length,
          duration: Date.now() - startTime,
          hasSelection: !!selection,
        },
        'Movie search completed',
      )

      if (searchResults.length === 0) {
        const noResultsResponse = await this.promptService.generateMoviePrompt(
          messages,
          this.getChatModel(),
          'no_results',
          { searchQuery },
        )
        return {
          images: [],
          messages: messages.concat(noResultsResponse),
        }
      }

      // Smart auto-selection: Apply when user provides explicit search selection (ordinal/year only) for movies
      if (
        selection &&
        (selection.selectionType === 'ordinal' ||
          selection.selectionType === 'year') &&
        searchResults.length > 0
      ) {
        const selectedMovie = this.selectionUtilities.findSelectedMovie(
          selection,
          searchResults,
        )
        if (selectedMovie) {
          this.logger.log(
            {
              userId,
              tmdbId: selectedMovie.tmdbId,
              selectionType: selection.selectionType,
              selectionValue: selection.value,
              movieTitle: selectedMovie.title,
            },
            'Auto-applying movie selection (explicit search selection provided)',
          )

          // Generate acknowledgment message and download
          const response = await this.promptService.generateMoviePrompt(
            messages,
            this.getChatModel(),
            'success',
            {
              selectedMovie,
              downloadResult: { movieAdded: true, searchTriggered: true },
              autoApplied: true,
              selectionCriteria: `${selection.selectionType}: ${selection.value}`,
            },
          )

          // Start download process
          const downloadResult =
            await this.radarrService.monitorAndDownloadMovie(
              selectedMovie.tmdbId,
            )

          if (!downloadResult.success) {
            // Override response with error if download failed
            const errorResponse = await this.promptService.generateMoviePrompt(
              messages,
              this.getChatModel(),
              'error',
              {
                selectedMovie,
                errorMessage: `Failed to add "${selectedMovie.title}" to downloads: ${downloadResult.error}`,
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
            'Could not find selected movie from specification, falling back to list',
          )
        }
      }

      if (searchResults.length === 1) {
        // Only one result - download it directly
        this.logger.log(
          { userId, tmdbId: searchResults[0].tmdbId },
          'Single result found, downloading directly',
        )
        return await this.downloadMovie(
          searchResults[0],
          message,
          messages,
          userId,
        )
      }

      // Multiple results - store context and ask user to choose
      const movieContext = {
        type: 'movie' as const,
        searchResults: searchResults.slice(0, MAX_SEARCH_RESULTS),
        query: searchQuery,
        timestamp: Date.now(),
        isActive: true,
      }

      // Store in both StateService and ContextManagementService for proper context tracking
      this.getStateService(state).setUserMovieContext(userId, movieContext)
      await this.contextService.setContext(userId, 'movie', movieContext)

      this.logger.log(
        {
          userId,
          contextType: 'movie',
          resultCount: movieContext.searchResults.length,
        },
        'Created movie selection context for user',
      )

      // Create selection prompt
      const selectionResponse = await this.promptService.generateMoviePrompt(
        messages,
        this.getChatModel(),
        'multiple_results',
        {
          searchQuery,
          movies: searchResults.slice(0, MAX_SEARCH_RESULTS),
        },
      )

      return {
        images: [],
        messages: messages.concat(selectionResponse),
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, searchQuery },
        'Failed to search for movies',
      )

      const errorResponse = await this.promptService.generateMoviePrompt(
        messages,
        this.getChatModel(),
        'error',
        {
          searchQuery,
          errorMessage: `Couldn't search for "${searchQuery}" right now. The Radarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  /**
   * Handle user selection from previously shown movie search results.
   * Extracted from handleMovieSelection() in llm.service.ts (lines 1086-1171)
   */
  private async handleMovieSelection(
    message: HumanMessage,
    messages: HumanMessage[],
    movieContext: MovieSelectionContext,
    userId: string,
    state?: MovieOperationState,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing movie selection',
    )

    try {
      // Parse the user's selection using LLM
      const messageContent = this.getMessageContent(message)
      const selection = await this.parsingUtilities
        .parseSearchSelection(messageContent)
        .catch(() => null)
      this.logger.log({ userId, selection }, 'Parsed movie selection')

      // If no selection was parsed, ask user to clarify
      if (!selection) {
        const clarificationResponse =
          await this.promptService.generateMoviePrompt(
            messages,
            this.getChatModel(),
            'multiple_results',
            {
              searchQuery: movieContext.query,
              movies: movieContext.searchResults,
            },
          )
        return {
          images: [],
          messages: messages.concat(clarificationResponse),
        }
      }

      // Find the selected movie from context
      const selectedMovie = this.selectionUtilities.findSelectedMovie(
        selection,
        movieContext.searchResults,
      )

      if (!selectedMovie) {
        const clarificationResponse =
          await this.promptService.generateMoviePrompt(
            messages,
            this.getChatModel(),
            'multiple_results',
            {
              searchQuery: movieContext.query,
              movies: movieContext.searchResults,
            },
          )
        return {
          images: [],
          messages: messages.concat(clarificationResponse),
        }
      }

      // Clear context from both services and download the movie
      this.getStateService(state).clearUserMovieContext(userId)
      await this.contextService.clearContext(userId)
      this.logger.log({ userId }, 'Cleared movie context after selection')

      return await this.downloadMovie(selectedMovie, message, messages, userId)
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process movie selection',
      )

      // Clear context from both services on error
      this.getStateService(state).clearUserMovieContext(userId)
      await this.contextService.clearContext(userId)

      const errorResponse = await this.promptService.generateMoviePrompt(
        messages,
        this.getChatModel(),
        'processing_error',
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
   * Execute movie download via RadarrService.
   * Extracted from downloadMovie() in llm.service.ts (lines 1173-1233)
   */
  private async downloadMovie(
    movie: MovieSearchResult,
    _originalMessage: HumanMessage,
    messages: HumanMessage[],
    userId: string,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, movieTitle: movie.title, tmdbId: movie.tmdbId },
      'Attempting to download movie',
    )

    try {
      const startTime = Date.now()
      const result = await this.radarrService.monitorAndDownloadMovie(
        movie.tmdbId,
      )
      const duration = Date.now() - startTime

      if (result.success) {
        this.logger.log(
          { userId, movieTitle: movie.title, duration },
          'Movie download initiated successfully',
        )
        const successResponse = await this.promptService.generateMoviePrompt(
          messages,
          this.getChatModel(),
          'success',
          {
            selectedMovie: movie,
            downloadResult: result,
          },
        )

        return {
          images: [],
          messages: messages.concat(successResponse),
        }
      } else {
        const errorResponse = await this.promptService.generateMoviePrompt(
          messages,
          this.getChatModel(),
          'error',
          {
            selectedMovie: movie,
            errorMessage: `Failed to add "${movie.title}" to downloads: ${result.error}`,
          },
        )

        return {
          images: [],
          messages: messages.concat(errorResponse),
        }
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, movieTitle: movie.title },
        'Failed to download movie',
      )

      const errorResponse = await this.promptService.generateMoviePrompt(
        messages,
        this.getChatModel(),
        'error',
        {
          selectedMovie: movie,
          errorMessage: `Couldn't add "${movie.title}" to downloads. The Radarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }
}
