import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import {
  ActionRowBuilder,
  type APIActionRowComponent,
  type APIMessageActionRowComponent,
  ButtonBuilder,
  EmbedBuilder,
  MessageActionRowComponentBuilder,
} from 'discord.js'

import {
  DEFAULT_DISPLAY_OPTIONS,
  getMediaTypeEmoji,
  isMediaSearchInteraction,
  MediaSearchAction,
  MediaSearchInteraction,
  MediaSearchInteractionContext,
  MediaSearchResponse,
  MediaSearchResult,
  MediaSearchState,
  parseCustomId,
  ParsedCustomId,
} from 'src/commands/media-search.types'
import { BaseMediaApiClient } from 'src/media/clients/base-media-api.client'
import { RadarrClient } from 'src/media/clients/radarr.client'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import {
  MediaApiError,
  MediaAuthenticationError,
  MediaNetworkError,
  MediaNotFoundApiError,
  MediaRateLimitError,
  MediaServiceUnavailableError,
  MediaValidationApiError,
} from 'src/media/errors/media-errors'
import { ComponentStateService } from 'src/media/services/component-state.service'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ComponentState } from 'src/types/discord.types'
import { EventType, MediaType } from 'src/types/enums'

// Interface for validation results
interface ValidationResult {
  isValid: boolean
  error: string
  userMessage: string
  details: Record<string, unknown>
}

@Injectable()
export class MediaSearchInteractionHandler {
  private readonly logger = new Logger(MediaSearchInteractionHandler.name)

  constructor(
    private readonly radarrClient: RadarrClient,
    private readonly componentStateService: ComponentStateService,
    private readonly buttonBuilder: ButtonBuilderService,
    private readonly mediaLogging: MediaLoggingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Handle /media search component interactions
   */
  async handleInteraction(
    interaction: MediaSearchInteraction,
    correlationId: string,
    stateId?: string,
  ): Promise<MediaSearchResponse> {
    const startTime = Date.now()

    try {
      // Validate interaction
      if (!isMediaSearchInteraction(interaction)) {
        throw new Error('Invalid /media search interaction')
      }

      // Parse custom ID to understand the action
      const parsedId = parseCustomId(interaction.customId)
      if (!parsedId) {
        throw new Error(`Unable to parse custom ID: ${interaction.customId}`)
      }

      this.logger.debug('Parsed custom ID for interaction', {
        customId: interaction.customId,
        parsedId,
        correlationId,
      })

      // Extract mediaId properly based on the action type
      let mediaId: string | undefined
      if (parsedId.action === 'media_action') {
        // For media_action format: media_action:correlationId:mediaType:mediaId:action
        // param0=mediaType, param1=mediaId, param2=action
        mediaId = parsedId.additionalData?.param1
      } else if (parsedId.action === 'request_action') {
        // For request_action format: request_action:correlationId:mediaType:mediaId
        // param0=mediaType, param1=mediaId
        mediaId = parsedId.additionalData?.param1
      } else {
        // Fallback to legacy behavior for other actions
        mediaId = parsedId.additionalData?.param1
      }

      // Create interaction context
      const context: MediaSearchInteractionContext = {
        interaction,
        correlationId: parsedId.correlationId,
        userId: interaction.user.id,
        action: this.mapActionFromCustomId(parsedId),
        mediaId: mediaId,
        page: this.extractPageNumber(parsedId),
        additionalParams: parsedId.additionalData,
      }

      this.logger.debug('Created interaction context', {
        correlationId: context.correlationId,
        action: context.action,
        mediaId: context.mediaId,
        userId: context.userId,
        parsedParams: parsedId.additionalData,
      })

      // Get component state using the provided stateId or fallback to legacy construction
      const resolvedStateId =
        stateId ||
        `${context.correlationId}:${interaction.message?.id || 'unknown'}`

      this.logger.debug('Looking up component state', {
        providedStateId: stateId,
        resolvedStateId,
        correlationId: context.correlationId,
        messageId: interaction.message?.id,
        customId: interaction.customId,
        usingFallback: !stateId,
      })

      const componentState =
        this.componentStateService.getComponentState(resolvedStateId)

      if (!componentState) {
        this.logger.warn('Component state not found', {
          providedStateId: stateId,
          resolvedStateId,
          correlationId: context.correlationId,
          messageId: interaction.message?.id,
          customId: interaction.customId,
          usingFallback: !stateId,
        })

        return {
          success: false,
          message:
            'This search session has expired. Please run the `/media search` command again.',
        }
      }

      this.logger.debug('Component state found successfully', {
        stateId: resolvedStateId,
        correlationId: context.correlationId,
        componentStateId: componentState.id,
        componentActive: componentState.state,
      })

      // Handle the specific action
      // Note: Interaction is already acknowledged in ComponentStateService
      const response = await this.handleSpecificAction(
        context,
        componentState,
        resolvedStateId,
      )

      // Log the interaction
      this.logger.debug('/media search interaction handled', {
        userId: context.userId,
        action: context.action,
        correlationId: context.correlationId,
        mediaId: context.mediaId,
        page: context.page,
        responseTime: Date.now() - startTime,
      })

      return response
    } catch (error) {
      // Enhanced error logging with detailed context
      const errorDetails = {
        correlationId,
        userId: interaction.user.id,
        username: interaction.user.username,
        guildId: interaction.guild?.id,
        channelId: interaction.channel?.id,
        customId: interaction.customId,
        messageId: interaction.message?.id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        errorCode: (error as Error & { code?: string })?.code || 'unknown',
        httpStatus: (error as Error & { status?: number })?.status || 'unknown',
        interactionType: interaction.constructor.name,
        phase: 'interaction_handling',
      }

      this.logger.error('/media search interaction failed', errorDetails)

      // Emit error event with enhanced details
      this.eventEmitter.emit(EventType.COMPONENT_ERROR, {
        correlationId,
        userId: interaction.user.id,
        error: error instanceof Error ? error : new Error(String(error)),
        phase: 'interaction_handling',
        context: errorDetails,
      })

      // Provide specific error messages based on error type
      let userMessage =
        'An error occurred while processing your request. Please try again.'

      if (error instanceof Error) {
        if (error.message.toLowerCase().includes('timeout')) {
          userMessage = 'The operation timed out. Please try again.'
        } else if (
          error.message.toLowerCase().includes('network') ||
          error.message.toLowerCase().includes('connect')
        ) {
          userMessage =
            'Cannot connect to the media server. Please try again later.'
        } else if (
          error.message.toLowerCase().includes('state') ||
          error.message.toLowerCase().includes('expired')
        ) {
          userMessage =
            'This search session has expired. Please run the `/media search` command again.'
        }
      }

      return {
        success: false,
        message: userMessage,
      }
    }
  }

  /**
   * Handle specific actions based on the interaction context
   */
  private async handleSpecificAction(
    context: MediaSearchInteractionContext,
    state: ComponentState,
    resolvedStateId: string,
  ): Promise<MediaSearchResponse> {
    const searchState = state.data as MediaSearchState

    switch (context.action) {
      case MediaSearchAction.PAGINATION_NEXT:
      case MediaSearchAction.PAGINATION_PREVIOUS:
      case MediaSearchAction.PAGINATION_FIRST:
      case MediaSearchAction.PAGINATION_LAST:
        return await this.handlePagination(
          context,
          searchState,
          resolvedStateId,
        )

      case MediaSearchAction.REQUEST_MEDIA:
        return await this.handleMediaRequest(context, searchState)

      case MediaSearchAction.PLAY_MEDIA:
        return await this.handlePlayMedia(context, searchState)

      case MediaSearchAction.NEW_SEARCH:
        return await this.handleNewSearch()

      case MediaSearchAction.CANCEL:
        return await this.handleCancel(context, resolvedStateId)

      case MediaSearchAction.UNMONITOR_MEDIA:
        return await this.handleUnmonitorMedia(context, searchState)

      default:
        return {
          success: false,
          message: `Unknown action: ${context.action}`,
        }
    }
  }

  /**
   * Handle pagination actions
   */
  private async handlePagination(
    context: MediaSearchInteractionContext,
    state: MediaSearchState,
    stateId: string,
  ): Promise<MediaSearchResponse> {
    let newPage = state.currentPage

    switch (context.action) {
      case MediaSearchAction.PAGINATION_FIRST:
        newPage = 0
        break
      case MediaSearchAction.PAGINATION_PREVIOUS:
        newPage = Math.max(0, state.currentPage - 1)
        break
      case MediaSearchAction.PAGINATION_NEXT:
        newPage = Math.min(state.totalPages - 1, state.currentPage + 1)
        break
      case MediaSearchAction.PAGINATION_LAST:
        newPage = state.totalPages - 1
        break
    }

    if (newPage === state.currentPage) {
      return { success: true, message: 'Already on the requested page' }
    }

    // Update the state
    const updatedState = { ...state, currentPage: newPage }

    // Create new components
    const components = this.createSearchResultsComponents(
      updatedState.results,
      newPage,
      updatedState.totalPages,
      context.correlationId,
    )

    // Create updated embed
    const embed = this.createSearchResultsEmbed(updatedState)

    // Update the message
    await context.interaction.editReply({
      embeds: [embed],
      components:
        components as unknown as APIActionRowComponent<APIMessageActionRowComponent>[],
    })

    // Update component state using the correct stateId
    await this.componentStateService.updateComponentState(
      stateId,
      updatedState,
      context.correlationId,
    )

    return {
      success: true,
      shouldUpdateMessage: true,
      updatedState: { currentPage: newPage },
    }
  }

  /**
   * Handle media request (add to library)
   */
  private async handleMediaRequest(
    context: MediaSearchInteractionContext,
    state: MediaSearchState,
  ): Promise<MediaSearchResponse> {
    const mediaId = context.mediaId
    if (!mediaId) {
      return { success: false, message: 'No media ID provided for request' }
    }

    const result = state.results.find(r => r.id === mediaId)
    if (!result) {
      return { success: false, message: 'Media not found in search results' }
    }

    try {
      // For now, only handle movies (Radarr)
      if (result.mediaType === MediaType.MOVIE && result.tmdbId) {
        if (!result.tmdbId) {
          return {
            success: false,
            message: 'Missing TMDB ID for this movie.',
          }
        }

        const addOptions = {
          monitored: true,
          title: result.title,
          year: result.year || new Date().getFullYear(),
          tmdbId: result.tmdbId,
          qualityProfileId: 1, // Default quality profile
          rootFolderPath: '/movies', // Default path
          addOptions: {
            searchForMovie: true,
          },
        }

        const success = await this.radarrClient.addMovie(
          addOptions,
          context.correlationId,
        )

        if (success) {
          // Emit media request event
          this.eventEmitter.emit(EventType.MEDIA_REQUESTED, {
            correlationId: context.correlationId,
            userId: context.userId,
            mediaType: result.mediaType,
            mediaId: result.id,
            title: result.title,
            year: result.year,
          })

          // Update the message to show download started
          await context.interaction.editReply({
            content: `🎬 **${result.title}** has been added to your library and is now downloading!`,
            embeds: [],
            components: [],
          })

          return {
            success: true,
            shouldUpdateMessage: true,
          }
        }
      }

      return {
        success: false,
        message: `❌ Failed to add **${result.title}** to library. Please try again later.`,
      }
    } catch (error) {
      this.logger.error('Failed to request media', {
        correlationId: context.correlationId,
        mediaId,
        error: error instanceof Error ? error.message : String(error),
      })

      return {
        success: false,
        message: `❌ An error occurred while adding **${result.title}** to library.`,
      }
    }
  }

  /**
   * Handle play media action
   */
  private async handlePlayMedia(
    context: MediaSearchInteractionContext,
    state: MediaSearchState,
  ): Promise<MediaSearchResponse> {
    const mediaId = context.mediaId
    if (!mediaId) {
      return { success: false, message: 'No media ID provided for playback' }
    }

    const result = state.results.find(r => r.id === mediaId)
    if (!result) {
      return { success: false, message: 'Media not found in search results' }
    }

    if (!result.inLibrary || !result.hasFile) {
      return {
        success: false,
        message: 'This media is not available for playback yet.',
      }
    }

    // Create Emby playback button
    const embyButton = this.buttonBuilder.createEmbyPlaybackButton(
      mediaId,
      result.mediaType,
      result.title,
    )

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      embyButton,
    )

    await context.interaction.editReply({
      content: `🎬 **${result.title}** is ready to play!`,
      components: [
        actionRow as unknown as APIActionRowComponent<APIMessageActionRowComponent>,
      ],
    })

    return { success: true, shouldUpdateMessage: true }
  }

  /**
   * Handle new search action
   */
  private async handleNewSearch(): Promise<MediaSearchResponse> {
    // This would typically show a modal for new search input
    // For now, just provide a message to use the slash command again
    return {
      success: true,
      message:
        'To start a new search, please use the `/media search` command again.',
    }
  }

  /**
   * Handle cancel action
   */
  private async handleCancel(
    context: MediaSearchInteractionContext,
    stateId: string,
  ): Promise<MediaSearchResponse> {
    try {
      // Always show clean cancellation message regardless of component state
      await context.interaction.editReply({
        content: '❌ /media search cancelled',
        embeds: [],
        components: [],
      })

      // Clean up the component state AFTER successful reply
      try {
        await this.componentStateService.cleanupComponent(
          stateId,
          'manual',
          context.correlationId,
        )
      } catch (cleanupError) {
        // Log cleanup failure but don't fail the cancel operation
        this.logger.warn('Component cleanup failed during cancel', {
          stateId,
          correlationId: context.correlationId,
          userId: context.userId,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        })
      }

      return { success: true, shouldUpdateMessage: true }
    } catch (error) {
      this.logger.error('Failed to cancel /media search', {
        correlationId: context.correlationId,
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
      })

      return {
        success: false,
        message: 'Failed to cancel /media search. Please try again.',
      }
    }
  }

  /**
   * Handle unmonitor media action (stop monitoring and delete files)
   */
  private async handleUnmonitorMedia(
    context: MediaSearchInteractionContext,
    state: MediaSearchState,
  ): Promise<MediaSearchResponse> {
    const mediaId = context.mediaId

    this.logger.debug('Starting unmonitor media operation', {
      correlationId: context.correlationId,
      userId: context.userId,
      mediaId,
      customId: context.interaction.customId,
    })

    // Step 1: Validate media ID is provided
    if (!mediaId) {
      const errorMsg = 'No media ID provided for unmonitoring'
      this.logger.warn('Unmonitor failed - no media ID', {
        correlationId: context.correlationId,
        userId: context.userId,
        customId: context.interaction.customId,
        phase: 'validation_media_id',
      })

      try {
        await context.interaction.editReply({
          content: `❌ ${errorMsg}`,
          embeds: [],
          components: [],
        })
      } catch (replyError) {
        this.logger.error(
          'Failed to send error response for missing media ID',
          {
            correlationId: context.correlationId,
            replyError:
              replyError instanceof Error
                ? replyError.message
                : String(replyError),
            phase: 'error_response_missing_id',
          },
        )
      }

      return {
        success: false,
        message: errorMsg,
      }
    }

    // Step 2: Find the movie in search results
    const result = state.results.find(r => r.id === mediaId)
    if (!result) {
      const errorMsg = 'Media not found in search results'
      this.logger.warn('Unmonitor failed - media not found', {
        correlationId: context.correlationId,
        userId: context.userId,
        mediaId,
        availableResults: state.results.map(r => ({
          id: r.id,
          title: r.title,
          radarrId: r.radarrId,
          inLibrary: r.inLibrary,
        })),
        phase: 'validation_media_lookup',
      })

      try {
        await context.interaction.editReply({
          content: `❌ ${errorMsg}`,
          embeds: [],
          components: [],
        })
      } catch (replyError) {
        this.logger.error('Failed to send error response for media not found', {
          correlationId: context.correlationId,
          replyError:
            replyError instanceof Error
              ? replyError.message
              : String(replyError),
          phase: 'error_response_not_found',
        })
      }

      return { success: false, message: errorMsg }
    }

    // Step 3: Enhanced data consistency validation
    const validationResult = this.validateUnmonitorMedia(
      result,
      context.correlationId,
    )
    if (!validationResult.isValid) {
      this.logger.warn('Unmonitor failed - validation error', {
        correlationId: context.correlationId,
        userId: context.userId,
        movieTitle: result.title,
        mediaId,
        validationError: validationResult.error,
        validationDetails: validationResult.details,
        phase: 'validation_consistency',
      })

      try {
        await context.interaction.editReply({
          content: `❌ ${validationResult.userMessage}`,
          embeds: [],
          components: [],
        })
      } catch (replyError) {
        this.logger.error('Failed to send validation error response', {
          correlationId: context.correlationId,
          replyError:
            replyError instanceof Error
              ? replyError.message
              : String(replyError),
          phase: 'error_response_validation',
        })
      }

      return {
        success: false,
        message: validationResult.userMessage,
      }
    }

    // Use Radarr internal ID for API operations
    // Validation above ensures radarrId is not undefined for movies in library
    const movieId = result.radarrId!

    try {
      this.logger.debug('Attempting to unmonitor and delete movie', {
        correlationId: context.correlationId,
        movieTitle: result.title,
        radarrId: movieId, // Radarr's internal ID for API operations
        displayId: mediaId, // Display ID (TMDB)
        tmdbId: result.tmdbId,
        userId: context.userId,
      })

      // Call Radarr to delete movie (true = delete files)
      await this.radarrClient.deleteMovie(
        movieId,
        true, // deleteFiles = true to remove monitoring AND delete files
        context.correlationId,
      )

      this.logger.debug('Successfully unmonitored and deleted movie', {
        correlationId: context.correlationId,
        movieTitle: result.title,
        radarrId: movieId,
        userId: context.userId,
      })

      // Update the message to show success with movie title
      try {
        await context.interaction.editReply({
          content: `🚫 **${result.title}** successfully removed from monitoring and files deleted.`,
          embeds: [],
          components: [],
        })
      } catch (replyError) {
        this.logger.error('Failed to send success response for unmonitor', {
          correlationId: context.correlationId,
          movieTitle: result.title,
          replyError:
            replyError instanceof Error
              ? replyError.message
              : String(replyError),
        })
        // Still return success since the operation succeeded
      }

      // Emit media event
      this.eventEmitter.emit(EventType.MEDIA_REQUESTED, {
        correlationId: context.correlationId,
        userId: context.userId,
        mediaType: MediaType.MOVIE,
        mediaId: mediaId, // Display ID
        title: result.title,
        action: 'unmonitor',
      })

      return {
        success: true,
        message: 'Movie successfully removed from monitoring and files deleted',
        shouldUpdateMessage: true,
      }
    } catch (error) {
      this.logger.error('Failed to unmonitor media', {
        correlationId: context.correlationId,
        movieTitle: result.title,
        radarrId: movieId, // Radarr's internal ID that was used
        displayId: mediaId, // Display ID (TMDB)
        tmdbId: result.tmdbId,
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        httpStatus:
          error instanceof MediaApiError ? error.httpStatus : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      })

      // Enhanced error handling using specific error types and HTTP status mapping
      let userMessage =
        'Failed to remove movie from monitoring. Please try again later.'
      let isRetryable = true

      if (error instanceof MediaNotFoundApiError) {
        userMessage =
          'Movie not found in Radarr (may have already been deleted)'
        isRetryable = false
      } else if (error instanceof MediaAuthenticationError) {
        userMessage =
          'Authentication failed with Radarr - check API configuration'
        isRetryable = false
      } else if (error instanceof MediaRateLimitError) {
        userMessage =
          'Too many requests to Radarr - please wait before trying again'
        isRetryable = true
      } else if (error instanceof MediaServiceUnavailableError) {
        userMessage =
          'Radarr service is temporarily unavailable - please try again later'
        isRetryable = true
      } else if (error instanceof MediaValidationApiError) {
        userMessage =
          'Invalid request to Radarr - please contact support if this persists'
        isRetryable = false
      } else if (error instanceof MediaNetworkError) {
        userMessage =
          'Network error connecting to Radarr - check service connectivity'
        isRetryable = true
      } else if (error instanceof MediaApiError) {
        // Use the enhanced HTTP status error mapping for comprehensive error details
        const httpStatus = error.httpStatus
        if (httpStatus) {
          const statusErrorInfo = BaseMediaApiClient.getHttpStatusErrorMessage(
            httpStatus,
            'DELETE /api/v3/movie',
            'Radarr',
          )
          userMessage = statusErrorInfo.message
          isRetryable = statusErrorInfo.isRetryable

          // Log additional diagnostic information
          this.logger.error(
            'Detailed HTTP error analysis for unmonitor operation',
            {
              correlationId: context.correlationId,
              movieTitle: result.title,
              radarrId: movieId,
              displayId: mediaId,
              httpStatus,
              statusErrorCategory: statusErrorInfo.category,
              suggestedActions: statusErrorInfo.suggestedActions,
              isRetryable: statusErrorInfo.isRetryable,
            },
          )
        }
      } else if (error instanceof Error) {
        // Fallback for generic errors with pattern matching
        const errorMessage = error.message.toLowerCase()
        if (
          errorMessage.includes('not found') ||
          errorMessage.includes('404')
        ) {
          userMessage =
            'Movie not found in Radarr (may have already been deleted)'
          isRetryable = false
        } else if (
          errorMessage.includes('network') ||
          errorMessage.includes('connect') ||
          errorMessage.includes('timeout')
        ) {
          userMessage = 'Failed to communicate with Radarr service'
          isRetryable = true
        } else if (
          errorMessage.includes('unauthorized') ||
          errorMessage.includes('401')
        ) {
          userMessage =
            'Authentication failed with Radarr - check API configuration'
          isRetryable = false
        } else if (
          errorMessage.includes('forbidden') ||
          errorMessage.includes('403')
        ) {
          userMessage = 'Access forbidden - insufficient permissions for Radarr'
          isRetryable = false
        }
      }

      // Log user-facing error result for monitoring
      this.logger.warn('User-facing error message for unmonitor operation', {
        correlationId: context.correlationId,
        movieTitle: result.title,
        radarrId: movieId,
        displayId: mediaId,
        userMessage,
        isRetryable,
        originalErrorType:
          error instanceof Error ? error.constructor.name : 'Unknown',
      })

      // Try to send error message to user
      try {
        await context.interaction.editReply({
          content: `❌ ${userMessage}`,
          embeds: [],
          components: [],
        })
      } catch (replyError) {
        this.logger.error(
          'Failed to send error response for unmonitor failure',
          {
            correlationId: context.correlationId,
            movieTitle: result.title,
            originalError:
              error instanceof Error ? error.message : String(error),
            replyError:
              replyError instanceof Error
                ? replyError.message
                : String(replyError),
          },
        )
      }

      return {
        success: false,
        message: userMessage,
        retryable: isRetryable,
      }
    }
  }

  /**
   * Create search results components with reorganized button layout
   */
  private createSearchResultsComponents(
    results: MediaSearchResult[],
    currentPage: number,
    totalPages: number,
    correlationId: string,
  ): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
    const components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = []

    // Get the current movie being displayed
    const startIndex = currentPage * DEFAULT_DISPLAY_OPTIONS.maxResultsPerPage
    const currentMovie = results[startIndex]

    // Create pagination buttons row if needed (top row)
    if (totalPages > 1) {
      const paginationButtons = this.buttonBuilder.createPaginationButtons(
        currentPage,
        totalPages,
        'search',
        correlationId,
      )

      const paginationRow =
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          paginationButtons.first,
          paginationButtons.previous,
          paginationButtons.next,
          paginationButtons.last,
        )

      components.push(paginationRow)
    }

    // Create utility row with primary actions and cancel button (bottom row)
    if (currentMovie) {
      const utilityButtons: ButtonBuilder[] = []

      if (!currentMovie.inLibrary) {
        // Add request button for media not in library
        utilityButtons.push(
          this.buttonBuilder.createRequestButton(
            currentMovie.id,
            currentMovie.mediaType,
            currentMovie.title,
            correlationId,
          ),
        )
      } else {
        // Add play button if media has files
        if (currentMovie.hasFile) {
          utilityButtons.push(
            this.buttonBuilder.createEmbyPlaybackButton(
              currentMovie.id,
              currentMovie.mediaType,
              currentMovie.title,
            ),
          )
        }

        // Add monitor/unmonitor button using context buttons method
        const contextButtons = this.buttonBuilder.createContextButtons(
          currentMovie.id,
          currentMovie.mediaType,
          currentMovie.inLibrary,
          currentMovie.monitored || false,
          currentMovie.hasFile || false,
          correlationId,
        )

        // Add only the monitor/unmonitor buttons (details button was removed)
        utilityButtons.push(...contextButtons)
      }

      // Always add cancel button at the end
      utilityButtons.push(this.buttonBuilder.createCancelButton(correlationId))

      const utilityRow =
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          ...utilityButtons.slice(0, 5), // Ensure we don't exceed 5 buttons per row
        )
      components.push(utilityRow)
    } else {
      // Fallback: just add cancel button if no current movie
      const utilityRow =
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          this.buttonBuilder.createCancelButton(correlationId),
        )
      components.push(utilityRow)
    }

    return components
  }

  /**
   * Create search results embed
   */
  private createSearchResultsEmbed(state: MediaSearchState): EmbedBuilder {
    const startIndex = state.currentPage * state.pageSize
    const endIndex = Math.min(startIndex + state.pageSize, state.results.length)
    const pageResults = state.results.slice(startIndex, endIndex)

    if (pageResults.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle(`🎬 Media Search Results for "${state.searchTerm}"`)
        .setColor(0x00aaff)
        .setDescription('No results found on this page.')
        .setFooter({
          text: `Movie ${state.currentPage + 1} of ${state.results.length} • No results`,
        })
      return embed
    }

    // Since we're showing 1 movie per page, get the single result
    const result = pageResults[0]
    const emoji = getMediaTypeEmoji(result.mediaType)
    const year = result.year ? ` (${result.year})` : ''

    // Color-code based on status
    const embedColor = result.inLibrary ? 0x00ff00 : 0xffa500 // Green if in library, orange if not

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${result.title}${year}`)
      .setColor(embedColor)
      .setFooter({
        text: `Movie ${state.currentPage + 1} of ${state.results.length} • ${state.searchTerm} • Last updated: ${state.lastSearchTime.toLocaleTimeString()}`,
      })

    // Add cover art if available
    if (result.posterUrl) {
      embed.setImage(result.posterUrl)
    }

    // Add overview as description
    if (result.overview) {
      embed.setDescription(result.overview)
    }

    // Add status field
    let statusText = result.inLibrary ? '✅ In Library' : '❌ Not in Library'
    if (result.monitored) statusText += ' • 👁️ Monitored'
    if (result.hasFile) statusText += ' • 📥 Downloaded'

    embed.addFields([
      {
        name: 'Status',
        value: statusText,
        inline: true,
      },
    ])

    // Add runtime if available
    if (result.runtime) {
      embed.addFields([
        {
          name: 'Runtime',
          value: `${result.runtime} minutes`,
          inline: true,
        },
      ])
    }

    // Add genres if available
    if (result.genres && result.genres.length > 0) {
      embed.addFields([
        {
          name: 'Genres',
          value: result.genres.join(', '),
          inline: false,
        },
      ])
    }

    // Add ratings/IDs field
    const ids: string[] = []
    if (result.tmdbId) ids.push(`TMDB: ${result.tmdbId}`)
    if (result.imdbId) ids.push(`IMDb: ${result.imdbId}`)

    if (ids.length > 0) {
      embed.addFields([
        {
          name: 'References',
          value: ids.join(' • '),
          inline: false,
        },
      ])
    }

    return embed
  }

  /**
   * Create detailed media embed
   */
  private createDetailedMediaEmbed(result: MediaSearchResult): EmbedBuilder {
    const emoji = getMediaTypeEmoji(result.mediaType)
    const year = result.year ? ` (${result.year})` : ''

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${result.title}${year}`)
      .setColor(result.inLibrary ? 0x00ff00 : 0xffa500)

    if (result.overview) {
      embed.setDescription(result.overview)
    }

    if (result.posterUrl) {
      embed.setThumbnail(result.posterUrl)
    }

    // Add status field
    let statusText = result.inLibrary ? '✅ In Library' : '❌ Not in Library'
    if (result.monitored) statusText += ' • 👁️ Monitored'
    if (result.hasFile) statusText += ' • 📥 Downloaded'

    embed.addFields([
      {
        name: 'Status',
        value: statusText,
        inline: true,
      },
    ])

    if (result.runtime) {
      embed.addFields([
        {
          name: 'Runtime',
          value: `${result.runtime} minutes`,
          inline: true,
        },
      ])
    }

    if (result.genres && result.genres.length > 0) {
      embed.addFields([
        {
          name: 'Genres',
          value: result.genres.join(', '),
          inline: false,
        },
      ])
    }

    // Add IDs for debugging/reference
    const ids: string[] = []
    if (result.tmdbId) ids.push(`TMDB: ${result.tmdbId}`)
    if (result.imdbId) ids.push(`IMDb: ${result.imdbId}`)
    if (result.tvdbId) ids.push(`TVDB: ${result.tvdbId}`)

    if (ids.length > 0) {
      embed.addFields([
        {
          name: 'IDs',
          value: ids.join(' • '),
          inline: false,
        },
      ])
    }

    return embed
  }

  /**
   * Extract page number from parsed custom ID
   */
  private extractPageNumber(parsedId: ParsedCustomId): number | undefined {
    // For pagination buttons, check if it's a pagination action
    if (parsedId.action === 'pagination') {
      const paginationAction = parsedId.additionalData?.param1
      // For prev/next buttons, page number is in param2
      if (paginationAction === 'prev' || paginationAction === 'next') {
        const pageStr = parsedId.additionalData?.param2
        return pageStr ? parseInt(pageStr, 10) : undefined
      }
      // For first/last buttons, no page number in custom ID
      return undefined
    }

    // For non-pagination actions, try param1 (legacy behavior)
    const param1 = parsedId.additionalData?.param1
    return param1 ? parseInt(param1, 10) : undefined
  }

  /**
   * Validate unmonitor media operation with enhanced data consistency checks
   */
  private validateUnmonitorMedia(
    result: MediaSearchResult,
    correlationId: string,
  ): ValidationResult {
    const details: Record<string, unknown> = {
      movieTitle: result.title,
      mediaId: result.id,
      radarrId: result.radarrId,
      tmdbId: result.tmdbId,
      inLibrary: result.inLibrary,
      monitored: result.monitored,
      hasFile: result.hasFile,
    }

    // Check if the movie is actually in the library
    if (!result.inLibrary) {
      return {
        isValid: false,
        error: 'MOVIE_NOT_IN_LIBRARY',
        userMessage:
          'This movie is not in your library and cannot be unmonitored',
        details,
      }
    }

    // Check data consistency: movies in library should have radarrId
    if (result.inLibrary && !result.radarrId) {
      this.logger.error(
        'Data consistency violation: movie claims to be in library but lacks radarrId',
        {
          correlationId,
          movieTitle: result.title,
          mediaId: result.id,
          tmdbId: result.tmdbId,
          inLibrary: result.inLibrary,
          radarrId: result.radarrId,
          dataInconsistency: 'inLibrary=true but radarrId is missing',
          possibleCauses: [
            'Search result converter did not populate radarrId correctly',
            'Radarr movie object missing id property',
            'Data corruption in search state',
            'Race condition during movie addition/removal',
          ],
        },
      )

      return {
        isValid: false,
        error: 'DATA_CONSISTENCY_VIOLATION',
        userMessage:
          'Movie data is inconsistent - cannot perform unmonitor operation. Please refresh the search.',
        details: {
          ...details,
          inconsistencyType: 'inLibrary=true but radarrId=null',
        },
      }
    }

    // Additional validation: radarrId should be a valid number for API operations
    if (
      result.radarrId !== undefined &&
      (typeof result.radarrId !== 'number' || result.radarrId < 0)
    ) {
      this.logger.warn('Invalid radarrId format detected', {
        correlationId,
        movieTitle: result.title,
        radarrId: result.radarrId,
        radarrIdType: typeof result.radarrId,
        expectedType: 'positive number',
      })

      return {
        isValid: false,
        error: 'INVALID_RADARR_ID',
        userMessage:
          'Invalid movie ID format - cannot perform unmonitor operation',
        details: {
          ...details,
          radarrIdType: typeof result.radarrId,
          radarrIdValue: result.radarrId,
        },
      }
    }

    // Edge case: handle radarrId = 0 (valid but falsy)
    if (result.inLibrary && result.radarrId === 0) {
      this.logger.debug('Edge case: movie has radarrId = 0 (valid but falsy)', {
        correlationId,
        movieTitle: result.title,
        radarrId: result.radarrId,
        note: 'radarrId=0 is valid in Radarr but falsy in JavaScript',
      })
    }

    return {
      isValid: true,
      error: '',
      userMessage: '',
      details,
    }
  }

  /**
   * Map custom ID action to MediaSearchAction enum
   */
  private mapActionFromCustomId(parsedId: ParsedCustomId): MediaSearchAction {
    // Handle pagination pattern specially
    if (parsedId.action === 'pagination') {
      // Fix: pagination action is in param1, not param0
      // Custom ID format: pagination:correlationId:context:action[:page]
      // After simple parsing: { param0: "context", param1: "action", param2: "page" }
      const paginationAction = parsedId.additionalData?.param1
      switch (paginationAction) {
        case 'first':
          return MediaSearchAction.PAGINATION_FIRST
        case 'prev':
          return MediaSearchAction.PAGINATION_PREVIOUS
        case 'next':
          return MediaSearchAction.PAGINATION_NEXT
        case 'last':
          return MediaSearchAction.PAGINATION_LAST
        default:
          return MediaSearchAction.CANCEL
      }
    }

    // Handle request_action pattern specially
    if (parsedId.action === 'request_action') {
      return MediaSearchAction.REQUEST_MEDIA
    }

    // Handle media_action pattern specially
    if (parsedId.action === 'media_action') {
      // Custom ID format: media_action:correlationId:mediaType:mediaId:action
      // After parsing: { param0: "mediaType", param1: "mediaId", param2: "action" }
      const actionType = parsedId.additionalData?.param2

      this.logger.debug('Processing media_action custom ID', {
        customId: `${parsedId.action}:${parsedId.correlationId}:${parsedId.additionalData?.param0}:${parsedId.additionalData?.param1}:${parsedId.additionalData?.param2}`,
        actionType,
        mediaType: parsedId.additionalData?.param0,
        mediaId: parsedId.additionalData?.param1,
        correlationId: parsedId.correlationId,
      })

      switch (actionType) {
        case 'unmonitor':
          return MediaSearchAction.UNMONITOR_MEDIA
        case 'monitor':
          return MediaSearchAction.MONITOR_MEDIA
        default:
          this.logger.warn('Unknown media action type', {
            actionType,
            customId: `${parsedId.action}:${parsedId.correlationId}`,
            availableParams: parsedId.additionalData,
          })
          return MediaSearchAction.CANCEL
      }
    }

    // Handle other actions with legacy string mapping
    const actionMap: Record<string, MediaSearchAction> = {
      search_results: MediaSearchAction.SELECT_RESULT,
      pagination_first: MediaSearchAction.PAGINATION_FIRST,
      pagination_previous: MediaSearchAction.PAGINATION_PREVIOUS,
      pagination_next: MediaSearchAction.PAGINATION_NEXT,
      pagination_last: MediaSearchAction.PAGINATION_LAST,
      request_action: MediaSearchAction.REQUEST_MEDIA,
      play_media: MediaSearchAction.PLAY_MEDIA,
      new_search: MediaSearchAction.NEW_SEARCH,
      cancel: MediaSearchAction.CANCEL,
    }

    return actionMap[parsedId.action] || MediaSearchAction.CANCEL
  }
}
