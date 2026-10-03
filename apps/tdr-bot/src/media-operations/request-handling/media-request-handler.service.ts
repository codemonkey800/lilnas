import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'
import { Injectable, Logger } from '@nestjs/common'
import dedent from 'dedent'
import { nanoid } from 'nanoid'

import { LlmClient } from 'src/llm/client/llm-client'
import {
  MediaRequest,
  MediaRequestSchema,
  MediaRequestType,
  SearchIntent,
} from 'src/schemas/graph'
import {
  MediaTypeClassification,
  MediaTypeClassificationSchema,
} from 'src/schemas/media-classification'
import {
  GET_MEDIA_TYPE_PROMPT,
  TOPIC_SWITCH_DETECTION_PROMPT,
} from 'src/utils/prompts'

import { DownloadStatusStrategy } from './strategies/download-status.strategy'
import { MediaBrowsingStrategy } from './strategies/media-browsing.strategy'
import { MovieDeleteStrategy } from './strategies/movie-delete.strategy'
import { MovieDownloadStrategy } from './strategies/movie-download.strategy'
import { TvDeleteStrategy } from './strategies/tv-delete.strategy'
import { TvDownloadStrategy } from './strategies/tv-download.strategy'
import {
  ActiveMediaContext,
  DiscordIdentity,
  MediaContextType,
  StrategyRequestParams,
} from './types/request-context.type'
import { StrategyResult } from './types/strategy-result.type'
import { toQualityTier } from './utils/quality.utils'

/** Classification replies are tiny; cap them. */
const MAX_CLASSIFICATION_TOKENS = 500

/**
 * MediaRequestHandler - Routes media requests to appropriate strategies
 *
 * Responsibilities:
 * - Resume an active context (multi-turn operations) handed in by the caller
 * - Determine request intent (download, delete, browse, status)
 * - Classify media type (movie vs TV show)
 * - Route to appropriate strategy
 * - Report a topic switch so the caller can re-route the message
 */
@Injectable()
export class MediaRequestHandler {
  private readonly logger = new Logger(MediaRequestHandler.name)

  constructor(
    private readonly llm: LlmClient,
    // Strategy classes
    private readonly movieDownloadStrategy: MovieDownloadStrategy,
    private readonly tvDownloadStrategy: TvDownloadStrategy,
    private readonly movieDeleteStrategy: MovieDeleteStrategy,
    private readonly tvDeleteStrategy: TvDeleteStrategy,
    private readonly mediaBrowsingStrategy: MediaBrowsingStrategy,
    private readonly downloadStatusStrategy: DownloadStatusStrategy,
  ) {
    this.logger.log('MediaRequestHandler initialized')
  }

  /**
   * Handle a media request by routing to appropriate strategy
   * Extracted from llm.service.ts:640-797
   *
   * `discord` is the sender's identity; every strategy receives it in its
   * params so requests it forwards to the download app are attributed to them.
   *
   * Multi-turn state is the caller's: `activeContext` is the `pendingContext`
   * an earlier result returned. When the message has switched topics instead
   * of answering it, the result is `{ reroute: true }` with nothing to say.
   */
  async handleRequest(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
    discord: DiscordIdentity,
    activeContext?: ActiveMediaContext | null,
  ): Promise<StrategyResult> {
    this.logger.log({ userId }, 'Handling media request')

    try {
      // Step 1: Resume the active context first (multi-turn operations)
      if (activeContext) {
        if (await this.detectTopicSwitch(message)) {
          this.logger.log(
            { userId, contextType: activeContext.type },
            'Topic switch detected, dropping context',
          )
          return { images: [], messages: [], reroute: true }
        }

        this.logger.log(
          { userId, contextType: activeContext.type },
          'Found active context, routing to appropriate strategy',
        )

        const params = {
          message,
          messages,
          userId,
          discord,
          context: activeContext.data,
        }

        // Route based on context type
        switch (activeContext.type) {
          case MediaContextType.MovieDownload:
            return await this.movieDownloadStrategy.handleRequest(params)
          case MediaContextType.TvDownload:
            return await this.tvDownloadStrategy.handleRequest(params)
          case MediaContextType.MovieDelete:
            return await this.movieDeleteStrategy.handleRequest(params)
          case MediaContextType.TvDelete:
            return await this.tvDeleteStrategy.handleRequest(params)
          default:
            this.logger.warn(
              { contextType: activeContext.type },
              'Unknown context type, ignoring and continuing',
            )
        }
      }

      // Step 2: No active context - determine media intent
      const mediaRequest = await this.getMediaTypeAndIntent(message)
      this.logger.log(
        {
          userId,
          mediaType: mediaRequest.mediaType,
          searchIntent: mediaRequest.searchIntent,
        },
        'Determined media intent',
      )

      // Step 3: Check if this is a download status request first (highest priority)
      if (this.isDownloadStatusRequest(message)) {
        this.logger.log({ userId }, 'Routing to download status flow')
        return await this.downloadStatusStrategy.handleRequest({
          message,
          messages,
          userId,
          discord,
        })
      }

      // Step 4: Route based on intent: download vs delete vs browse
      if (this.isDownloadRequest(mediaRequest, message)) {
        this.logger.log({ userId }, 'Routing to download flow')
        return await this.routeDownloadRequest(
          message,
          messages,
          userId,
          discord,
          mediaRequest,
        )
      } else if (this.isDeleteRequest(mediaRequest)) {
        this.logger.log({ userId }, 'Routing to delete flow')
        return await this.routeDeleteRequest(
          message,
          messages,
          userId,
          discord,
          mediaRequest,
        )
      } else {
        // Browse or library search
        this.logger.log({ userId }, 'Routing to media browsing flow')
        return await this.mediaBrowsingStrategy.handleRequest({
          message,
          messages,
          userId,
          discord,
          context: mediaRequest,
        })
      }
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
        },
        'Error handling media request',
      )
      throw error
    }
  }

  /**
   * Route download request to appropriate strategy based on media type.
   * A quality the message named rides along as `qualityTier`; with none, the
   * key is left off so the download app's default tier applies.
   */
  private async routeDownloadRequest(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
    discord: DiscordIdentity,
    mediaRequest: MediaRequest,
  ): Promise<StrategyResult> {
    const qualityTier = toQualityTier(mediaRequest.quality)
    const params: StrategyRequestParams = {
      message,
      messages,
      userId,
      discord,
      ...(qualityTier ? { qualityTier } : {}),
    }

    // Direct media type routing
    if (mediaRequest.mediaType === MediaRequestType.Shows) {
      return await this.tvDownloadStrategy.handleRequest(params)
    }

    if (mediaRequest.mediaType === MediaRequestType.Movies) {
      return await this.movieDownloadStrategy.handleRequest(params)
    }

    // MediaRequestType.Both - use LLM classification
    const classification = await this.classifyMediaType(message)

    this.logger.log(
      {
        userId,
        classification,
        message: this.getMessageContent(message),
      },
      'Using LLM classification for download media type',
    )

    if (classification.mediaType === 'tv_show') {
      return await this.tvDownloadStrategy.handleRequest(params)
    } else {
      return await this.movieDownloadStrategy.handleRequest(params)
    }
  }

  /**
   * Route delete request to appropriate strategy based on media type
   */
  private async routeDeleteRequest(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
    discord: DiscordIdentity,
    mediaRequest: MediaRequest,
  ): Promise<StrategyResult> {
    const params = { message, messages, userId, discord }

    // Direct media type routing
    if (mediaRequest.mediaType === MediaRequestType.Movies) {
      return await this.movieDeleteStrategy.handleRequest(params)
    }

    if (mediaRequest.mediaType === MediaRequestType.Shows) {
      return await this.tvDeleteStrategy.handleRequest(params)
    }

    // MediaRequestType.Both - use LLM classification
    const classification = await this.classifyMediaType(message)

    this.logger.log(
      {
        userId,
        classification,
        message: this.getMessageContent(message),
      },
      'Using LLM classification for delete media type',
    )

    if (classification.mediaType === 'tv_show') {
      return await this.tvDeleteStrategy.handleRequest(params)
    } else {
      return await this.movieDeleteStrategy.handleRequest(params)
    }
  }

  /**
   * Determine media type and search intent from message
   * Extracted from llm.service.ts:2684-2719
   */
  private async getMediaTypeAndIntent(
    message: HumanMessage,
  ): Promise<MediaRequest> {
    try {
      this.logger.log('Determining media type and search intent')
      const startTime = Date.now()
      const { output: validated, message: mediaTypeResponse } =
        await this.llm.call({
          operation: 'media.intent',
          role: 'reasoning',
          messages: [GET_MEDIA_TYPE_PROMPT, message],
          schema: MediaRequestSchema,
          overrides: { maxTokens: MAX_CLASSIFICATION_TOKENS },
        })
      const responseContent = String(mediaTypeResponse.content)

      this.logger.log(
        {
          duration: Date.now() - startTime,
          mediaType: validated.mediaType,
          searchIntent: validated.searchIntent,
          quality: validated.quality,
          rawResponse: responseContent,
        },
        'Successfully determined media intent',
      )

      return validated
    } catch (error) {
      this.logger.warn(
        {
          response: error,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Invalid media request response, using defaults',
      )

      // Fallback to defaults
      return {
        mediaType: MediaRequestType.Both,
        searchIntent: SearchIntent.Library,
        searchTerms: '',
      }
    }
  }

  /**
   * Check if this is a download status request
   * Extracted from llm.service.ts:2749-2768
   */
  private isDownloadStatusRequest(message: HumanMessage): boolean {
    const messageContent =
      typeof message.content === 'string'
        ? message.content.toLowerCase()
        : message.content.toString().toLowerCase()

    // Check for download status specific keywords
    const statusKeywords = [
      'download status',
      'downloading',
      'current download',
      'any download',
      "what's download",
      'downloads',
      'download progress',
      'active download',
    ]

    return statusKeywords.some(keyword => messageContent.includes(keyword))
  }

  /**
   * Check if this is a download request
   * Extracted from llm.service.ts:2721-2742
   */
  private isDownloadRequest(
    mediaRequest: MediaRequest,
    message: HumanMessage,
  ): boolean {
    const messageContent =
      typeof message.content === 'string'
        ? message.content.toLowerCase()
        : message.content.toString().toLowerCase()

    // Check for download-specific keywords
    const downloadKeywords = ['download', 'add', 'get me', 'grab', 'fetch']
    const hasDownloadKeyword = downloadKeywords.some(keyword =>
      messageContent.includes(keyword),
    )

    // If external search with download keywords, it's likely a download request
    return (
      (mediaRequest.searchIntent === SearchIntent.External &&
        hasDownloadKeyword) ||
      (mediaRequest.searchIntent === SearchIntent.Both && hasDownloadKeyword)
    )
  }

  /**
   * Check if this is a delete request
   * Extracted from llm.service.ts:2744-2747
   */
  private isDeleteRequest(mediaRequest: MediaRequest): boolean {
    // Delete requests are identified by the SearchIntent.Delete
    return mediaRequest.searchIntent === SearchIntent.Delete
  }

  /**
   * Classify media type when ambiguous (movie vs TV show)
   * Extracted from llm.service.ts:3197-3252
   */
  private async classifyMediaType(
    message: HumanMessage,
  ): Promise<MediaTypeClassification> {
    const messageContent = this.getMessageContent(message)

    const systemPrompt = dedent`
      You are a media type classifier. Your job is to determine if a user's message is asking for movies or TV shows.

      Consider these factors:
      - Specific titles mentioned (e.g., "Breaking Bad" is a TV show, "The Avengers" is a movie)
      - Context clues like "seasons", "episodes", "series" suggest TV shows
      - Context clues like "film", "movie", "cinema" suggest movies
      - General requests like "something to watch" could be either - use your best judgment

      Examples:
      - "I want to watch Breaking Bad" → tv_show (it's a known TV series)
      - "Show me some good movies" → movie (despite containing "show", context is clear)
      - "Looking for a new series to binge" → tv_show (clear intent)
      - "Any good action films?" → movie (clear intent)
      - "What should I watch tonight?" → Use context or default to movie if unclear

      Make your best determination based on the available context clues.
    `

    try {
      const startTime = Date.now()
      const { output: result } = await this.llm.call({
        operation: 'media.classifyType',
        role: 'reasoning',
        messages: [
          new SystemMessage(systemPrompt),
          new HumanMessage(messageContent),
        ],
        schema: MediaTypeClassificationSchema,
      })

      this.logger.log(
        {
          message: messageContent,
          classification: result,
          duration: Date.now() - startTime,
        },
        'Classified media type with LLM',
      )

      return result
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          message: messageContent,
        },
        'Media type classification failed, defaulting to movie',
      )

      // Default to movie on error
      return { mediaType: 'movie' }
    }
  }

  /**
   * Extract message content as string
   */
  private getMessageContent(message: HumanMessage): string {
    return typeof message.content === 'string'
      ? message.content
      : message.content.toString()
  }

  /**
   * Detect if user switched topics from media selection context
   * Extracted from llm.service.ts:335-370
   *
   * @param message - The user's message to check
   * @returns true if user switched topics, false if still in media selection context
   */
  async detectTopicSwitch(message: HumanMessage): Promise<boolean> {
    try {
      const userInput = this.getMessageContent(message)

      const promptContent =
        typeof TOPIC_SWITCH_DETECTION_PROMPT.content === 'string'
          ? TOPIC_SWITCH_DETECTION_PROMPT.content.replace(
              '[USER_MESSAGE]',
              userInput,
            )
          : 'Determine if user switched topics from media selection.'

      const promptMessage = new HumanMessage({
        id: nanoid(),
        content: `${promptContent}\n\nUser message: "${userInput}"`,
      })

      const response = await this.llm.call({
        operation: 'media.topicSwitch',
        role: 'reasoning',
        messages: [promptMessage],
        overrides: { maxTokens: MAX_CLASSIFICATION_TOKENS },
      })

      const result = response.output.trim().toUpperCase()
      const switched = result === 'SWITCH'

      this.logger.log(
        {
          userInput,
          result,
          switched,
        },
        'Topic switch detection completed',
      )

      return switched
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          message: this.getMessageContent(message),
        },
        'Failed to detect topic switch, assuming no switch',
      )
      return false // Default to not switching on error
    }
  }
}
