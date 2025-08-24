import { Injectable, Logger } from '@nestjs/common'
import {
  Context,
  Options,
  SlashCommand,
  type SlashCommandContext,
  StringOption,
} from 'necord'
import { v4 as uuid } from 'uuid'

import { RadarrClient } from 'src/media/clients/radarr.client'

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
  tmdbId: number
  imdbId?: string
  overview?: string
  posterUrl?: string
  monitored: boolean
  qualityProfileId: number
  rootFolderPath: string
  downloaded: boolean
  status: 'wanted' | 'downloaded' | 'available'
}

@Injectable()
export class MediaSearchCommandService {
  private readonly logger = new Logger(MediaSearchCommandService.name)

  constructor(private readonly radarrClient: RadarrClient) {}

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
      await interaction.reply(
        'Please provide a search query with at least 3 characters.',
      )
      return
    }

    try {
      let response = ''

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

        response += this.formatMovieResults(movies, trimmedQuery)
      }

      if (searchType === 'series') {
        response = 'TV series search is not yet implemented. Coming soon!'
      }

      if (searchType === 'both' && response === '') {
        response =
          'TV series search is not yet implemented. Showing movie results only.'
      }

      await interaction.reply(response || 'No results found for your search.')
    } catch (error) {
      this.logger.error('Media search failed', {
        query: trimmedQuery,
        type: searchType,
        correlationId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })

      await interaction.reply(
        'Sorry, there was an error searching for media. Please try again later.',
      )
    }
  }

  private formatMovieResults(movies: RadarrMovie[], query: string): string {
    if (movies.length === 0) {
      return `No movies found for "${query}".`
    }

    const limitedMovies = movies.slice(0, 10)
    const results = limitedMovies
      .map(movie => {
        const overview = movie.overview
          ? this.truncateText(movie.overview, 150)
          : 'No description available.'

        return `**${movie.title} (${movie.year})**\n${overview}\n`
      })
      .join('\n')

    const totalText =
      movies.length > 10
        ? `\nShowing top 10 of ${movies.length} results.`
        : `\nFound ${movies.length} result${movies.length === 1 ? '' : 's'}.`

    return `🎬 **Movie Search Results for "${query}"**\n\n${results}${totalText}`
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text
    }
    return text.substring(0, maxLength - 3).trim() + '...'
  }
}
