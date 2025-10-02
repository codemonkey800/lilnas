import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import { MAX_SEARCH_RESULTS } from 'src/constants/llm'
import { RadarrService } from 'src/media/services/radarr.service'
import {
  MovieLibrarySearchResult,
  MovieSearchResult,
} from 'src/media/types/radarr.types'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { MovieDeleteContext, MovieSelectionContext } from 'src/schemas/movie'
import {
  SearchSelection,
  SearchSelectionSchema,
} from 'src/schemas/search-selection'
import { StateService } from 'src/state/state.service'
import {
  EXTRACT_SEARCH_QUERY_PROMPT,
  MOVIE_SELECTION_PARSING_PROMPT,
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
  handleMultipleResults,
  handleSingleResult,
  tryAutoMediaSelection,
} from './utils/media-operations.utils'

/**
 * Service handling movie-specific operations including search, selection, and deletion.
 * Extracted from LLMService to provide focused movie functionality.
 */
@Injectable()
export class MovieOperationsService
  implements
    MediaOperationsInterface<
      MovieSelectionContext | MovieDeleteContext,
      MediaOperationResponse
    >
{
  private readonly logger = new Logger(MovieOperationsService.name)

  constructor(
    private readonly radarrService: RadarrService,
    private readonly contextService: ContextManagementService,
    private readonly promptService: PromptGenerationService,
    private readonly retryService: RetryService,
    private readonly stateService: StateService, // For model access temporarily
  ) {}

  /**
   * Handle new movie search request
   */
  async handleSearch(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<MediaOperationResponse> {
    this.logger.log(
      { userId, content: message.content },
      'Starting new movie search',
    )

    // Parse both search query and selection criteria upfront
    const messageContent = extractMessageContent(message)
    const { searchQuery, selection } =
      await this.parseInitialSelection(messageContent)

    // Validate search query
    const validation = await validateAndHandleSearchQuery(
      searchQuery,
      messages,
      () => this.generateMovieResponse(messages, 'clarification'),
    )
    if (!validation.isValid) {
      return validation.response!
    }

    try {
      // Search for movies using RadarrService
      const searchResults = await this.radarrService.searchMovies(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: searchResults.length,
          hasSelection: !!selection,
        },
        'Movie search completed',
      )

      if (searchResults.length === 0) {
        return await handleEmptyResults(
          'search',
          searchQuery,
          messages,
          context =>
            this.generateMovieResponse(messages, 'no_results', context),
        )
      }

      // Smart auto-selection
      const autoSelectionResult = await tryAutoMediaSelection(
        selection,
        searchResults,
        userId,
        messages,
        movie => this.radarrService.monitorAndDownloadMovie(movie.tmdbId),
        (movie, result, context) =>
          this.generateMovieResponse(messages, 'success', {
            selectedMovie: movie,
            downloadResult: result,
            autoApplied: context.autoApplied,
            selectionCriteria: context.selectionCriteria,
          }),
        (movie, error) =>
          this.generateMovieResponse(messages, 'error', {
            selectedMovie: movie,
            errorMessage: error,
          }),
        this.logger,
        'movie search results',
      )

      if (autoSelectionResult) {
        return autoSelectionResult
      }

      // Handle single result directly
      const singleResult = await handleSingleResult(
        searchResults,
        movie => this.downloadMovie(movie, message, messages, userId),
        this.logger,
        userId,
        'movie search',
      )
      if (singleResult) {
        return singleResult
      }

      // Handle multiple results with context storage
      return await handleMultipleResults(
        searchResults,
        searchQuery,
        userId,
        messages,
        'movie_selection',
        this.contextService,
        context =>
          this.generateMovieResponse(messages, 'multiple_results', {
            searchQuery: context.searchQuery,
            movies: context.items,
          }),
      )
    } catch (error) {
      return await handleOperationError(
        error,
        { operation: 'search for movies', userId, searchQuery },
        messages,
        errorMessage =>
          this.generateMovieResponse(messages, 'error', {
            searchQuery,
            errorMessage,
          }),
        this.logger,
      )
    }
  }

  /**
   * Handle movie selection from search results
   */
  async handleSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    movieContext: MovieSelectionContext,
    userId: string,
  ): Promise<MediaOperationResponse> {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing movie selection',
    )

    try {
      // Parse the user's selection using LLM
      const messageContent = extractMessageContent(message)
      const selection = await this.parseSearchSelection(messageContent).catch(
        () => null,
      )
      this.logger.log({ userId, selection }, 'Parsed movie selection')

      // If no selection was parsed, ask user to clarify
      if (!selection) {
        const clarificationResponse = await this.generateMovieResponse(
          messages,
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
      const selectedMovie = findSelectedMediaItem(
        selection,
        movieContext.searchResults,
        this.logger,
        'movie search results',
      )

      if (!selectedMovie) {
        const clarificationResponse = await this.generateMovieResponse(
          messages,
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

      // Clear context and download the movie
      await this.contextService.clearContext(userId)
      return await this.downloadMovie(selectedMovie, message, messages, userId)
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process movie selection',
      )

      // Clear context on error
      await this.contextService.clearContext(userId)

      const errorResponse = await this.generateMovieResponse(
        messages,
        'processing_error',
        {
          errorMessage:
            'Had trouble processing your selection. Please try searching again.',
        },
      )

      return buildResponse(messages, errorResponse)
    }
  }

  /**
   * Handle new movie delete request
   */
  async handleDelete(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<MediaOperationResponse> {
    this.logger.log(
      { userId, content: message.content },
      'Starting new movie delete',
    )

    // Parse both search query and selection criteria upfront
    const messageContent = extractMessageContent(message)
    const { searchQuery, selection } =
      await this.parseInitialSelection(messageContent)

    if (!searchQuery.trim()) {
      const clarificationResponse = await this.generateMovieDeleteResponse(
        messages,
        'clarification_delete',
      )
      return buildResponse(messages, clarificationResponse)
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
        const noResultsResponse = await this.generateMovieDeleteResponse(
          messages,
          'no_results_delete',
          { searchQuery },
        )
        return buildResponse(messages, noResultsResponse)
      }

      // Smart auto-selection: Apply when user provides explicit search selection (ordinal/year only) for movies
      const autoDeleteResult = await this.tryAutoDeleteSelection(
        selection,
        libraryResults,
        userId,
        message,
        messages,
      )

      if (autoDeleteResult) {
        return autoDeleteResult
      }

      // Handle single result directly
      const singleResult = await this.handleSingleLibraryResult(
        libraryResults,
        message,
        messages,
        userId,
      )
      if (singleResult) {
        return singleResult
      }

      // Handle multiple results with context storage
      return await this.handleMultipleLibraryResults(
        libraryResults,
        searchQuery,
        userId,
        messages,
      )
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, searchQuery },
        'Failed to search library for movie delete',
      )

      const errorResponse = await this.generateMovieDeleteResponse(
        messages,
        'error_delete',
        {
          searchQuery,
          errorMessage: `Couldn't search library for "${searchQuery}" right now. The Radarr service might be unavailable.`,
        },
      )

      return buildResponse(messages, errorResponse)
    }
  }

  /**
   * Handle movie delete selection
   */
  async handleDeleteSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    movieDeleteContext: MovieDeleteContext,
    userId: string,
  ): Promise<MediaOperationResponse> {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing movie delete selection',
    )

    try {
      // Parse the user's selection using LLM
      const messageContent = extractMessageContent(message)
      const selection = await this.parseSearchSelection(messageContent).catch(
        () => null,
      )
      this.logger.log({ userId, selection }, 'Parsed movie delete selection')

      // If no selection was parsed, ask user to clarify
      if (!selection) {
        const clarificationResponse = await this.generateMovieDeleteResponse(
          messages,
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
      const selectedMovie = findSelectedMediaItem(
        selection,
        movieDeleteContext.searchResults,
        this.logger,
        'movie library results',
      )

      if (!selectedMovie) {
        const clarificationResponse = await this.generateMovieDeleteResponse(
          messages,
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

      const errorResponse = await this.generateMovieDeleteResponse(
        messages,
        'processing_error_delete',
        {
          errorMessage:
            'Had trouble processing your selection. Please try searching again.',
        },
      )

      return buildResponse(messages, errorResponse)
    }
  }

  /**
   * Download a selected movie using the utility
   */
  private async downloadMovie(
    movie: MovieSearchResult,
    _originalMessage: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<MediaOperationResponse> {
    return await executeMediaOperation(
      movie,
      movie => this.radarrService.monitorAndDownloadMovie(movie.tmdbId),
      (movie, result) =>
        this.generateMovieResponse(messages, 'success', {
          selectedMovie: movie,
          downloadResult: result,
        }),
      (movie, error) =>
        this.generateMovieResponse(messages, 'error', {
          selectedMovie: movie,
          errorMessage: error,
        }),
      messages,
      this.logger,
      userId,
      'download movie',
    )
  }

  /**
   * Delete a selected movie using the utility
   */
  private async deleteMovie(
    movie: MovieLibrarySearchResult,
    _originalMessage: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<MediaOperationResponse> {
    return await executeMediaOperation(
      movie,
      movie =>
        this.radarrService.unmonitorAndDeleteMovie(movie.tmdbId, {
          deleteFiles: true,
        }),
      (movie, result) =>
        this.generateMovieDeleteResponse(messages, 'success_delete', {
          selectedMovie: movie,
          deleteResult: result,
        }),
      (movie, error) =>
        this.generateMovieDeleteResponse(messages, 'error_delete', {
          selectedMovie: movie,
          errorMessage: error,
        }),
      messages,
      this.logger,
      userId,
      'delete movie',
    )
  }

  /**
   * Parse initial selection from user message
   */
  private async parseInitialSelection(messageContent: string): Promise<{
    searchQuery: string
    selection: SearchSelection | null
  }> {
    this.logger.log(
      { messageContent },
      'Parsing initial selection with search query and selection criteria',
    )

    try {
      // Parse search query and search selection in parallel for efficiency
      const [searchQuery, searchSelection] = await Promise.all([
        this.extractSearchQueryWithLLM(messageContent),
        this.parseSearchSelection(messageContent).catch(() => null),
      ])

      this.logger.log(
        {
          searchQuery,
          searchSelection,
        },
        'Parsed initial selection components',
      )

      return {
        searchQuery,
        selection: searchSelection,
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
      }
    }
  }

  /**
   * Extract search query from user message using LLM
   */
  private async extractSearchQueryWithLLM(content: string): Promise<string> {
    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            EXTRACT_SEARCH_QUERY_PROMPT,
            new HumanMessage({ id: nanoid(), content }),
          ]),
        RETRY_CONFIGS.DEFAULT,
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
   * Parse search selection from user message
   */
  private async parseSearchSelection(
    selectionText: string,
  ): Promise<SearchSelection> {
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
        RETRY_CONFIGS.DEFAULT,
        'OpenAI-parseSearchSelection',
      )

      const rawResponse = response.content.toString()
      this.logger.log(
        { rawResponse, selectionText },
        'DEBUG: Raw LLM response for search selection parsing',
      )

      const parsed = JSON.parse(rawResponse)
      const validatedResult = SearchSelectionSchema.parse(parsed)

      this.logger.log(
        { validatedResult },
        'DEBUG: Successfully parsed and validated search selection',
      )

      return validatedResult
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), selectionText },
        'DEBUG: Failed to parse search selection',
      )
      throw error
    }
  }

  /**
   * Generic movie finder that works with both search and library results
   */
  private findSelectedMovieGeneric<
    T extends { title: string; year?: number; tmdbId: number },
  >(selection: SearchSelection, movies: T[], logContext: string): T | null {
    const { selectionType, value } = selection

    this.logger.log(
      { selectionType, value, movieCount: movies.length },
      `Finding selected movie from ${logContext}`,
    )

    try {
      switch (selectionType) {
        case 'ordinal': {
          const index = parseInt(value) - 1
          if (index >= 0 && index < movies.length) {
            const selected = movies[index]
            this.logger.log(
              { index, selectedMovie: selected.title },
              `Found movie by ordinal selection from ${logContext}`,
            )
            return selected
          }
          break
        }

        case 'year': {
          const targetYear = parseInt(value)
          const found = movies.find(movie => movie.year === targetYear)
          if (found) {
            this.logger.log(
              { targetYear, selectedMovie: found.title },
              `Found movie by year selection from ${logContext}`,
            )
            return found
          }
          break
        }
      }

      this.logger.warn(
        { selection, movieCount: movies.length },
        `Could not find selected movie from criteria in ${logContext}`,
      )
      return null
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), selection },
        `Error finding selected movie in ${logContext}`,
      )
      return null
    }
  }

  /**
   * Find selected movie from search results
   */
  private findSelectedMovie(
    selection: SearchSelection,
    movies: MovieSearchResult[],
  ): MovieSearchResult | null {
    return this.findSelectedMovieGeneric(selection, movies, 'search results')
  }

  /**
   * Find selected movie from library search results
   */
  private findSelectedMovieFromLibrary(
    selection: SearchSelection,
    movies: MovieLibrarySearchResult[],
  ): MovieLibrarySearchResult | null {
    return this.findSelectedMovieGeneric(selection, movies, 'library results')
  }

  /**
   * Generate movie response using PromptGenerationService
   */
  private async generateMovieResponse(
    messages: BaseMessage[],
    situation:
      | 'clarification'
      | 'no_results'
      | 'multiple_results'
      | 'error'
      | 'success'
      | 'processing_error'
      | 'no_downloads',
    context?: {
      searchQuery?: string
      movies?: MovieSearchResult[]
      selectedMovie?: MovieSearchResult
      errorMessage?: string
      downloadResult?: unknown
      autoApplied?: boolean
      selectionCriteria?: string
    },
  ): Promise<HumanMessage> {
    return this.promptService.generateMoviePrompt(
      messages,
      this.getChatModel(),
      situation,
      context,
    )
  }

  /**
   * Generate movie delete response using PromptGenerationService
   */
  private async generateMovieDeleteResponse(
    messages: BaseMessage[],
    situation:
      | 'clarification_delete'
      | 'no_results_delete'
      | 'multiple_results_delete'
      | 'error_delete'
      | 'success_delete'
      | 'processing_error_delete',
    context?: {
      searchQuery?: string
      movies?: MovieLibrarySearchResult[]
      selectedMovie?: MovieLibrarySearchResult
      errorMessage?: string
      deleteResult?: unknown
      autoApplied?: boolean
      selectionCriteria?: string
    },
  ): Promise<HumanMessage> {
    return this.promptService.generateMovieDeletePrompt(
      messages,
      this.getChatModel(),
      situation,
      context,
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

  // Utility methods - using centralized utilities for most operations

  /**
   * Try auto-selection for search results
   */
  private async tryAutoSelection(
    selection: SearchSelection | null,
    searchResults: MovieSearchResult[],
    userId: string,
    messages: BaseMessage[],
  ): Promise<MediaOperationResponse | null> {
    if (
      !selection ||
      !(
        selection.selectionType === 'ordinal' ||
        selection.selectionType === 'year'
      ) ||
      searchResults.length === 0
    ) {
      return null
    }

    const selectedMovie = this.findSelectedMovie(selection, searchResults)
    if (!selectedMovie) {
      this.logger.warn(
        { userId, selection, searchResultsCount: searchResults.length },
        'Could not find selected movie from specification, falling back to list',
      )
      return null
    }

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

    // Generate acknowledgment message first
    const response = await this.generateMovieResponse(messages, 'success', {
      selectedMovie,
      downloadResult: { movieAdded: true, searchTriggered: true },
      autoApplied: true,
      selectionCriteria: `${selection.selectionType}: ${selection.value}`,
    })

    // Start download process
    const downloadResult = await this.radarrService.monitorAndDownloadMovie(
      selectedMovie.tmdbId,
    )

    if (!downloadResult.success) {
      // Override response with error if download failed
      const errorResponse = await this.generateMovieResponse(
        messages,
        'error',
        {
          selectedMovie,
          errorMessage: `Failed to add "${selectedMovie.title}" to downloads: ${downloadResult.error}`,
        },
      )
      return buildResponse(messages, errorResponse)
    }

    return buildResponse(messages, response)
  }

  /**
   * Try auto-selection for delete results
   */
  private async tryAutoDeleteSelection(
    selection: SearchSelection | null,
    libraryResults: MovieLibrarySearchResult[],
    userId: string,
    message: HumanMessage,
    messages: BaseMessage[],
  ): Promise<MediaOperationResponse | null> {
    if (
      !selection ||
      !(
        selection.selectionType === 'ordinal' ||
        selection.selectionType === 'year'
      ) ||
      libraryResults.length === 0
    ) {
      return null
    }

    const selectedMovie = this.findSelectedMovieFromLibrary(
      selection,
      libraryResults,
    )
    if (!selectedMovie) {
      this.logger.warn(
        { userId, selection, searchResultsCount: libraryResults.length },
        'Could not find selected movie from library specification, falling back to list',
      )
      return null
    }

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
    return await this.deleteMovie(selectedMovie, message, messages, userId)
  }

  /**
   * Handle single search result by downloading directly
   */
  private async handleSingleSearchResult(
    searchResults: MovieSearchResult[],
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<MediaOperationResponse | null> {
    if (searchResults.length !== 1) {
      return null
    }

    this.logger.log(
      { userId, tmdbId: searchResults[0].tmdbId },
      'Single result found, downloading directly',
    )
    return await this.downloadMovie(searchResults[0], message, messages, userId)
  }

  /**
   * Handle single library result by deleting directly
   */
  private async handleSingleLibraryResult(
    libraryResults: MovieLibrarySearchResult[],
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ): Promise<MediaOperationResponse | null> {
    if (libraryResults.length !== 1) {
      return null
    }

    this.logger.log(
      { userId, tmdbId: libraryResults[0].tmdbId },
      'Single result found in library, deleting directly',
    )
    return await this.deleteMovie(libraryResults[0], message, messages, userId)
  }

  /**
   * Handle multiple search results by storing context and asking for selection
   */
  private async handleMultipleSearchResults(
    searchResults: MovieSearchResult[],
    searchQuery: string,
    userId: string,
    messages: BaseMessage[],
  ): Promise<MediaOperationResponse> {
    const movieContext: MovieSelectionContext = {
      searchResults: searchResults.slice(0, MAX_SEARCH_RESULTS),
      query: searchQuery,
      timestamp: Date.now(),
      isActive: true,
    }

    await this.contextService.setContext(
      userId,
      'movie_selection',
      movieContext,
    )

    const selectionResponse = await this.generateMovieResponse(
      messages,
      'multiple_results',
      {
        searchQuery,
        movies: searchResults.slice(0, MAX_SEARCH_RESULTS),
      },
    )

    return buildResponse(messages, selectionResponse)
  }

  /**
   * Handle multiple library results by storing context and asking for selection
   */
  private async handleMultipleLibraryResults(
    libraryResults: MovieLibrarySearchResult[],
    searchQuery: string,
    userId: string,
    messages: BaseMessage[],
  ): Promise<MediaOperationResponse> {
    const movieDeleteContext: MovieDeleteContext = {
      searchResults: libraryResults.slice(0, MAX_SEARCH_RESULTS),
      query: searchQuery,
      timestamp: Date.now(),
      isActive: true,
    }

    await this.contextService.setContext(
      userId,
      'movie_delete',
      movieDeleteContext,
    )

    const selectionResponse = await this.generateMovieDeleteResponse(
      messages,
      'multiple_results_delete',
      {
        searchQuery,
        movies: libraryResults.slice(0, MAX_SEARCH_RESULTS),
      },
    )

    return buildResponse(messages, selectionResponse)
  }

  /**
   * Handle operation errors with consistent logging and response generation
   */
  private async handleOperationError(
    error: unknown,
    context: {
      operation: string
      userId?: string
      searchQuery?: string
      movieTitle?: string
    },
    messages: BaseMessage[],
    responseGenerator: (errorMessage: string) => Promise<HumanMessage>,
    fallbackMessage: string,
  ): Promise<MediaOperationResponse> {
    this.logger.error(
      { error: getErrorMessage(error), ...context },
      `Failed to ${context.operation}`,
    )

    const errorResponse = await responseGenerator(fallbackMessage)
    return buildResponse(messages, errorResponse)
  }
}
