import { Injectable, Logger } from '@nestjs/common'
import {
  ActionRowBuilder,
  type APIActionRowComponent,
  type APIMessageActionRowComponent,
  ButtonBuilder,
  EmbedBuilder,
} from 'discord.js'
import {
  Context,
  createCommandGroupDecorator,
  Options,
  type SlashCommandContext,
  Subcommand,
} from 'necord'
import { v4 as uuid } from 'uuid'

import { RadarrClient } from 'src/media/clients/radarr.client'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import { ComponentStateService } from 'src/media/services/component-state.service'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { convertRadarrMovieToSearchResult } from 'src/media/utils/search-result-converter'
import {
  ComponentCollectorConfig,
  CorrelationContext,
} from 'src/types/discord.types'
import { MediaType } from 'src/types/enums'

import {
  COMPONENT_TIMEOUTS,
  DEFAULT_DISPLAY_OPTIONS,
  getMediaTypeEmoji,
  MediaSearchResult,
  MediaSearchState,
  SearchSubcommandDto,
} from './media-search.types'

// Create the media command group decorator
export const MediaCommandDecorator = createCommandGroupDecorator({
  name: 'media',
  description: 'Search and manage movies and TV series',
})

@Injectable()
@MediaCommandDecorator()
export class MediaSearchCommandService {
  private readonly logger = new Logger(MediaSearchCommandService.name)

  constructor(
    private readonly radarrClient: RadarrClient,
    private readonly componentStateService: ComponentStateService,
    private readonly buttonBuilder: ButtonBuilderService,
    private readonly mediaLogging: MediaLoggingService,
  ) {}

  @Subcommand({
    name: 'search',
    description: 'Search for movies and TV series',
  })
  async searchMedia(
    @Context() [interaction]: SlashCommandContext,
    @Options() { query }: SearchSubcommandDto,
  ) {
    const correlationId = uuid()
    const searchType = 'both' // Always search both movies and series
    const trimmedQuery = query.trim()

    this.logger.log(
      {
        command: '/media search',
        query: trimmedQuery,
        type: searchType,
        user: interaction.user.username,
        correlationId,
      },
      'User executed /media search command',
    )

    // Input validation
    if (trimmedQuery.length < 3) {
      await interaction.reply({
        content: '❌ Please provide a search query with at least 3 characters.',
        ephemeral: true,
      })
      return
    }

    // Defer the reply to give us more time
    await interaction.deferReply()

    try {
      let allResults: MediaSearchResult[] = []

      // Search for movies (always search both movies and series)
      if (searchType === 'both') {
        this.logger.debug('Searching for movies', {
          query: trimmedQuery,
          correlationId,
        })

        try {
          const movies = await this.radarrClient.searchMovies(
            trimmedQuery,
            correlationId,
          )

          this.logger.debug('Movie search completed', {
            query: trimmedQuery,
            resultCount: movies.length,
            correlationId,
          })

          const movieResults = movies.map(movie =>
            convertRadarrMovieToSearchResult(movie, this.logger),
          )
          allResults = [...allResults, ...movieResults]
        } catch (radarrError) {
          this.logger.error(
            {
              err:
                radarrError instanceof Error
                  ? radarrError
                  : new Error(String(radarrError)),
              query: trimmedQuery,
              correlationId,
              radarrUrl: this.radarrClient['radarrConfig']?.url || 'unknown',
              apiKeyPresent: !!this.radarrClient['radarrConfig']?.apiKey,
              context: 'RadarrMovieSearch',
            },
            'Radarr movie search failed',
          )

          // Re-throw with more context
          throw new Error(
            `Radarr search failed: ${radarrError instanceof Error ? radarrError.message : String(radarrError)}`,
          )
        }
      }

      // TODO: Search for series when Sonarr client is ready
      // Series search will be added here

      // Handle no results
      if (allResults.length === 0) {
        await interaction.editReply({
          content: `❌ No media found for "${trimmedQuery}".\n\n💡 Try different keywords or check your spelling.`,
        })
        return
      }

      // Create interactive components response
      await this.createInteractiveResponse(
        interaction,
        trimmedQuery,
        searchType,
        allResults,
        correlationId,
      )
    } catch (error) {
      // Enhanced error logging with proper Pino error serialization
      this.logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          query: trimmedQuery,
          type: searchType,
          correlationId,
          userId: interaction.user.id,
          username: interaction.user.username,
          guildId: interaction.guild?.id,
          channelId: interaction.channel?.id,
          errorCode: (error as { code?: string })?.code || 'unknown',
          httpStatus: (error as { status?: number })?.status || 'unknown',
          url: (error as { url?: string })?.url || 'unknown',
          method: (error as { method?: string })?.method || 'unknown',
          context: 'MediaSearchCommandService',
        },
        '/media search command failed',
      )

      // Provide more specific error messages based on error type
      let userMessage =
        '❌ Sorry, there was an error searching for media. Please try again later.'

      if (error instanceof Error) {
        // Network/API errors
        if (error.message.toLowerCase().includes('timeout')) {
          userMessage =
            '❌ The search timed out. Please try again with a shorter query.'
        } else if (
          error.message.toLowerCase().includes('network') ||
          error.message.toLowerCase().includes('connect')
        ) {
          userMessage =
            '❌ Cannot connect to the media server. Please try again later.'
        } else if (
          error.message.toLowerCase().includes('api') ||
          error.message.toLowerCase().includes('unauthorized')
        ) {
          userMessage =
            '❌ Media server authentication failed. Please contact an administrator.'
        } else if (error.message.toLowerCase().includes('not found')) {
          userMessage =
            '❌ Media service is not available. Please try again later.'
        }
      }

      await interaction.editReply({
        content: userMessage,
      })
    }
  }

  /**
   * Create interactive response with components
   */
  private async createInteractiveResponse(
    interaction: SlashCommandContext[0],
    query: string,
    searchType: string,
    results: MediaSearchResult[],
    correlationId: string,
  ): Promise<void> {
    const pageSize = DEFAULT_DISPLAY_OPTIONS.maxResultsPerPage
    const totalPages = Math.ceil(results.length / pageSize)
    const currentPage = 0

    // Create search state
    const searchState: MediaSearchState = {
      searchTerm: query,
      searchType: searchType as 'movies' | 'series' | 'both',
      currentPage,
      totalPages,
      pageSize,
      results,
      lastSearchTime: new Date(),
    }

    // Create correlation context
    const correlationContext: CorrelationContext = {
      correlationId,
      userId: interaction.user.id,
      username: interaction.user.username,
      guildId: interaction.guild?.id || '',
      channelId: interaction.channel?.id || '',
      startTime: new Date(),
      searchTerm: query,
      mediaType: searchType === 'movies' ? MediaType.MOVIE : undefined,
    }

    // Create embed
    const embed = this.createSearchResultsEmbed(searchState)

    // Create components
    const components = this.createSearchResultsComponents(
      results,
      currentPage,
      totalPages,
      correlationId,
    )

    // Send the interactive response
    const message = await interaction.editReply({
      embeds: [embed],
      components:
        components as unknown as APIActionRowComponent<APIMessageActionRowComponent>[],
    })

    // Create component state for interaction handling
    const collectorConfig: ComponentCollectorConfig = {
      time: COMPONENT_TIMEOUTS.SEARCH_RESULTS,
      max: 50, // Maximum 50 interactions per session
    }

    try {
      const componentState =
        await this.componentStateService.createComponentState(
          message,
          correlationContext,
          collectorConfig,
        )

      // Store our search state in the component state
      await this.componentStateService.updateComponentState(
        componentState.id,
        searchState,
        correlationId,
      )

      this.logger.debug('Created interactive /media search response', {
        correlationId,
        userId: interaction.user.id,
        resultCount: results.length,
        totalPages,
        componentStateId: componentState.id,
      })
    } catch (error) {
      this.logger.error(
        {
          err: error instanceof Error ? error : new Error(String(error)),
          correlationId,
          context: 'ComponentStateCreation',
        },
        'Failed to create component state',
      )

      // Fallback to simple text response
      await interaction.editReply({
        content: `⚠️ Found ${results.length} result${results.length === 1 ? '' : 's'} but interactive mode is unavailable. Please try again.`,
        embeds: [],
        components: [],
      })
    }
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
        text: `Movie ${state.currentPage + 1} of ${state.results.length} • ${state.searchTerm}`,
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
   * Create search results components (pagination + action buttons)
   */
  private createSearchResultsComponents(
    results: MediaSearchResult[],
    currentPage: number,
    totalPages: number,
    correlationId: string,
  ): ActionRowBuilder<ButtonBuilder>[] {
    const components: ActionRowBuilder<ButtonBuilder>[] = []

    // Get the current movie being displayed
    const startIndex = currentPage * DEFAULT_DISPLAY_OPTIONS.maxResultsPerPage
    const currentMovie = results[startIndex]

    // Create pagination buttons if needed (top row)
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

      const utilityRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...utilityButtons.slice(0, 5), // Ensure we don't exceed 5 buttons per row
      )
      components.push(utilityRow)
    } else {
      // Fallback: just add cancel button if no current movie
      const utilityRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        this.buttonBuilder.createCancelButton(correlationId),
      )
      components.push(utilityRow)
    }

    return components
  }
}
