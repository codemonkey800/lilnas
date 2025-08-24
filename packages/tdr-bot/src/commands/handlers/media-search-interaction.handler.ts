import { Injectable, Logger } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js'

import {
  DEFAULT_DISPLAY_OPTIONS,
  getMediaTypeEmoji,
  getStatusEmoji,
  isMediaSearchInteraction,
  MediaSearchAction,
  MediaSearchInteraction,
  MediaSearchInteractionContext,
  MediaSearchResponse,
  MediaSearchResult,
  MediaSearchState,
  parseCustomId,
} from 'src/commands/media-search.types'
import { RadarrClient } from 'src/media/clients/radarr.client'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import { SelectMenuBuilderService } from 'src/media/components/select-menu.builder'
import { ComponentStateService } from 'src/media/services/component-state.service'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ComponentState, SearchResultData } from 'src/types/discord.types'
import { ActionType, EventType, MediaType } from 'src/types/enums'

// Define the RadarrMovie interface for the convertToSearchResult method
interface RadarrMovie {
  id?: number
  title: string
  year: number
  tmdbId?: number
  imdbId?: string
  overview?: string
  posterUrl?: string
  monitored?: boolean
  downloaded?: boolean
  hasFile?: boolean
  status?: 'wanted' | 'downloaded' | 'available'
  runtime?: number
  genres?: string[]
}

@Injectable()
export class MediaSearchInteractionHandler {
  private readonly logger = new Logger(MediaSearchInteractionHandler.name)

  constructor(
    private readonly radarrClient: RadarrClient,
    private readonly componentStateService: ComponentStateService,
    private readonly selectMenuBuilder: SelectMenuBuilderService,
    private readonly buttonBuilder: ButtonBuilderService,
    private readonly mediaLogging: MediaLoggingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Handle media search component interactions
   */
  async handleInteraction(
    interaction: MediaSearchInteraction,
    correlationId: string,
  ): Promise<MediaSearchResponse> {
    const startTime = Date.now()

    try {
      // Validate interaction
      if (!isMediaSearchInteraction(interaction)) {
        throw new Error('Invalid media search interaction')
      }

      // Parse custom ID to understand the action
      const parsedId = parseCustomId(interaction.customId)
      if (!parsedId) {
        throw new Error(`Unable to parse custom ID: ${interaction.customId}`)
      }

      // Create interaction context
      const context: MediaSearchInteractionContext = {
        interaction,
        correlationId: parsedId.correlationId,
        userId: interaction.user.id,
        action: this.mapActionFromCustomId(parsedId.action),
        mediaId: parsedId.additionalData?.param1,
        page: parsedId.additionalData?.param1
          ? parseInt(parsedId.additionalData.param1, 10)
          : undefined,
        additionalParams: parsedId.additionalData,
      }

      // Get component state
      const stateId = `${context.correlationId}:${interaction.message?.id || 'unknown'}`
      const componentState =
        this.componentStateService.getComponentState(stateId)

      if (!componentState) {
        return {
          success: false,
          message:
            'This search session has expired. Please run the command again.',
        }
      }

      // Acknowledge interaction immediately
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferUpdate()
      }

      // Handle the specific action
      const response = await this.handleSpecificAction(context, componentState)

      // Log the interaction
      this.logger.debug('Media search interaction handled', {
        userId: context.userId,
        action: context.action,
        correlationId: context.correlationId,
        mediaId: context.mediaId,
        page: context.page,
        responseTime: Date.now() - startTime,
      })

      return response
    } catch (error) {
      this.logger.error('Media search interaction failed', {
        correlationId,
        userId: interaction.user.id,
        customId: interaction.customId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })

      // Emit error event
      this.eventEmitter.emit(EventType.COMPONENT_ERROR, {
        correlationId,
        userId: interaction.user.id,
        error: error instanceof Error ? error : new Error(String(error)),
        phase: 'interaction_handling',
      })

      return {
        success: false,
        message:
          'An error occurred while processing your request. Please try again.',
      }
    }
  }

  /**
   * Handle specific actions based on the interaction context
   */
  private async handleSpecificAction(
    context: MediaSearchInteractionContext,
    state: ComponentState,
  ): Promise<MediaSearchResponse> {
    const searchState = state.data as MediaSearchState

    switch (context.action) {
      case MediaSearchAction.SELECT_RESULT:
        return await this.handleResultSelection(context, searchState)

      case MediaSearchAction.PAGINATION_NEXT:
      case MediaSearchAction.PAGINATION_PREVIOUS:
      case MediaSearchAction.PAGINATION_FIRST:
      case MediaSearchAction.PAGINATION_LAST:
        return await this.handlePagination(context, searchState)

      case MediaSearchAction.REQUEST_MEDIA:
        return await this.handleMediaRequest(context, searchState)

      case MediaSearchAction.VIEW_DETAILS:
        return await this.handleViewDetails(context, searchState)

      case MediaSearchAction.PLAY_MEDIA:
        return await this.handlePlayMedia(context, searchState)

      case MediaSearchAction.REFRESH_DATA:
        return await this.handleRefresh(context, searchState)

      case MediaSearchAction.NEW_SEARCH:
        return await this.handleNewSearch()

      case MediaSearchAction.CANCEL:
        return await this.handleCancel(context)

      default:
        return {
          success: false,
          message: `Unknown action: ${context.action}`,
        }
    }
  }

  /**
   * Handle search result selection
   */
  private async handleResultSelection(
    context: MediaSearchInteractionContext,
    state: MediaSearchState,
  ): Promise<MediaSearchResponse> {
    if (context.interaction.componentType !== ComponentType.StringSelect) {
      return {
        success: false,
        message: 'Invalid interaction type for result selection',
      }
    }

    const selectInteraction = context.interaction as unknown as {
      values: string[]
    }
    const selectedValues = selectInteraction.values

    if (!selectedValues || selectedValues.length === 0) {
      return { success: false, message: 'No results selected' }
    }

    // Parse selected value (format: "movie:123" or "series:456")
    const [mediaTypeStr, mediaId] = selectedValues[0].split(':')
    const mediaType =
      mediaTypeStr === 'movie' ? MediaType.MOVIE : MediaType.SERIES

    // Find the selected result
    const selectedResult = state.results.find(
      result => result.id === mediaId && result.mediaType === mediaType,
    )

    if (!selectedResult) {
      return { success: false, message: 'Selected result not found' }
    }

    // Create action buttons for the selected media
    const actionButtons = this.createActionButtons(
      selectedResult,
      context.correlationId,
    )

    // Create detailed embed for the selected media
    const embed = this.createDetailedMediaEmbed(selectedResult)

    // Update the message with detailed view
    await context.interaction.editReply({
      embeds: [embed],
      components: [actionButtons as any],
    })

    return {
      success: true,
      shouldUpdateMessage: true,
      updatedState: {
        selectedMediaId: selectedResult.id,
        selectedMediaType: selectedResult.mediaType,
      } as Partial<MediaSearchState>,
    }
  }

  /**
   * Handle pagination actions
   */
  private async handlePagination(
    context: MediaSearchInteractionContext,
    state: MediaSearchState,
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
      components: components as any,
    })

    // Update component state
    await this.componentStateService.updateComponentState(
      `${context.correlationId}:${context.interaction.message?.id}`,
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

          return {
            success: true,
            message: `✅ **${result.title}** has been added to your library! It will be downloaded automatically.`,
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
   * Handle view details action
   */
  private async handleViewDetails(
    context: MediaSearchInteractionContext,
    state: MediaSearchState,
  ): Promise<MediaSearchResponse> {
    const mediaId = context.mediaId
    if (!mediaId) {
      return { success: false, message: 'No media ID provided for details' }
    }

    const result = state.results.find(r => r.id === mediaId)
    if (!result) {
      return { success: false, message: 'Media not found in search results' }
    }

    // Create detailed embed
    const embed = this.createDetailedMediaEmbed(result)

    // Create back button to return to search results
    const backButton = new ButtonBuilder()
      .setCustomId(`back_to_search:${context.correlationId}`)
      .setLabel('← Back to Results')
      .setStyle(ButtonStyle.Secondary)

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      backButton,
    )

    await context.interaction.editReply({
      embeds: [embed],
      components: [actionRow],
    })

    return { success: true, shouldUpdateMessage: true }
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
      components: [actionRow as any],
    })

    return { success: true, shouldUpdateMessage: true }
  }

  /**
   * Handle refresh data action
   */
  private async handleRefresh(
    context: MediaSearchInteractionContext,
    state: MediaSearchState,
  ): Promise<MediaSearchResponse> {
    try {
      // Re-run the search with current parameters
      const movies = await this.radarrClient.searchMovies(
        state.searchTerm,
        context.correlationId,
      )

      // Convert to our result format
      const results = movies.map(movie => this.convertToSearchResult(movie))

      const updatedState: MediaSearchState = {
        ...state,
        results,
        totalPages: Math.ceil(results.length / state.pageSize),
        currentPage: 0,
        lastSearchTime: new Date(),
      }

      // Create updated components
      const components = this.createSearchResultsComponents(
        results,
        0,
        updatedState.totalPages,
        context.correlationId,
      )

      const embed = this.createSearchResultsEmbed(updatedState)

      await context.interaction.editReply({
        embeds: [embed],
        components,
      })

      // Update component state
      await this.componentStateService.updateComponentState(
        `${context.correlationId}:${context.interaction.message?.id}`,
        updatedState,
        context.correlationId,
      )

      return {
        success: true,
        message: 'Search results refreshed!',
        shouldUpdateMessage: true,
        updatedState,
      }
    } catch {
      return {
        success: false,
        message: 'Failed to refresh search results. Please try again.',
      }
    }
  }

  /**
   * Handle new search action
   */
  private async handleNewSearch(): Promise<MediaSearchResponse> {
    // This would typically show a modal for new search input
    // For now, just provide a message to use the slash command again
    return {
      success: true,
      message: 'To start a new search, please use the `/media` command again.',
    }
  }

  /**
   * Handle cancel action
   */
  private async handleCancel(
    context: MediaSearchInteractionContext,
  ): Promise<MediaSearchResponse> {
    // Clean up the component state
    const stateId = `${context.correlationId}:${context.interaction.message?.id || 'unknown'}`
    await this.componentStateService.cleanupComponent(
      stateId,
      'manual',
      context.correlationId,
    )

    await context.interaction.editReply({
      content: '❌ Media search cancelled.',
      embeds: [],
      components: [],
    })

    return { success: true, shouldUpdateMessage: true }
  }

  /**
   * Create search results components (select menu + pagination buttons)
   */
  private createSearchResultsComponents(
    results: MediaSearchResult[],
    currentPage: number,
    totalPages: number,
    correlationId: string,
  ): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
    const components: ActionRowBuilder<
      StringSelectMenuBuilder | ButtonBuilder
    >[] = []

    // Convert results to SearchResultData format for the select menu builder
    const searchResultsData: SearchResultData[] = results.map(result => ({
      id: result.id,
      title: result.title,
      year: result.year,
      overview: result.overview,
      posterUrl: result.posterUrl,
      tmdbId: result.tmdbId,
      imdbId: result.imdbId,
      tvdbId: result.tvdbId,
      mediaType: result.mediaType,
      inLibrary: result.inLibrary,
      monitored: result.monitored,
      hasFile: result.hasFile,
      status: result.status,
      runtime: result.runtime,
      genres: result.genres,
    }))

    // Create select menu for results
    const selectMenu = this.selectMenuBuilder.createSearchResultsMenu(
      searchResultsData,
      currentPage,
      DEFAULT_DISPLAY_OPTIONS.maxResultsPerPage,
      correlationId,
    )

    const selectMenuRow =
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)
    components.push(selectMenuRow)

    // Create pagination buttons if needed
    if (totalPages > 1) {
      const paginationButtons = this.buttonBuilder.createPaginationButtons(
        currentPage,
        totalPages,
        'search',
        correlationId,
      )

      const paginationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        paginationButtons.first,
        paginationButtons.previous,
        paginationButtons.pageInfo,
        paginationButtons.next,
        paginationButtons.last,
      )

      components.push(paginationRow)
    }

    // Add utility buttons (refresh, new search, cancel)
    const utilityButtons = [
      this.buttonBuilder.createRefreshButton('search', correlationId),
      new ButtonBuilder()
        .setCustomId(`new_search:${correlationId}`)
        .setLabel('New Search')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔍'),
      this.buttonBuilder.createCancelButton(correlationId),
    ]

    const utilityRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...utilityButtons,
    )
    components.push(utilityRow)

    return components
  }

  /**
   * Create action buttons for selected media
   */
  private createActionButtons(
    result: MediaSearchResult,
    correlationId: string,
  ): ActionRowBuilder<ButtonBuilder> {
    const buttons: ButtonBuilder[] = []

    if (!result.inLibrary) {
      // Show request button for media not in library
      buttons.push(
        this.buttonBuilder.createRequestButton(
          result.id,
          result.mediaType,
          result.title,
          correlationId,
        ),
      )
    } else {
      // Show management buttons for media in library
      if (result.hasFile) {
        buttons.push(
          this.buttonBuilder.createEmbyPlaybackButton(
            result.id,
            result.mediaType,
            result.title,
          ),
        )
      }

      // Add monitor/unmonitor button using context buttons method
      const contextButtons = this.buttonBuilder.createContextButtons(
        result.id,
        result.mediaType,
        result.inLibrary,
        result.monitored || false,
        result.hasFile || false,
        correlationId,
      )
      // Add management buttons (skip play button if already added)
      buttons.push(...contextButtons.slice(result.hasFile ? 1 : 0, 3))
    }

    // Always add details button
    buttons.push(
      this.buttonBuilder.createViewDetailsButton(
        result.id,
        result.mediaType,
        correlationId,
      ),
    )

    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...buttons.slice(0, 5),
    )
  }

  /**
   * Create search results embed
   */
  private createSearchResultsEmbed(state: MediaSearchState): EmbedBuilder {
    const startIndex = state.currentPage * state.pageSize
    const endIndex = Math.min(startIndex + state.pageSize, state.results.length)
    const pageResults = state.results.slice(startIndex, endIndex)

    const embed = new EmbedBuilder()
      .setTitle(`🎬 Media Search Results for "${state.searchTerm}"`)
      .setColor(0x00aaff)
      .setFooter({
        text: `Page ${state.currentPage + 1}/${state.totalPages} • ${state.results.length} total results • Last updated: ${state.lastSearchTime.toLocaleTimeString()}`,
      })

    if (pageResults.length === 0) {
      embed.setDescription('No results found for your search.')
      return embed
    }

    const description = pageResults
      .map(result => {
        const emoji = getMediaTypeEmoji(result.mediaType)
        const statusEmoji = getStatusEmoji(result)
        const year = result.year ? ` (${result.year})` : ''
        const status = statusEmoji ? ` ${statusEmoji}` : ''

        return `${emoji} **${result.title}${year}**${status}`
      })
      .join('\n')

    embed.setDescription(
      `Select a result from the dropdown below to view details and available actions.\n\n${description}`,
    )

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
   * Convert Radarr movie to search result
   */
  private convertToSearchResult(movie: RadarrMovie): MediaSearchResult {
    return {
      id: movie.tmdbId?.toString() || movie.id?.toString() || 'unknown',
      title: movie.title,
      year: movie.year,
      overview: movie.overview,
      posterUrl: movie.posterUrl,
      tmdbId: movie.tmdbId,
      imdbId: movie.imdbId,
      mediaType: MediaType.MOVIE,
      inLibrary: movie.id !== undefined, // If it has an internal ID, it's in library
      monitored: movie.monitored,
      hasFile: movie.downloaded || movie.hasFile,
      status: movie.status,
      runtime: movie.runtime,
      genres: movie.genres,
    }
  }

  /**
   * Map custom ID action to MediaSearchAction enum
   */
  private mapActionFromCustomId(action: string): MediaSearchAction {
    const actionMap: Record<string, MediaSearchAction> = {
      search_results: MediaSearchAction.SELECT_RESULT,
      pagination_first: MediaSearchAction.PAGINATION_FIRST,
      pagination_previous: MediaSearchAction.PAGINATION_PREVIOUS,
      pagination_next: MediaSearchAction.PAGINATION_NEXT,
      pagination_last: MediaSearchAction.PAGINATION_LAST,
      request_action: MediaSearchAction.REQUEST_MEDIA,
      view_details: MediaSearchAction.VIEW_DETAILS,
      play_media: MediaSearchAction.PLAY_MEDIA,
      refresh: MediaSearchAction.REFRESH_DATA,
      new_search: MediaSearchAction.NEW_SEARCH,
      cancel: MediaSearchAction.CANCEL,
    }

    return actionMap[action] || MediaSearchAction.CANCEL
  }
}
