import { HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'

import { RadarrService } from 'src/media/services/radarr.service'
import type { MovieLibrarySearchResult } from 'src/media/types/radarr.types'
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
import type { MovieDeleteContext } from './base/strategy.types'

/**
 * Strategy for handling movie deletion requests.
 * Supports two flows:
 * 1. New Delete: Search library for movies to delete
 * 2. Selection: User selecting from previously shown library results
 *
 * Extracted from LLMService methods:
 * - handleNewMovieDelete() (lines 1312-1464)
 * - handleMovieDeleteSelection() (lines 1466-1553)
 * - deleteMovie() (lines 2052-2118)
 */
@Injectable()
export class MovieDeleteStrategy extends BaseMediaStrategy {
  protected readonly logger = new Logger(MovieDeleteStrategy.name)
  protected readonly strategyName = 'MovieDeleteStrategy'

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
   * Handle movie delete request.
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

    // If we have an active movie delete context, this is a selection
    const movieDeleteContext = context as MovieDeleteContext | undefined
    if (
      movieDeleteContext?.type === 'movieDelete' &&
      movieDeleteContext.isActive
    ) {
      return await this.handleMovieDeleteSelection(
        message,
        messages,
        movieDeleteContext,
        userId,
      )
    }

    // Otherwise, it's a new delete request
    return await this.handleNewMovieDelete(message, messages, userId)
  }

  /**
   * Handle new movie delete request - search library.
   * Extracted from handleNewMovieDelete() in llm.service.ts (lines 1312-1464)
   */
  private async handleNewMovieDelete(
    message: HumanMessage,
    messages: HumanMessage[],
    userId: string,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, content: message.content },
      'Starting new movie delete',
    )

    // Parse both search query and selection criteria upfront
    const messageContent = this.getMessageContent(message)
    const { searchQuery, selection } =
      await this.parsingUtilities.parseInitialSelection(messageContent)

    if (!searchQuery.trim()) {
      const clarificationResponse =
        await this.promptService.generateMovieDeletePrompt(
          messages,
          this.getChatModel(),
          'clarification_delete',
        )
      return {
        images: [],
        messages: messages.concat(clarificationResponse),
      }
    }

    try {
      // Search library for movies using RadarrService
      const libraryResults =
        await this.radarrService.getLibraryMovies(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: libraryResults.length,
          hasSelection: !!selection,
        },
        'Movie library search for delete completed',
      )

      if (libraryResults.length === 0) {
        const noResultsResponse =
          await this.promptService.generateMovieDeletePrompt(
            messages,
            this.getChatModel(),
            'no_results_delete',
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
        libraryResults.length > 0
      ) {
        const selectedMovie =
          this.selectionUtilities.findSelectedMovieFromLibrary(
            selection,
            libraryResults,
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
            'Auto-applying movie selection for delete (explicit search selection provided)',
          )

          // Clear any existing context and delete the movie directly
          await this.contextService.clearContext(userId)
          return await this.deleteMovie(
            selectedMovie,
            message,
            messages,
            userId,
          )
        } else {
          this.logger.warn(
            { userId, selection, searchResultsCount: libraryResults.length },
            'Could not find selected movie from library specification, falling back to list',
          )
        }
      }

      if (libraryResults.length === 1) {
        // Only one result - delete it directly
        this.logger.log(
          { userId, tmdbId: libraryResults[0].tmdbId },
          'Single result found in library, deleting directly',
        )
        return await this.deleteMovie(
          libraryResults[0],
          message,
          messages,
          userId,
        )
      }

      // Multiple results - store context and ask user to choose
      const movieDeleteContext = {
        type: 'movieDelete' as const,
        searchResults: libraryResults.slice(0, MAX_SEARCH_RESULTS),
        query: searchQuery,
        timestamp: Date.now(),
        isActive: true,
      }

      // Store context in ContextManagementService
      await this.contextService.setContext(
        userId,
        'movieDelete',
        movieDeleteContext,
      )

      // Create selection prompt
      const selectionResponse =
        await this.promptService.generateMovieDeletePrompt(
          messages,
          this.getChatModel(),
          'multiple_results_delete',
          {
            searchQuery,
            movies: libraryResults.slice(0, MAX_SEARCH_RESULTS),
          },
        )

      return {
        images: [],
        messages: messages.concat(selectionResponse),
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, searchQuery },
        'Failed to search library for movie delete',
      )

      const errorResponse = await this.promptService.generateMovieDeletePrompt(
        messages,
        this.getChatModel(),
        'error_delete',
        {
          searchQuery,
          errorMessage: `Couldn't search library for "${searchQuery}" right now. The Radarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  /**
   * Handle user selection from previously shown library results.
   * Extracted from handleMovieDeleteSelection() in llm.service.ts (lines 1466-1553)
   */
  private async handleMovieDeleteSelection(
    message: HumanMessage,
    messages: HumanMessage[],
    movieDeleteContext: MovieDeleteContext,
    userId: string,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing movie delete selection',
    )

    try {
      // Parse the user's selection using LLM
      const messageContent = this.getMessageContent(message)
      const selection = await this.parsingUtilities
        .parseSearchSelection(messageContent)
        .catch(() => null)
      this.logger.log({ userId, selection }, 'Parsed movie delete selection')

      // If no selection was parsed, ask user to clarify
      if (!selection) {
        const clarificationResponse =
          await this.promptService.generateMovieDeletePrompt(
            messages,
            this.getChatModel(),
            'multiple_results_delete',
            {
              searchQuery: movieDeleteContext.query,
              movies: movieDeleteContext.searchResults,
            },
          )
        return {
          images: [],
          messages: messages.concat(clarificationResponse),
        }
      }

      // Find the selected movie from context
      const selectedMovie =
        this.selectionUtilities.findSelectedMovieFromLibrary(
          selection,
          movieDeleteContext.searchResults,
        )

      if (!selectedMovie) {
        const clarificationResponse =
          await this.promptService.generateMovieDeletePrompt(
            messages,
            this.getChatModel(),
            'multiple_results_delete',
            {
              searchQuery: movieDeleteContext.query,
              movies: movieDeleteContext.searchResults,
            },
          )
        return {
          images: [],
          messages: messages.concat(clarificationResponse),
        }
      }

      // Clear context and delete the movie
      await this.contextService.clearContext(userId)
      return await this.deleteMovie(selectedMovie, message, messages, userId)
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process movie delete selection',
      )

      // Clear context on error
      await this.contextService.clearContext(userId)

      const errorResponse = await this.promptService.generateMovieDeletePrompt(
        messages,
        this.getChatModel(),
        'processing_error_delete',
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
   * Execute movie deletion via RadarrService.
   * Extracted from deleteMovie() in llm.service.ts (lines 2052-2118)
   */
  private async deleteMovie(
    movie: MovieLibrarySearchResult,
    _originalMessage: HumanMessage,
    messages: HumanMessage[],
    userId: string,
  ): Promise<StrategyResult> {
    this.logger.log(
      { userId, movieTitle: movie.title, tmdbId: movie.tmdbId },
      'Attempting to delete movie',
    )

    try {
      const result = await this.radarrService.unmonitorAndDeleteMovie(
        movie.tmdbId,
        { deleteFiles: true }, // Default to deleting files
      )

      if (result.success) {
        const successResponse =
          await this.promptService.generateMovieDeletePrompt(
            messages,
            this.getChatModel(),
            'success_delete',
            {
              selectedMovie: movie,
              deleteResult: result,
            },
          )

        return {
          images: [],
          messages: messages.concat(successResponse),
        }
      } else {
        const errorResponse =
          await this.promptService.generateMovieDeletePrompt(
            messages,
            this.getChatModel(),
            'error_delete',
            {
              selectedMovie: movie,
              errorMessage: `Failed to delete "${movie.title}": ${result.error}`,
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
        'Failed to delete movie',
      )

      const errorResponse = await this.promptService.generateMovieDeletePrompt(
        messages,
        this.getChatModel(),
        'error_delete',
        {
          selectedMovie: movie,
          errorMessage: `Couldn't delete "${movie.title}". The Radarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }
}
