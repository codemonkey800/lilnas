import { Injectable, Logger } from '@nestjs/common'
import {
  ActionRowBuilder,
  ButtonBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js'
import {
  Context,
  Options,
  SlashCommand,
  type SlashCommandContext,
  StringOption,
} from 'necord'
import { v4 as uuid } from 'uuid'

import { RadarrClient } from 'src/media/clients/radarr.client'
import { ButtonBuilderService } from 'src/media/components/button.builder'
import { SelectMenuBuilderService } from 'src/media/components/select-menu.builder'
import { ComponentStateService } from 'src/media/services/component-state.service'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import {
  ComponentCollectorConfig,
  CorrelationContext,
  SearchResultData,
} from 'src/types/discord.types'
import { MediaType } from 'src/types/enums'

import {
  COMPONENT_TIMEOUTS,
  DEFAULT_DISPLAY_OPTIONS,
  getMediaTypeEmoji,
  getStatusEmoji,
  MediaSearchResult,
  MediaSearchState,
} from './media-search.types'

class MediaSearchDto {
  @StringOption({
    name: 'query',
    description: 'Search term for movies or series',
    required: true,
  })
  query!: string

  @StringOption({
    name: 'type',
    description: 'Type of media to search for',
    choices: [
      { name: 'Movies', value: 'movies' },
      { name: 'Series', value: 'series' },
      { name: 'Both', value: 'both' },
    ],
  })
  type!: 'movies' | 'series' | 'both' | null
}

interface RadarrMovie {
  id?: number
  title: string
  year: number
  tmdbId?: number
  imdbId?: string
  overview?: string
  posterUrl?: string
  monitored?: boolean
  qualityProfileId?: number
  rootFolderPath?: string
  downloaded?: boolean
  status?: 'wanted' | 'downloaded' | 'available'
  runtime?: number
  genres?: string[]
}

@Injectable()
export class MediaSearchCommandService {
  private readonly logger = new Logger(MediaSearchCommandService.name)

  constructor(
    private readonly radarrClient: RadarrClient,
    private readonly componentStateService: ComponentStateService,
    private readonly selectMenuBuilder: SelectMenuBuilderService,
    private readonly buttonBuilder: ButtonBuilderService,
    private readonly mediaLogging: MediaLoggingService,
  ) {}

  @SlashCommand({
    name: 'media',
    description: 'Search for movies and TV series',
  })
  async mediaSearch(
    @Context() [interaction]: SlashCommandContext,
    @Options() { query, type }: MediaSearchDto,
  ) {
    const correlationId = uuid()
    const searchType = type || 'both'
    const trimmedQuery = query.trim()

    this.logger.log(
      {
        command: '/media search',
        query: trimmedQuery,
        type: searchType,
        user: interaction.user.username,
        correlationId,
      },
      'User used media search command',
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

      // Search for movies
      if (searchType === 'movies' || searchType === 'both') {
        this.logger.debug('Searching for movies', {
          query: trimmedQuery,
          correlationId,
        })

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
          this.convertToSearchResult(movie),
        )
        allResults = [...allResults, ...movieResults]
      }

      // Search for series (placeholder for future implementation)
      if (searchType === 'series') {
        // TODO: Implement series search when Sonarr client is ready
        await interaction.editReply({
          content: '🚧 TV series search is not yet implemented. Coming soon!',
        })
        return
      }

      // Handle no results
      if (allResults.length === 0) {
        await interaction.editReply({
          content: `❌ No ${searchType === 'movies' ? 'movies' : 'media'} found for "${trimmedQuery}".\n\n💡 Try different keywords or check your spelling.`,
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
      this.logger.error('Media search failed', {
        query: trimmedQuery,
        type: searchType,
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })

      await interaction.editReply({
        content:
          '❌ Sorry, there was an error searching for media. Please try again later.',
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
      components: components as any,
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

      this.logger.debug('Created interactive media search response', {
        correlationId,
        userId: interaction.user.id,
        resultCount: results.length,
        totalPages,
        componentStateId: componentState.id,
      })
    } catch (error) {
      this.logger.error('Failed to create component state', {
        correlationId,
        error: error instanceof Error ? error.message : String(error),
      })

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

    const embed = new EmbedBuilder()
      .setTitle(`🎬 Media Search Results for "${state.searchTerm}"`)
      .setColor(0x00aaff)
      .setFooter({
        text: `Page ${state.currentPage + 1}/${state.totalPages} • ${state.results.length} total results • Use the dropdown to select`,
      })

    if (pageResults.length === 0) {
      embed.setDescription('No results found on this page.')
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

    // Add utility buttons (refresh, cancel)
    const utilityButtons = [
      this.buttonBuilder.createRefreshButton('search', correlationId),
      this.buttonBuilder.createCancelButton(correlationId),
    ]

    const utilityRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...utilityButtons,
    )
    components.push(utilityRow)

    return components
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
      hasFile: movie.downloaded,
      status: movie.status,
      runtime: movie.runtime,
      genres: movie.genres,
    }
  }
}
