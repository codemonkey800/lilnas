import { SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { Injectable, Logger } from '@nestjs/common'

import { REASONING_TEMPERATURE } from 'src/constants/llm'
import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import { StrategyRequestParams } from 'src/media-operations/request-handling/types/request-context.type'
import { StrategyResult } from 'src/media-operations/request-handling/types/strategy-result.type'
import {
  formatFileSize,
  formatTimeRemaining,
} from 'src/media-operations/request-handling/utils/formatting.utils'
import { ValidationUtilities } from 'src/media-operations/request-handling/utils/validation.utils'
import { StateService } from 'src/state/state.service'
import { DOWNLOAD_STATUS_RESPONSE_PROMPT } from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

import { BaseMediaStrategy } from './base/base-media-strategy'

/**
 * Strategy for handling download status requests
 *
 * Extracted from llm.service.ts handleDownloadStatusRequest (lines 2770-2903)
 */
@Injectable()
export class DownloadStatusStrategy extends BaseMediaStrategy {
  protected readonly logger = new Logger(DownloadStatusStrategy.name)
  protected readonly strategyName = 'DownloadStatusStrategy'

  constructor(
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
    private readonly state: StateService,
    private readonly retryService: RetryService,
    private readonly validationUtilities: ValidationUtilities,
  ) {
    super()
  }

  /**
   * Get reasoning model for status response generation
   */
  private getReasoningModel(): ChatOpenAI {
    const state = this.state.getState()
    return new ChatOpenAI({
      model: state.reasoningModel,
      temperature: REASONING_TEMPERATURE,
    })
  }

  /**
   * Execute download status request
   */
  protected async executeRequest(
    params: StrategyRequestParams,
  ): Promise<StrategyResult> {
    const { message, messages, userId } = params

    this.logger.log(
      { userId, strategy: this.strategyName },
      'Strategy execution started - processing download status request',
    )

    try {
      // Fetch current downloads from both services
      const startTime = Date.now()
      const [movieDownloads, episodeDownloads] = await Promise.all([
        this.radarrService.getDownloadingMovies(),
        this.sonarrService.getDownloadingEpisodes(),
      ])

      this.logger.log(
        {
          userId,
          movieCount: movieDownloads.length,
          episodeCount: episodeDownloads.length,
          duration: Date.now() - startTime,
        },
        'Fetched download status from services',
      )

      // Early return for no downloads - prevents LLM hallucination
      if (movieDownloads.length === 0 && episodeDownloads.length === 0) {
        this.logger.log(
          { userId, movieCount: 0, episodeCount: 0 },
          'No downloads active, returning predefined response',
        )

        const noDownloadsResponse = new SystemMessage(
          'No downloads are currently active. The queue is clear! Let the user know in a friendly way and offer to help them start new downloads.',
        )

        const response = await this.retryService.executeWithRetry(
          () =>
            this.getReasoningModel().invoke([
              noDownloadsResponse,
              ...messages,
              message,
            ]),
          {
            maxAttempts: 3,
            baseDelay: 1000,
            maxDelay: 30000,
            timeout: 30000,
          },
          'OpenAI-downloadStatusNoDownloads',
        )

        return {
          images: [],
          messages: [...messages, message, response],
        }
      }

      // Format download data into minified JSON context
      const downloadData = {
        summary: {
          totalMovies: movieDownloads.length,
          totalEpisodes: episodeDownloads.length,
        },
        movies: movieDownloads.map(m => ({
          title: m.movieTitle,
          progress: m.progressPercent,
          status: m.status,
          size: formatFileSize(m.size),
          timeLeft: m.estimatedCompletionTime
            ? formatTimeRemaining(m.estimatedCompletionTime)
            : null,
        })),
        episodes: episodeDownloads.map(e => ({
          series: e.seriesTitle,
          episode: `S${e.seasonNumber}E${e.episodeNumber}: ${e.episodeTitle}`,
          progress: e.progressPercent,
          status: e.status,
          size: formatFileSize(e.size),
          timeLeft: e.timeleft || null,
        })),
      }

      this.logger.log(
        {
          userId,
          movieCount: downloadData.summary.totalMovies,
          episodeCount: downloadData.summary.totalEpisodes,
        },
        'Retrieved download status data',
      )

      // Add download context as system message and generate response
      const contextMessage = new SystemMessage(
        `ACTIVE DOWNLOADS FOUND: ${downloadData.summary.totalMovies} movies and ${downloadData.summary.totalEpisodes} episodes currently downloading. Use ONLY the data provided below and do NOT mention any titles that are not in this data: ${JSON.stringify(downloadData)}`,
      )

      const response = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            DOWNLOAD_STATUS_RESPONSE_PROMPT,
            contextMessage,
            ...messages,
            message,
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        'OpenAI-downloadStatus',
      )

      // Validate response for potential hallucinations
      const movieTitles = movieDownloads
        .map(m => m.movieTitle)
        .filter((title): title is string => Boolean(title))
      const seriesTitles = episodeDownloads
        .map(e => e.seriesTitle)
        .filter((title): title is string => Boolean(title))
      this.validationUtilities.validateDownloadResponse(
        response,
        movieTitles,
        seriesTitles,
        userId,
      )

      return {
        images: [],
        messages: [...messages, message, response],
      }
    } catch (error) {
      this.logger.error(
        {
          userId,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to get download status',
      )

      // Fallback response when services are unavailable
      const errorResponse = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            new SystemMessage(
              'The download services are currently unavailable. Respond helpfully and suggest they try again later.',
            ),
            ...messages,
            message,
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        'OpenAI-downloadStatusError',
      )

      return {
        images: [],
        messages: [...messages, message, errorResponse],
      }
    }
  }
}
