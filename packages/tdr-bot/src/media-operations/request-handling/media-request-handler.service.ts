import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { Injectable, Logger } from '@nestjs/common'
import dedent from 'dedent'
import { nanoid } from 'nanoid'

import { ContextManagementService } from 'src/message-handler/context/context-management.service'
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
import { RetryService } from 'src/utils/retry.service'

import { DownloadStatusStrategy } from './strategies/download-status.strategy'
import { MediaBrowsingStrategy } from './strategies/media-browsing.strategy'
import { MovieDeleteStrategy } from './strategies/movie-delete.strategy'
import { MovieDownloadStrategy } from './strategies/movie-download.strategy'
import { TvDeleteStrategy } from './strategies/tv-delete.strategy'
import { TvDownloadStrategy } from './strategies/tv-download.strategy'
import { StrategyResult } from './types/strategy-result.type'

const REASONING_TEMPERATURE = 0

/**
 * MediaRequestHandler - Routes media requests to appropriate strategies
 *
 * Responsibilities:
 * - Check for active contexts (multi-turn operations)
 * - Determine request intent (download, delete, browse, status)
 * - Classify media type (movie vs TV show)
 * - Route to appropriate strategy
 * - Handle request deduplication via context checking
 */
@Injectable()
export class MediaRequestHandler {
  private readonly logger = new Logger(MediaRequestHandler.name)

  constructor(
    private readonly contextService: ContextManagementService,
    private readonly retryService: RetryService,
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
   */
  async handleRequest(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
    state?: unknown,
  ): Promise<StrategyResult> {
    this.logger.log({ userId }, 'Handling media request')

    try {
      // Step 1: Check for active contexts first (multi-turn operations)
      // getActiveContext now includes topic switch detection
      const activeContext = await this.getActiveContext(userId, message)

      if (activeContext) {
        this.logger.log(
          { userId, contextType: activeContext.type },
          'Found active context, routing to appropriate strategy',
        )

        const params = {
          message,
          messages,
          userId,
          context: activeContext.data,
          state,
        }

        // Route based on context type
        switch (activeContext.type) {
          case 'movie':
            return await this.movieDownloadStrategy.handleRequest(params)
          case 'tv':
            return await this.tvDownloadStrategy.handleRequest(params)
          case 'movieDelete':
            return await this.movieDeleteStrategy.handleRequest(params)
          case 'tvDelete':
            return await this.tvDeleteStrategy.handleRequest(params)
          default:
            this.logger.warn(
              { contextType: activeContext.type },
              'Unknown context type, clearing and continuing',
            )
            await this.contextService.clearContext(userId)
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
          state,
        })
      }

      // Step 4: Route based on intent: download vs delete vs browse
      if (this.isDownloadRequest(mediaRequest, message)) {
        this.logger.log({ userId }, 'Routing to download flow')
        return await this.routeDownloadRequest(
          message,
          messages,
          userId,
          mediaRequest,
          state,
        )
      } else if (this.isDeleteRequest(mediaRequest)) {
        this.logger.log({ userId }, 'Routing to delete flow')
        return await this.routeDeleteRequest(
          message,
          messages,
          userId,
          mediaRequest,
          state,
        )
      } else {
        // Browse or library search
        this.logger.log({ userId }, 'Routing to media browsing flow')
        return await this.mediaBrowsingStrategy.handleRequest({
          message,
          messages,
          userId,
          context: mediaRequest,
          state,
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
   * Route download request to appropriate strategy based on media type
   */
  private async routeDownloadRequest(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
    mediaRequest: MediaRequest,
    state?: unknown,
  ): Promise<StrategyResult> {
    const params = { message, messages, userId, state }

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
    mediaRequest: MediaRequest,
    state?: unknown,
  ): Promise<StrategyResult> {
    const params = { message, messages, userId, state }

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
   * Check if user has an active media context
   * Used for optimization: allows skipping LLM intent detection during multi-turn operations
   * Includes topic switch detection - if user switched topics, clears context and returns false
   *
   * @param userId - User ID to check context for
   * @param message - Current message from user
   * @returns true if active context exists and user still in context, false otherwise
   */
  public async hasActiveMediaContext(
    userId: string,
    message: HumanMessage,
  ): Promise<boolean> {
    const hasContext = await this.contextService.hasContext(userId)
    if (!hasContext) {
      return false
    }

    // Check if user switched topics using LLM
    const topicSwitched = await this.detectTopicSwitch(message)
    if (topicSwitched) {
      this.logger.log({ userId }, 'Topic switch detected, clearing context')
      await this.contextService.clearContext(userId)
      return false
    }

    this.logger.log(
      { userId },
      'Active media context exists, user still in context',
    )
    return true
  }

  /**
   * Check for active user contexts
   * Returns the active context with type and data if one exists
   * Includes topic switch detection - if user switched topics, clears context and returns null
   */
  private async getActiveContext(
    userId: string,
    message: HumanMessage,
  ): Promise<{ type: string; data: unknown } | null> {
    const hasContext = await this.contextService.hasContext(userId)
    if (!hasContext) {
      return null
    }

    // Parallelize context lookup - both read from same map independently
    const [contextType, contextData] = await Promise.all([
      this.contextService.getContextType(userId),
      this.contextService.getContext(userId),
    ])

    if (!contextType || !contextData) {
      return null
    }

    // Check if user switched topics using LLM
    const topicSwitched = await this.detectTopicSwitch(message)
    if (topicSwitched) {
      this.logger.log(
        { userId, contextType },
        'Topic switch detected, clearing context',
      )
      await this.contextService.clearContext(userId)
      return null
    }

    this.logger.log(
      { userId, contextType },
      'User still in context, maintaining active context',
    )

    return {
      type: contextType,
      data: contextData,
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
      const mediaTypeResponse = await this.retryService.executeWithRetry(
        () => this.getReasoningModel().invoke([GET_MEDIA_TYPE_PROMPT, message]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        'OpenAI-getMediaTypeAndIntent',
      )

      const responseContent = mediaTypeResponse.content as string
      const parsedResponse = JSON.parse(responseContent)
      const validated = MediaRequestSchema.parse(parsedResponse)

      this.logger.log(
        {
          duration: Date.now() - startTime,
          mediaType: validated.mediaType,
          searchIntent: validated.searchIntent,
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

    const classificationModel = new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: REASONING_TEMPERATURE,
    }).withStructuredOutput(MediaTypeClassificationSchema)

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
      const result = await classificationModel.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messageContent },
      ])

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
   * Get reasoning model for intent detection
   */
  private getReasoningModel() {
    return new ChatOpenAI({
      model: 'gpt-4o-mini',
      temperature: REASONING_TEMPERATURE,
      maxTokens: 500, // Small response for classification
    })
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
  private async detectTopicSwitch(message: HumanMessage): Promise<boolean> {
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

      const response = await this.retryService.executeWithRetry(
        () => this.getReasoningModel().invoke([promptMessage]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-detectTopicSwitch',
      )

      const result = response.content.toString().trim().toUpperCase()
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
