import { HumanMessage } from '@langchain/core/messages'
import { DownloadApiError } from '@lilnas/utils/download/client'
import {
  type DownloadJob,
  DownloadJobStatus,
  type QualityTier,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'

import { RadarrService } from 'src/media/services/radarr.service'
import type { MovieSearchResult } from 'src/media/types/radarr.types'
import { DownloadClientFactory } from 'src/media-operations/request-handling/download-client.factory'
import type {
  DiscordIdentity,
  StrategyRequestParams,
  StrategyResult,
} from 'src/media-operations/request-handling/types'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { SelectionUtilities } from 'src/media-operations/request-handling/utils/selection.utils'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { StateService } from 'src/state/state.service'
import { downloadApiErrorMessage } from 'src/utils/download-api-error'
import { withDownloadLinks } from 'src/utils/download-links'

import { BaseMediaStrategy } from './base/base-media-strategy'
import { MAX_SEARCH_RESULTS } from './base/strategy.constants'
import type { MovieSelectionContext } from './base/strategy.types'

/** What a movie request carries besides the movie itself. */
interface MovieRequestOptions {
  /** Who asked - the download app attributes the job to them. */
  discord: DiscordIdentity
  /** Absent means the download app's default tier. */
  qualityTier?: QualityTier
  /**
   * The ordinal/year the user picked the movie by in their own message
   * ("the 1999 one"), when it was auto-applied rather than chosen from a list
   */
  selectionCriteria?: string
}

/**
 * Strategy for handling movie download requests.
 * Supports two flows:
 * 1. New Search: Initial movie search with optional auto-selection
 * 2. Selection: User selecting from previously shown search results
 *
 * Search runs against Radarr directly; the request itself goes to the
 * download app (`POST /download/movies`), which owns adding, monitoring,
 * quality tiers and searching, and records who asked.
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
    private readonly downloadClientFactory: DownloadClientFactory,
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
   * Handle movie download request.
   * Routes to either new search or selection handling based on context.
   */
  protected async executeRequest(
    params: StrategyRequestParams,
  ): Promise<StrategyResult> {
    const { message, messages, context, userId, discord, qualityTier } = params

    this.logger.log(
      { userId, hasContext: !!context, strategy: this.strategyName },
      'Strategy execution started',
    )

    // If we have an active movie context, this is a selection
    const movieContext = context as MovieSelectionContext | undefined
    if (movieContext?.type === 'movie' && movieContext.isActive) {
      return await this.handleMovieSelection(
        message,
        messages,
        movieContext,
        userId,
        // A tier named in the pick itself wins over one named with the search
        { discord, qualityTier: qualityTier ?? movieContext.qualityTier },
      )
    }

    // Otherwise, it's a new search
    return await this.handleNewMovieSearch(message, messages, userId, {
      discord,
      qualityTier,
    })
  }

  /**
   * Handle new movie search with optional auto-selection.
   * Extracted from handleNewMovieSearch() in llm.service.ts (lines 910-1084)
   */
  private async handleNewMovieSearch(
    message: HumanMessage,
    messages: HumanMessage[],
    userId: string,
    request: MovieRequestOptions,
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

          return await this.downloadMovie(selectedMovie, messages, userId, {
            ...request,
            selectionCriteria: `${selection.selectionType}: ${selection.value}`,
          })
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
          messages,
          userId,
          request,
        )
      }

      // Multiple results - store context and ask user to choose
      const movieContext: MovieSelectionContext = {
        type: 'movie',
        searchResults: searchResults.slice(0, MAX_SEARCH_RESULTS),
        query: searchQuery,
        timestamp: Date.now(),
        isActive: true,
        ...(request.qualityTier ? { qualityTier: request.qualityTier } : {}),
      }

      // Store context in ContextManagementService
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
    request: MovieRequestOptions,
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

      // Clear context and download the movie
      await this.contextService.clearContext(userId)
      this.logger.log({ userId }, 'Cleared movie context after selection')

      return await this.downloadMovie(selectedMovie, messages, userId, request)
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process movie selection',
      )

      // Clear context on error
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
   * Request `movie` from the download app as the Discord user who asked.
   *
   * The app answers with the job it created, which is usually still in
   * flight (`requested`/`searching`) - so the reply says the movie was
   * requested, never that it downloaded. A job can also come back already
   * terminal: `completed` when the movie was already downloaded, or
   * `failed`/`not_found` when the request went nowhere. Every job reply links
   * the job's title page, where a failed request can be retried.
   */
  private async downloadMovie(
    movie: MovieSearchResult,
    messages: HumanMessage[],
    userId: string,
    request: MovieRequestOptions,
  ): Promise<StrategyResult> {
    const { discord, qualityTier } = request

    this.logger.log(
      { userId, movieTitle: movie.title, tmdbId: movie.tmdbId, qualityTier },
      'Requesting movie from the download app',
    )

    let job: DownloadJob
    try {
      const startTime = Date.now()
      job = await this.downloadClientFactory.forDiscord(discord).requestMovie({
        tmdbId: movie.tmdbId,
        // Omitted, not `undefined`, when absent - the server's default applies
        ...(qualityTier ? { qualityTier } : {}),
      })
      this.logger.log(
        {
          userId,
          movieTitle: movie.title,
          jobId: job.id,
          status: job.status,
          duration: Date.now() - startTime,
        },
        'Movie requested',
      )
    } catch (error) {
      const reason = downloadApiErrorMessage(error)
      this.logger.error(
        { error: reason, userId, movieTitle: movie.title },
        'Failed to request movie',
      )

      // No job was created, so there is nothing to link to
      const errorResponse = await this.promptService.generateMoviePrompt(
        messages,
        this.getChatModel(),
        'error',
        {
          selectedMovie: movie,
          errorMessage:
            error instanceof DownloadApiError
              ? `Couldn't request "${movie.title}": ${reason}`
              : `Couldn't request "${movie.title}" - the download app might be unavailable (${reason}).`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }

    const response = await this.replyForJob(job, movie, messages, request)

    return {
      images: [],
      messages: messages.concat(
        withDownloadLinks(response, job.media, job.media.title),
      ),
    }
  }

  /** The reply for the job a request came back with, by where it stands. */
  private replyForJob(
    job: DownloadJob,
    movie: MovieSearchResult,
    messages: HumanMessage[],
    { selectionCriteria }: MovieRequestOptions,
  ): Promise<HumanMessage> {
    const title = job.media.title

    switch (job.status) {
      case DownloadJobStatus.Completed:
        return this.promptService.generateMoviePrompt(
          messages,
          this.getChatModel(),
          'already_downloaded',
          { selectedMovie: movie },
        )
      case DownloadJobStatus.Failed:
        return this.promptService.generateMoviePrompt(
          messages,
          this.getChatModel(),
          'error',
          {
            selectedMovie: movie,
            errorMessage: `Requested "${title}", but the request failed: ${job.error ?? 'no reason was given'}.`,
          },
        )
      case DownloadJobStatus.NotFound:
        return this.promptService.generateMoviePrompt(
          messages,
          this.getChatModel(),
          'error',
          {
            selectedMovie: movie,
            errorMessage: `Requested "${title}", but no release was found for it${job.statusNote ? ` (${job.statusNote})` : ''}.`,
          },
        )
      case DownloadJobStatus.Cancelled:
        return this.promptService.generateMoviePrompt(
          messages,
          this.getChatModel(),
          'error',
          {
            selectedMovie: movie,
            errorMessage: `The request for "${title}" was cancelled before it got anywhere.`,
          },
        )
      default:
        return this.promptService.generateMoviePrompt(
          messages,
          this.getChatModel(),
          'success',
          {
            selectedMovie: movie,
            statusNote: job.statusNote,
            autoApplied: selectionCriteria !== undefined,
            selectionCriteria,
          },
        )
    }
  }
}
