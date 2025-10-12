import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { nanoid } from 'nanoid'

import {
  MovieLibrarySearchResult,
  MovieSearchResult,
} from 'src/media/types/radarr.types'
import {
  SeriesSearchResult,
  UnmonitorAndDeleteSeriesResult,
} from 'src/media/types/sonarr.types'
import { SearchSelection } from 'src/schemas/search-selection'
import { TvShowSelection } from 'src/schemas/tv-show'
import { RetryService } from 'src/utils/retry.service'

import {
  MEDIA_CONTEXT_PROMPT,
  MOVIE_RESPONSE_CONTEXT_PROMPT,
  TV_SHOW_DELETE_RESPONSE_CONTEXT_PROMPT,
  TV_SHOW_RESPONSE_CONTEXT_PROMPT,
} from './prompt.constants'

@Injectable()
export class PromptGenerationService {
  private readonly logger = new Logger(PromptGenerationService.name)

  constructor(private readonly retryService: RetryService) {}

  async generateMoviePrompt(
    messages: BaseMessage[],
    chatModel: ChatOpenAI,
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
      selectionHint?: SearchSelection | null
      movieCount?: number
      episodeCount?: number
    },
  ): Promise<HumanMessage> {
    try {
      let contextPrompt = `Situation: ${situation.toUpperCase()}\n\n`

      switch (situation) {
        case 'clarification':
          contextPrompt +=
            "The user's movie request was too vague. Ask them to be more specific with the movie title or description."
          break
        case 'no_results':
          contextPrompt += `No movies were found for search query "${context?.searchQuery}". Explain this and suggest they try a different title or be more specific.`
          break
        case 'multiple_results':
          if (context?.movies) {
            const movieList = context.movies
              .map((movie, index) => {
                const year = movie.year ? ` (${movie.year})` : ''
                const rating = movie.rating
                  ? ` ⭐${movie.rating?.toFixed(1)}`
                  : ''
                return `${index + 1}. ${movie.title}${year}${rating} - ${movie.overview || 'No description'}`
              })
              .join('\n')
            contextPrompt += `Multiple movies found for "${context.searchQuery}":\n\n${movieList}\n\n`

            // Selection hints have been removed - all selections now require explicit user choice

            contextPrompt += `Ask the user which one they want to download. They can respond with ordinal numbers, years, actor names, etc.`
          }
          break
        case 'error':
          contextPrompt += `There was an error with the movie request. ${context?.errorMessage || 'The Radarr service might be unavailable.'} Respond helpfully and suggest they try again.`
          break
        case 'success':
          if (context?.selectedMovie && context?.downloadResult) {
            const movie = context.selectedMovie
            const result = context.downloadResult as {
              movieAdded: boolean
              searchTriggered: boolean
            }

            let successMessage = ''
            if (context.autoApplied && context.selectionCriteria) {
              successMessage += `Using ${context.selectionCriteria} as requested! `
            }

            successMessage += `Successfully ${result.movieAdded ? 'added' : 'found'} "${movie.title}" ${result.movieAdded ? 'to download queue' : 'in library'}. ${result.searchTriggered ? 'Search has been triggered.' : 'Search will start automatically.'} Respond with enthusiasm.`

            contextPrompt += successMessage
          }
          break
        case 'processing_error':
          contextPrompt += `There was an error processing the user's movie selection. ${context?.errorMessage || 'Suggest they try searching again.'} Be helpful and encouraging.`
          break
        case 'no_downloads':
          contextPrompt += `The user asked about download status. There are currently ${context?.movieCount || 0} movies and ${context?.episodeCount || 0} episodes downloading. Since nothing is downloading, let them know the queue is clear and offer to help them start new downloads. Be friendly and encouraging.`
          break
      }

      const response = await this.retryService.executeWithRetry(
        () =>
          chatModel.invoke([
            ...messages,
            MOVIE_RESPONSE_CONTEXT_PROMPT,
            new HumanMessage({ id: nanoid(), content: contextPrompt }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        `OpenAI-generateMoviePrompt-${situation}`,
      )

      return new HumanMessage({
        id: nanoid(),
        content: response.content.toString(),
      })
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), situation },
        'Failed to generate movie prompt, using fallback',
      )

      // Fallback to simple messages
      const fallbackMessages = {
        clarification:
          'What movie would you like to download? Please be more specific.',
        no_results: `I couldn't find any movies matching "${context?.searchQuery}". Try a different title!`,
        multiple_results: 'I found multiple movies. Which one would you like?',
        error:
          'Sorry, there was an error with your movie request. Please try again.',
        success: `Successfully added "${context?.selectedMovie?.title}" to downloads!`,
        processing_error:
          'Sorry, I had trouble processing your selection. Please try searching again.',
        no_downloads: 'No downloads are currently active. The queue is clear!',
      }

      return new HumanMessage({
        id: nanoid(),
        content: fallbackMessages[situation],
      })
    }
  }

  async generateMovieDeletePrompt(
    messages: BaseMessage[],
    chatModel: ChatOpenAI,
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
    try {
      let contextPrompt = `Situation: ${situation.toUpperCase()}\n\n`

      switch (situation) {
        case 'clarification_delete':
          contextPrompt +=
            "The user's movie delete request was too vague. Ask them to be more specific with the movie title or description."
          break
        case 'no_results_delete':
          contextPrompt += `No movies were found in your library for search query "${context?.searchQuery}". Explain that the movie might not be in their collection and suggest they try a different title or be more specific.`
          break
        case 'multiple_results_delete':
          if (context?.movies) {
            const movieList = context.movies
              .map((movie, index) => {
                const year = movie.year ? ` (${movie.year})` : ''
                const rating = movie.rating
                  ? ` ⭐${movie.rating?.toFixed(1)}`
                  : ''
                const hasFile = movie.hasFile
                  ? ' 📁 Downloaded'
                  : ' 📋 Monitored only'
                return `${index + 1}. ${movie.title}${year}${rating}${hasFile}`
              })
              .join('\n')
            contextPrompt += `Multiple movies found in your library for "${context.searchQuery}":\n\n${movieList}\n\n`
            contextPrompt += `Which movie would you like to delete? They can respond with ordinal numbers, years, etc. Note that deleting will remove the movie from monitoring and delete the files.`
          }
          break
        case 'error_delete':
          contextPrompt += `There was an error with the movie delete request. ${context?.errorMessage || 'The Radarr service might be unavailable.'} Respond helpfully and suggest they try again.`
          break
        case 'success_delete':
          if (context?.selectedMovie && context?.deleteResult) {
            const movie = context.selectedMovie
            const result = context.deleteResult as {
              movieDeleted: boolean
              filesDeleted: boolean
              downloadsFound?: number
              downloadsCancelled?: number
            }

            let successMessage = ''
            if (context.autoApplied && context.selectionCriteria) {
              successMessage += `Using ${context.selectionCriteria} as requested! `
            }

            successMessage += `Successfully deleted "${movie.title}" from your library${result.filesDeleted ? ' (files removed)' : ' (files kept)'}. `

            if (result.downloadsFound) {
              successMessage += `${result.downloadsCancelled || 0}/${result.downloadsFound} active downloads were cancelled. `
            }

            successMessage +=
              'Respond with confirmation and mention what was removed.'
            contextPrompt += successMessage
          }
          break
        case 'processing_error_delete':
          contextPrompt += `There was an error processing the user's movie delete selection. ${context?.errorMessage || 'Suggest they try searching again.'} Be helpful and encouraging.`
          break
      }

      const response = await this.retryService.executeWithRetry(
        () =>
          chatModel.invoke([
            ...messages,
            MOVIE_RESPONSE_CONTEXT_PROMPT,
            new HumanMessage({ id: nanoid(), content: contextPrompt }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        `OpenAI-generateMovieDeletePrompt-${situation}`,
      )

      return new HumanMessage({
        id: nanoid(),
        content: response.content.toString(),
      })
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), situation },
        'Failed to generate movie delete prompt, using fallback',
      )

      // Fallback to simple messages
      const fallbackMessages = {
        clarification_delete:
          'What movie would you like to delete? Please be more specific.',
        no_results_delete: `I couldn't find any movies matching "${context?.searchQuery}" in your library. Try a different title!`,
        multiple_results_delete:
          'I found multiple movies in your library. Which one would you like to delete?',
        error_delete:
          'Sorry, there was an error with your movie delete request. Please try again.',
        success_delete: `Successfully deleted "${context?.selectedMovie?.title}" from your library!`,
        processing_error_delete:
          'Sorry, I had trouble processing your selection. Please try searching again.',
      }

      return new HumanMessage({
        id: nanoid(),
        content: fallbackMessages[situation],
      })
    }
  }

  async generateTvShowPrompt(
    messages: BaseMessage[],
    chatModel: ChatOpenAI,
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
      autoSelectedShow?: boolean
      selectionHint?: SearchSelection | null
      granularSelectionHint?: TvShowSelection | null
    },
  ): Promise<HumanMessage> {
    try {
      let contextPrompt = `Situation: ${situation}\n\n`

      switch (situation) {
        case 'TV_SHOW_CLARIFICATION':
          contextPrompt +=
            "The user's TV show request was too vague. Ask them to be more specific with the show title or description."
          break
        case 'TV_SHOW_NO_RESULTS':
          contextPrompt += `No TV shows were found for search query "${context?.searchQuery}". Explain this and suggest they try a different title or be more specific.`
          break
        case 'TV_SHOW_SELECTION_NEEDED':
          if (context?.shows) {
            if (context.shows.length === 1) {
              const show = context.shows[0]
              const year = show.year ? ` (${show.year})` : ''
              const rating = show.rating ? ` ⭐${show.rating?.toFixed(1)}` : ''
              const seasons = show.seasons?.length || 0
              const status = show.ended ? 'Ended' : 'Ongoing'

              // Check if this show was auto-selected
              if (context.autoSelectedShow && context.selectionCriteria) {
                contextPrompt += `Using ${context.selectionCriteria} as requested! `
              }

              contextPrompt += `Found "${show.title}"${year} - ${status}, ${seasons} seasons${rating}\n\n`
              contextPrompt += `What would you like to download?\n`
              contextPrompt += `- Entire Series (all seasons)\n`
              contextPrompt += `- Specific Seasons (e.g., "season 1 and 3" or "seasons 1-5")\n`
              contextPrompt += `- Specific Episodes (e.g., "season 1 episodes 1-5")\n\n`

              // Add granular selection hint if we have one
              if (context.granularSelectionHint?.selection) {
                const selections = context.granularSelectionHint.selection
                  .map(s =>
                    s.episodes
                      ? `season ${s.season} episodes ${s.episodes.join(', ')}`
                      : `season ${s.season}`,
                  )
                  .join(', ')
                contextPrompt += `Note: I detected you might want "${selections}" but wasn't confident enough to auto-select. `
              }

              contextPrompt += `Please specify your selection!`
            } else {
              const showList = context.shows
                .map((show, index) => {
                  const year = show.year ? ` (${show.year})` : ''
                  const rating = show.rating
                    ? ` ⭐${show.rating?.toFixed(1)}`
                    : ''
                  const seasons = show.seasons?.length || 0
                  const status = show.ended ? 'Ended' : 'Ongoing'
                  return `${index + 1}. ${show.title}${year} - ${status}, ${seasons} seasons${rating}`
                })
                .join('\n')
              contextPrompt += `Multiple TV shows found for "${context.searchQuery}":\n\n${showList}\n\n`

              // Selection hints have been removed - all selections now require explicit user choice

              contextPrompt += `Which show do you want? Then I'll ask about season/episode selection.`
            }
          }
          break
        case 'TV_SHOW_GRANULAR_SELECTION_NEEDED':
          if (context?.selectedShow) {
            const show = context.selectedShow
            const year = show.year ? ` (${show.year})` : ''
            const seasons = show.seasons?.length || 0
            const status = show.ended ? 'Ended' : 'Ongoing'
            const rating = show.rating ? ` ⭐${show.rating?.toFixed(1)}` : ''

            contextPrompt += `Great! I've selected **${show.title}${year}** - ${status}, ${seasons} seasons${rating}\n\n`
            contextPrompt += `What would you like to download?\n\n`
            contextPrompt += `• **Entire Series** - All available seasons\n`
            contextPrompt += `• **Specific Seasons** - Choose which seasons\n`
            contextPrompt += `• **Specific Episodes** - Choose individual episodes`
          }
          break
        case 'TV_SHOW_ERROR':
          contextPrompt += `There was an error with the TV show request. ${context?.errorMessage || 'The Sonarr service might be unavailable.'} Respond helpfully and suggest they try again.`
          break
        case 'TV_SHOW_SUCCESS':
          if (context?.selectedShow && context?.downloadResult) {
            const show = context.selectedShow
            const result = context.downloadResult as {
              seriesAdded: boolean
              seriesUpdated: boolean
              searchTriggered: boolean
            }

            let successMessage = ''
            if (context.autoApplied && context.selectionCriteria) {
              successMessage += `Using ${context.selectionCriteria} as requested! `
            }

            if (context.autoApplied && context.granularSelection?.selection) {
              const selections = context.granularSelection.selection
                .map(s =>
                  s.episodes
                    ? `season ${s.season} episodes ${s.episodes.join(', ')}`
                    : `season ${s.season}`,
                )
                .join(', ')
              successMessage += `Downloading ${selections} `
            }

            successMessage += `Successfully ${result.seriesAdded ? 'added' : 'updated'} "${show.title}" ${result.seriesAdded ? 'to download queue' : 'monitoring'}. ${result.searchTriggered ? 'Search has been triggered.' : 'Search will start automatically.'} Respond with enthusiasm about the TV show.`

            contextPrompt += successMessage
          }
          break
        case 'TV_SHOW_PROCESSING_ERROR':
          contextPrompt += `There was an error processing the user's TV show selection. ${context?.errorMessage || 'Suggest they try searching again.'} Be helpful and encouraging.`
          break
      }

      const response = await this.retryService.executeWithRetry(
        () =>
          chatModel.invoke([
            ...messages,
            TV_SHOW_RESPONSE_CONTEXT_PROMPT,
            new HumanMessage({ id: nanoid(), content: contextPrompt }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        `OpenAI-generateTvShowPrompt-${situation}`,
      )

      return new HumanMessage({
        id: nanoid(),
        content: response.content.toString(),
      })
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), situation },
        'Failed to generate TV show prompt, using fallback',
      )

      // Fallback to simple messages
      const fallbackMessages = {
        TV_SHOW_CLARIFICATION:
          'What TV show would you like to download? Please be more specific.',
        TV_SHOW_NO_RESULTS: `I couldn't find any shows matching "${context?.searchQuery}". Try a different title!`,
        TV_SHOW_SELECTION_NEEDED:
          'I found multiple shows. Which one would you like?',
        TV_SHOW_GRANULAR_SELECTION_NEEDED: `I've selected "${context?.selectedShow?.title}". What would you like to download - entire series, specific seasons, or episodes?`,
        TV_SHOW_ERROR:
          'Sorry, there was an error with your TV show request. Please try again.',
        TV_SHOW_SUCCESS: `Successfully added "${context?.selectedShow?.title}" to downloads!`,
        TV_SHOW_PROCESSING_ERROR:
          'Sorry, I had trouble processing your selection. Please try searching again.',
      }

      return new HumanMessage({
        id: nanoid(),
        content: fallbackMessages[situation],
      })
    }
  }

  generateMediaContextPrompt(
    message: BaseMessage,
    mediaData: string,
  ): HumanMessage {
    return new HumanMessage({
      content: `${typeof MEDIA_CONTEXT_PROMPT.content === 'string' ? MEDIA_CONTEXT_PROMPT.content : 'Respond about media content.'}\n\nUser's request: "${message.content}"\n\nMEDIA DATA:${mediaData}`,
      id: nanoid(),
    })
  }

  async generateTvShowDeletePrompt(
    messages: BaseMessage[],
    chatModel: ChatOpenAI,
    situationType: string,
    context: {
      selectedShow?: { title: string; year?: number }
      deleteResult?: UnmonitorAndDeleteSeriesResult
      errorMessage?: string
      searchResults?: Array<{ id: number; title: string; year?: number }>
      searchQuery?: string
    },
  ): Promise<HumanMessage> {
    try {
      this.logger.log(
        {
          situationType,
          context,
        },
        'DEBUG: Generating TV show delete prompt with context',
      )

      const contextMessage = new HumanMessage({
        id: nanoid(),
        content: JSON.stringify({
          situationType,
          context,
        }),
      })

      const response = await this.retryService.executeWithRetry(
        () =>
          chatModel.invoke([
            ...messages,
            TV_SHOW_DELETE_RESPONSE_CONTEXT_PROMPT,
            contextMessage,
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-generateTvShowDeletePrompt',
      )

      this.logger.log(
        {
          situationType,
          responseContent: response.content.toString(),
        },
        'DEBUG: Generated TV show delete response',
      )

      return new HumanMessage({
        id: nanoid(),
        content: response.content.toString(),
      })
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), situationType },
        'Failed to generate TV show delete prompt',
      )

      // Fallback responses based on situation type
      const fallbackResponses: Record<string, string> = {
        TV_SHOW_DELETE_SUCCESS: `✅ Successfully deleted "${context.selectedShow?.title}" from your library! The files have been permanently removed. 🗑️`,
        TV_SHOW_DELETE_ERROR:
          context.errorMessage ||
          'Failed to delete the TV show. Please try again.',
        TV_SHOW_DELETE_NO_RESULTS: `I couldn't find any TV shows matching "${context.searchQuery}" in your library. Try a different title!`,
        TV_SHOW_DELETE_MULTIPLE_RESULTS_NEED_BOTH: `I found multiple TV shows. Which one do you want to delete, and what parts? (e.g., "the first one, entire series" or "the 2009 version, season 1")`,
        TV_SHOW_DELETE_NEED_RESULT_SELECTION: `I found multiple TV shows. Which one do you want to delete? (e.g., "the first one" or "the 2009 version")`,
        TV_SHOW_DELETE_NEED_SERIES_SELECTION: `What parts of "${context.selectedShow?.title}" do you want to delete? (e.g., "entire series", "season 1", "season 2 episodes 1-3")`,
      }

      return new HumanMessage({
        id: nanoid(),
        content:
          fallbackResponses[situationType] ||
          'Something went wrong with the TV show delete operation.',
      })
    }
  }

  /**
   * Wrapper method for TV show chat responses without requiring chatModel parameter
   * Creates a default chatModel internally for strategy use
   */
  async generateTvShowChatResponse(
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
      autoSelectedShow?: boolean
      selectionHint?: SearchSelection | null
      granularSelectionHint?: TvShowSelection | null
    },
  ): Promise<HumanMessage> {
    // Create default chatModel for strategy use
    const chatModel = new ChatOpenAI({
      modelName: process.env.OPENAI_MODEL || 'gpt-4o',
      temperature: 0.7,
      maxTokens: 500,
    })

    return this.generateTvShowPrompt(messages, chatModel, situation, context)
  }

  /**
   * Wrapper method for TV show delete chat responses without requiring chatModel parameter
   * Creates a default chatModel internally for strategy use
   */
  async generateTvShowDeleteChatResponse(
    messages: BaseMessage[],
    situationType: string,
    context: {
      selectedShow?: { title: string; year?: number }
      deleteResult?: UnmonitorAndDeleteSeriesResult
      errorMessage?: string
      searchResults?: Array<{ id: number; title: string; year?: number }>
      searchQuery?: string
    },
  ): Promise<HumanMessage> {
    // Create default chatModel for strategy use
    const chatModel = new ChatOpenAI({
      modelName: process.env.OPENAI_MODEL || 'gpt-4o',
      temperature: 0.7,
      maxTokens: 500,
    })

    return this.generateTvShowDeletePrompt(
      messages,
      chatModel,
      situationType,
      context,
    )
  }
}
