import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import {
  BaseMessage,
  HumanMessage,
  isAIMessage,
  SystemMessage,
} from '@langchain/core/messages'
import { StateGraph, StateType, UpdateType } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai'
import { isEnumValue } from '@lilnas/utils/enum'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import dedent from 'dedent'
import { nanoid } from 'nanoid'

import { MAX_SEARCH_RESULTS, REASONING_TEMPERATURE } from 'src/constants/llm'
import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import {
  MovieLibrarySearchResult,
  MovieSearchResult,
} from 'src/media/types/radarr.types'
import {
  SeriesSearchResult,
  UnmonitorAndDeleteSeriesResult,
} from 'src/media/types/sonarr.types'
import {
  GraphNode,
  ImageQuerySchema,
  ImageResponseSchema,
  InputStateAnnotation,
  MediaRequest,
  MediaRequestSchema,
  MediaRequestType,
  OutputStateAnnotation,
  OverallStateAnnotation,
  ResponseType,
  SearchIntent,
} from 'src/schemas/graph'
import {
  MediaTypeClassification,
  MediaTypeClassificationSchema,
} from 'src/schemas/media-classification'
import { MessageResponse } from 'src/schemas/messages'
import { MovieDeleteContext, MovieSelectionContext } from 'src/schemas/movie'
import {
  SearchSelection,
  SearchSelectionSchema,
} from 'src/schemas/search-selection'
import {
  TvShowDeleteContext,
  TvShowSelection,
  TvShowSelectionContext,
  TvShowSelectionSchema,
} from 'src/schemas/tv-show'
import { EquationImageService } from 'src/services/equation-image.service'
import { StateService } from 'src/state/state.service'
import { UnhandledMessageResponseError } from 'src/utils/error'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import {
  DOWNLOAD_STATUS_RESPONSE_PROMPT,
  EXTRACT_IMAGE_QUERIES_PROMPT,
  EXTRACT_SEARCH_QUERY_PROMPT,
  EXTRACT_TV_SEARCH_QUERY_PROMPT,
  GET_CHAT_MATH_RESPONSE,
  GET_MATH_RESPONSE_PROMPT,
  GET_MEDIA_TYPE_PROMPT,
  GET_RESPONSE_TYPE_PROMPT,
  IMAGE_RESPONSE,
  MEDIA_CONTEXT_PROMPT,
  MOVIE_RESPONSE_CONTEXT_PROMPT,
  MOVIE_SELECTION_PARSING_PROMPT,
  TDR_SYSTEM_PROMPT_ID,
  TOPIC_SWITCH_DETECTION_PROMPT,
  TV_SHOW_DELETE_RESPONSE_CONTEXT_PROMPT,
  TV_SHOW_RESPONSE_CONTEXT_PROMPT,
  TV_SHOW_SELECTION_PARSING_PROMPT,
} from 'src/utils/prompts'
import { RetryService } from 'src/utils/retry.service'

import { dateTool } from './tools'

const RESPONSE_TYPE_GRAPH_NODE_MAP: Record<ResponseType, GraphNode> = {
  [ResponseType.Default]: GraphNode.GetModelDefaultResponse,
  [ResponseType.Math]: GraphNode.GetModelMathResponse,
  [ResponseType.Image]: GraphNode.GetModelImageResponse,
  [ResponseType.Media]: GraphNode.GetModelMediaResponse,
}

/**
 * Service interacting with OpenAI's LLM.
 */
@Injectable()
export class LLMService {
  constructor(
    private readonly state: StateService,
    private readonly equationImage: EquationImageService,
    private readonly retryService: RetryService,
    private readonly errorClassifier: ErrorClassificationService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {
    // Log tool registration for debugging
    this.logger.log(
      {
        totalToolCount: this.tools.length,
        toolNames: this.tools.map(t => t.name),
      },
      'LLM tools registered and initialized',
    )
  }

  private readonly logger = new Logger(LLMService.name)

  private tools = [new TavilySearchResults(), dateTool]

  private toolNode = new ToolNode(this.tools)

  private app = new StateGraph<
    (typeof OverallStateAnnotation)['spec'],
    StateType<(typeof OverallStateAnnotation)['spec']>,
    UpdateType<(typeof OutputStateAnnotation)['spec']>,
    GraphNode.Start,
    (typeof InputStateAnnotation)['spec'],
    (typeof OutputStateAnnotation)['spec']
  >({
    input: InputStateAnnotation,
    output: OutputStateAnnotation,
    stateSchema: OverallStateAnnotation,
  })
    // Nodes
    .addNode(GraphNode.CheckResponseType, this.checkResponseType.bind(this))
    .addNode(GraphNode.AddTdrSystemPrompt, this.addTdrSystemPrompt.bind(this))
    .addNode(GraphNode.TrimMessages, this.trimMessages.bind(this))
    .addNode(
      GraphNode.GetModelDefaultResponse,
      this.getModelDefaultResponse.bind(this),
    )
    .addNode(
      GraphNode.GetModelImageResponse,
      this.getModelImageResponse.bind(this),
    )
    .addNode(
      GraphNode.GetModelMathResponse,
      this.getModelMathResponse.bind(this),
    )
    .addNode(
      GraphNode.GetModelMediaResponse,
      this.getModelMediaResponse.bind(this),
    )
    .addNode(GraphNode.Tools, this.toolNode)
    // Edges
    .addEdge(GraphNode.Start, GraphNode.CheckResponseType)
    .addEdge(GraphNode.CheckResponseType, GraphNode.TrimMessages)
    .addEdge(GraphNode.TrimMessages, GraphNode.AddTdrSystemPrompt)
    .addEdge(GraphNode.Tools, GraphNode.GetModelDefaultResponse)
    .addEdge(GraphNode.GetModelImageResponse, GraphNode.End)
    .addEdge(GraphNode.GetModelMathResponse, GraphNode.End)
    .addEdge(GraphNode.GetModelMediaResponse, GraphNode.End)
    // Conditional edges
    .addConditionalEdges(
      GraphNode.AddTdrSystemPrompt,
      state => RESPONSE_TYPE_GRAPH_NODE_MAP[state.responseType],
    )
    .addConditionalEdges(
      GraphNode.GetModelDefaultResponse,
      this.handleModelResponse.bind(this),
    )
    // Compile graph into langchain runnable
    .compile()

  private getReasoningModel() {
    const state = this.state.getState()

    this.logger.log({ model: state.reasoningModel }, 'Getting reasoning model')

    return new ChatOpenAI({
      model: state.reasoningModel,
      temperature: REASONING_TEMPERATURE,
    })
  }

  private getChatModel() {
    const state = this.state.getState()

    this.logger.log({ model: state.chatModel }, 'Getting chat model')

    return new ChatOpenAI({
      model: state.chatModel,
      temperature: state.temperature,
    }).bindTools(this.tools)
  }

  private async checkResponseType({
    userInput,
    userId,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log({ userId }, 'Checking response type')

    // Clean up expired contexts first
    this.state.cleanupExpiredMovieContexts()
    this.state.cleanupExpiredMovieDeleteContexts()
    this.state.cleanupExpiredTvShowContexts()
    this.state.cleanupExpiredTvShowDeleteContexts()

    // Check for active movie context first
    const movieContext = this.state.getUserMovieContext(userId)
    if (
      movieContext?.isActive &&
      !this.state.isMovieContextExpired(movieContext)
    ) {
      this.logger.log(
        { userId, query: movieContext.query },
        'Active movie context found',
      )

      // Check if user switched topics using LLM
      const topicSwitched = await this.detectTopicSwitch(userInput)
      if (topicSwitched) {
        this.logger.log(
          { userId },
          'Topic switch detected, clearing movie context',
        )
        this.state.clearUserMovieContext(userId)
        // Continue with normal intent detection
      } else {
        this.logger.log(
          { userId },
          'User still in movie context, routing to media response',
        )
        const message = new HumanMessage({
          id: nanoid(),
          content: userInput,
        })
        return { message, responseType: ResponseType.Media }
      }
    }

    // Check for active TV show context
    const tvShowContext = this.state.getUserTvShowContext(userId)
    if (
      tvShowContext?.isActive &&
      !this.state.isTvShowContextExpired(tvShowContext)
    ) {
      this.logger.log(
        { userId, query: tvShowContext.query },
        'Active TV show context found',
      )

      // Check if user switched topics using LLM
      const topicSwitched = await this.detectTopicSwitch(userInput)
      if (topicSwitched) {
        this.logger.log(
          { userId },
          'Topic switch detected, clearing TV show context',
        )
        this.state.clearUserTvShowContext(userId)
        // Continue with normal intent detection
      } else {
        this.logger.log(
          { userId },
          'User still in TV show context, routing to media response',
        )
        const message = new HumanMessage({
          id: nanoid(),
          content: userInput,
        })
        return { message, responseType: ResponseType.Media }
      }
    }

    // Check for active movie delete context
    const movieDeleteContext = this.state.getUserMovieDeleteContext(userId)
    if (
      movieDeleteContext?.isActive &&
      !this.state.isMovieDeleteContextExpired(movieDeleteContext)
    ) {
      this.logger.log(
        { userId, query: movieDeleteContext.query },
        'Active movie delete context found',
      )

      // Check if user switched topics using LLM
      const topicSwitched = await this.detectTopicSwitch(userInput)
      if (topicSwitched) {
        this.logger.log(
          { userId },
          'Topic switch detected, clearing movie delete context',
        )
        this.state.clearUserMovieDeleteContext(userId)
        // Continue with normal intent detection
      } else {
        this.logger.log(
          { userId },
          'User still in movie delete context, routing to media response',
        )
        const message = new HumanMessage({
          id: nanoid(),
          content: userInput,
        })
        return { message, responseType: ResponseType.Media }
      }
    }

    // Standard intent detection if no active context or topic switched
    const message = new HumanMessage({
      id: nanoid(),
      content: userInput,
    })

    const response = await this.retryService.executeWithRetry(
      () =>
        this.getReasoningModel().invoke([GET_RESPONSE_TYPE_PROMPT, message]),
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        timeout: 30000,
      },
      'OpenAI-checkResponseType',
    )

    if (!isEnumValue(response.content, ResponseType)) {
      throw new Error(`Invalid response type: "${response.content}"`)
    }

    const responseType = response.content as ResponseType

    this.logger.log({ responseType }, 'Got response type')

    return { message, responseType }
  }

  private async detectTopicSwitch(userInput: string): Promise<boolean> {
    try {
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
      return result === 'SWITCH'
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userInput },
        'Failed to detect topic switch, assuming no switch',
      )
      return false // Default to not switching on error
    }
  }

  private addTdrSystemPrompt({
    message,
    messages,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log('Checking for TDR system prompt')

    if (messages?.some(message => message.id === TDR_SYSTEM_PROMPT_ID)) {
      this.logger.log('TDR system prompt found')
      return { messages: messages.concat(message) }
    }

    this.logger.log('Adding TDR system prompt')
    return { messages: [this.state.getPrompt(), message] }
  }

  private isToolsMessage(message: BaseMessage) {
    return (
      isAIMessage(message) &&
      message.tool_calls &&
      message.tool_calls.length > 0
    )
  }

  private handleModelResponse({
    messages,
  }: typeof OverallStateAnnotation.State) {
    const lastMessage = messages[messages.length - 1]

    if (this.isToolsMessage(lastMessage)) {
      return GraphNode.Tools
    }

    return GraphNode.End
  }

  private async getModelDefaultResponse({
    messages,
    prevMessages,
  }: typeof OverallStateAnnotation.State) {
    const allMessages = (prevMessages ?? []).concat(messages)

    this.logger.log('Getting response from model')
    const response = await this.retryService.executeWithRetry(
      () => this.getChatModel().invoke(allMessages),
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        timeout: 45000,
      },
      'OpenAI-getModelDefaultResponse',
    )
    this.logger.log('Got response from model')

    const messagesWithResponse = allMessages.concat(response)

    // Store previous messages in state because tools node loses that info somehow
    // TODO fix issue with messages being erased from state.
    return {
      messages: messagesWithResponse,
      prevMessages: messagesWithResponse,
    }
  }

  private async getModelImageResponse({
    message,
    messages,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log({ message: message.content }, 'Extracting image queries')

    try {
      const extractImageQueriesResponse =
        await this.retryService.executeWithRetry(
          () =>
            this.getReasoningModel().invoke([
              EXTRACT_IMAGE_QUERIES_PROMPT,
              message,
            ]),
          {
            maxAttempts: 3,
            baseDelay: 1000,
            maxDelay: 30000,
            timeout: 30000,
          },
          'OpenAI-getModelImageResponse-extract',
        )

      const imageQueries = ImageQuerySchema.parse(
        JSON.parse(extractImageQueriesResponse.content as string),
      )

      this.logger.log({ queries: imageQueries }, 'Got image queries')

      const dalle = new DallEAPIWrapper()
      const images = await Promise.all(
        imageQueries.map(async ({ title, query }) => {
          const url = await this.retryService.executeWithRetry(
            () => dalle.invoke(query),
            {
              maxAttempts: 3,
              baseDelay: 2000,
              maxDelay: 60000,
              timeout: 60000,
            },
            `DallE-generate-${title}`,
          )

          return ImageResponseSchema.parse({
            title,
            url,
          })
        }),
      )

      this.logger.log({ images }, 'Got image URLs')

      const chatResponse = await this.retryService.executeWithRetry(
        () => this.getChatModel().invoke([...messages, IMAGE_RESPONSE]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        'OpenAI-getModelImageResponse-chat',
      )

      return {
        images: images.map(image => ({
          ...image,
          parentId: chatResponse.id,
        })),
        messages: messages.concat(chatResponse),
      }
    } catch (err) {
      this.logger.error(
        { err: getErrorMessage(err) },
        'Error extracting image queries',
      )

      return { messages: messages.concat(message) }
    }
  }

  private async getModelMathResponse({
    message,
    messages,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log({ message: message.content }, 'Get complex math solution')

    const latexResponse = await this.retryService.executeWithRetry(
      () =>
        this.getReasoningModel().invoke(
          messages
            .filter(message => message.id !== TDR_SYSTEM_PROMPT_ID)
            .concat(GET_MATH_RESPONSE_PROMPT),
        ),
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        timeout: 30000,
      },
      'OpenAI-getModelMathResponse-latex',
    )

    const latex = latexResponse.content.toString()
    const equationImageResponse = await this.equationImage.getImage(latex)

    const chatResponse = await this.retryService.executeWithRetry(
      () => this.getChatModel().invoke([...messages, GET_CHAT_MATH_RESPONSE]),
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        timeout: 30000,
      },
      'OpenAI-getModelMathResponse-chat',
    )

    return {
      images: equationImageResponse
        ? [
            {
              title: 'the solution',
              url: equationImageResponse.url,
              parentId: chatResponse.id,
            },
          ]
        : [],
      messages: messages.concat(chatResponse),
    }
  }

  private async getModelMediaResponse({
    message,
    messages,
    userId,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log(
      { message: message.content, userId },
      'Processing media request',
    )

    try {
      // Check if user has active movie delete context (selection phase)
      const movieDeleteContext = this.state.getUserMovieDeleteContext(userId)
      if (
        movieDeleteContext?.isActive &&
        !this.state.isMovieDeleteContextExpired(movieDeleteContext)
      ) {
        this.logger.log(
          { userId, query: movieDeleteContext.query },
          'Using existing movie delete context for selection',
        )
        return await this.handleMovieDeleteSelection(
          message,
          messages,
          movieDeleteContext,
          userId,
        )
      }

      // Check if user has active TV show delete context (selection phase)
      const tvShowDeleteContext = this.state.getUserTvShowDeleteContext(userId)
      if (
        tvShowDeleteContext?.isActive &&
        !this.state.isTvShowDeleteContextExpired(tvShowDeleteContext)
      ) {
        this.logger.log(
          { userId, query: tvShowDeleteContext.query },
          'Using existing TV show delete context for selection',
        )
        return await this.handleTvShowDeleteSelection(
          message,
          messages,
          tvShowDeleteContext,
          userId,
        )
      }

      // Check if user has active movie context (selection phase)
      const movieContext = this.state.getUserMovieContext(userId)
      if (movieContext?.isActive) {
        this.logger.log(
          { userId, query: movieContext.query },
          'Processing movie selection',
        )
        return await this.handleMovieSelection(
          message,
          messages,
          movieContext,
          userId,
        )
      }

      // Check if user has active TV show context (selection phase)
      const tvShowContext = this.state.getUserTvShowContext(userId)
      if (tvShowContext?.isActive) {
        this.logger.log(
          { userId, query: tvShowContext.query },
          'Processing TV show selection',
        )
        return await this.handleTvShowSelection(
          message,
          messages,
          tvShowContext,
          userId,
        )
      }

      // No active context - determine media intent
      const mediaRequest = await this.getMediaTypeAndIntent(message)
      this.logger.log(
        {
          userId,
          mediaType: mediaRequest.mediaType,
          searchIntent: mediaRequest.searchIntent,
        },
        'Determined media intent',
      )

      // Check if this is a download status request first
      if (this.isDownloadStatusRequest(message)) {
        this.logger.log({ userId }, 'Routing to download status flow')
        return await this.handleDownloadStatusRequest(message, messages, userId)
      }

      // Route based on intent: download vs delete vs browse
      if (this.isDownloadRequest(mediaRequest, message)) {
        this.logger.log({ userId }, 'Routing to download flow')

        // Check for existing contexts first before starting new searches
        const movieContext = this.state.getUserMovieContext(userId)
        const tvShowContext = this.state.getUserTvShowContext(userId)

        if (
          movieContext?.isActive &&
          !this.state.isMovieContextExpired(movieContext)
        ) {
          this.logger.log(
            { userId, query: movieContext.query },
            'Using existing movie context for download selection',
          )
          return await this.handleMovieSelection(
            message,
            messages,
            movieContext,
            userId,
          )
        }

        if (
          tvShowContext?.isActive &&
          !this.state.isTvShowContextExpired(tvShowContext)
        ) {
          this.logger.log(
            { userId, query: tvShowContext.query },
            'Using existing TV show context for download selection',
          )
          return await this.handleTvShowSelection(
            message,
            messages,
            tvShowContext,
            userId,
          )
        }

        // No existing context - start new search based on media type
        if (mediaRequest.mediaType === MediaRequestType.Shows) {
          return await this.handleNewTvShowSearch(message, messages, userId)
        } else if (mediaRequest.mediaType === MediaRequestType.Movies) {
          return await this.handleNewMovieSearch(message, messages, userId)
        } else {
          // MediaRequestType.Both - use LLM classification
          const classification = await this.classifyMediaType(message)

          this.logger.log(
            {
              userId,
              classification,
              message:
                typeof message.content === 'string'
                  ? message.content
                  : message.content.toString(),
            },
            'Using LLM classification for media type',
          )

          if (classification.mediaType === 'tv_show') {
            return await this.handleNewTvShowSearch(message, messages, userId)
          } else {
            return await this.handleNewMovieSearch(message, messages, userId)
          }
        }
      } else if (this.isDeleteRequest(mediaRequest)) {
        this.logger.log({ userId }, 'Routing to delete flow')

        // Check for existing delete contexts first
        const movieDeleteContext = this.state.getUserMovieDeleteContext(userId)
        const tvShowDeleteContext =
          this.state.getUserTvShowDeleteContext(userId)

        if (
          movieDeleteContext?.isActive &&
          !this.state.isMovieDeleteContextExpired(movieDeleteContext)
        ) {
          this.logger.log(
            { userId, query: movieDeleteContext.query },
            'Using existing movie delete context for selection',
          )
          return await this.handleMovieDeleteSelection(
            message,
            messages,
            movieDeleteContext,
            userId,
          )
        }

        if (
          tvShowDeleteContext?.isActive &&
          !this.state.isTvShowDeleteContextExpired(tvShowDeleteContext)
        ) {
          this.logger.log(
            { userId, query: tvShowDeleteContext.query },
            'Using existing TV show delete context for selection',
          )
          return await this.handleTvShowDeleteSelection(
            message,
            messages,
            tvShowDeleteContext,
            userId,
          )
        }

        // No existing delete context - start new delete based on media type
        if (mediaRequest.mediaType === MediaRequestType.Movies) {
          return await this.handleNewMovieDelete(message, messages, userId)
        } else if (mediaRequest.mediaType === MediaRequestType.Shows) {
          return await this.handleNewTvShowDelete(message, messages, userId)
        } else {
          // MediaRequestType.Both - use LLM classification
          const classification = await this.classifyMediaType(message)

          this.logger.log(
            {
              userId,
              classification,
              message:
                typeof message.content === 'string'
                  ? message.content
                  : message.content.toString(),
            },
            'Using LLM classification for delete media type',
          )

          if (classification.mediaType === 'tv_show') {
            return await this.handleNewTvShowDelete(message, messages, userId)
          } else {
            return await this.handleNewMovieDelete(message, messages, userId)
          }
        }
      } else {
        this.logger.log({ userId }, 'Routing to media browsing flow')
        return await this.handleMediaBrowsing(mediaRequest, message, messages)
      }
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
        },
        'Error processing media request',
      )

      // Clear any active context on error
      this.state.clearUserMovieContext(userId)
      this.state.clearUserMovieDeleteContext(userId)
      this.state.clearUserTvShowContext(userId)
      this.state.clearUserTvShowDeleteContext(userId)

      const fallbackResponse = await this.generateChatResponse(
        messages,
        'error',
        {
          errorMessage:
            'Ran into an issue with your media request. Services might be unavailable.',
        },
      )

      return {
        images: [],
        messages: messages.concat(fallbackResponse),
      }
    }
  }

  private async handleMediaBrowsing(
    mediaRequest: MediaRequest,
    message: HumanMessage,
    messages: BaseMessage[],
  ) {
    const { mediaType, searchIntent, searchTerms } = mediaRequest
    const searchQuery = searchTerms.trim()

    this.logger.log(
      { mediaType, searchIntent, searchQuery },
      'Processing media browsing request',
    )

    // Fetch data based on intent and type
    let mediaData = ''
    let totalCount = 0

    // Fetch library data if needed
    if (
      searchIntent === SearchIntent.Library ||
      searchIntent === SearchIntent.Both
    ) {
      const libraryData = await this.fetchLibraryData(mediaType, searchQuery)
      mediaData += libraryData.content
      totalCount += libraryData.count
    }

    // Fetch external search data if needed
    if (
      searchIntent === SearchIntent.External ||
      searchIntent === SearchIntent.Both
    ) {
      if (searchQuery) {
        const externalData = await this.fetchExternalSearchData(
          mediaType,
          searchQuery,
        )
        if (searchIntent === SearchIntent.Both && mediaData) {
          mediaData += '\n\n---\n'
        }
        mediaData += externalData.content
        totalCount += externalData.count
      } else {
        this.logger.warn(
          'External search requested but no search terms extracted',
        )
        mediaData +=
          '\n\n**SEARCH:** Please provide more specific search terms to find new content.'
      }
    }

    // Create context prompt for conversational response
    const contextPrompt = new HumanMessage({
      content: `${typeof MEDIA_CONTEXT_PROMPT.content === 'string' ? MEDIA_CONTEXT_PROMPT.content : 'Respond about media content.'}\n\nUser's request: "${message.content}"\n\nMEDIA DATA:${mediaData}`,
      id: nanoid(),
    })

    // Get conversational response from chat model
    this.logger.log('Getting conversational response with media context')
    const chatResponse = await this.retryService.executeWithRetry(
      () => this.getChatModel().invoke([...messages, contextPrompt]),
      {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 30000,
        timeout: 45000,
      },
      'OpenAI-getMediaBrowsingResponse',
    )

    this.logger.log(
      { mediaType, searchIntent, totalCount },
      'Media browsing response generated successfully',
    )

    return {
      images: [],
      messages: messages.concat(chatResponse),
    }
  }

  private async handleNewMovieSearch(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ) {
    this.logger.log(
      { userId, content: message.content },
      'Starting new movie search',
    )

    // Parse both search query and selection criteria upfront
    const messageContent =
      typeof message.content === 'string'
        ? message.content
        : message.content.toString()
    const { searchQuery, selection } =
      await this.parseInitialSelection(messageContent)

    if (!searchQuery.trim()) {
      const clarificationResponse = await this.generateChatResponse(
        messages,
        'clarification',
      )
      return {
        images: [],
        messages: messages.concat(clarificationResponse),
      }
    }

    try {
      // Search for movies using RadarrService
      const searchResults = await this.radarrService.searchMovies(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: searchResults.length,
          hasSelection: !!selection,
        },
        'Movie search completed',
      )

      if (searchResults.length === 0) {
        const noResultsResponse = await this.generateChatResponse(
          messages,
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
        const selectedMovie = this.findSelectedMovie(selection, searchResults)
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

          // Generate acknowledgment message and download
          const response = await this.generateChatResponse(
            messages,
            'success',
            {
              selectedMovie,
              downloadResult: { movieAdded: true, searchTriggered: true },
              autoApplied: true,
              selectionCriteria: `${selection.selectionType}: ${selection.value}`,
            },
          )

          // Start download process
          const downloadResult =
            await this.radarrService.monitorAndDownloadMovie(
              selectedMovie.tmdbId,
            )

          if (!downloadResult.success) {
            // Override response with error if download failed
            const errorResponse = await this.generateChatResponse(
              messages,
              'error',
              {
                selectedMovie,
                errorMessage: `Failed to add "${selectedMovie.title}" to downloads: ${downloadResult.error}`,
              },
            )
            return {
              images: [],
              messages: messages.concat(errorResponse),
            }
          }

          return {
            images: [],
            messages: messages.concat(response),
          }
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
          message,
          messages,
          userId,
        )
      }

      // Multiple results - store context and ask user to choose
      const movieContext = {
        searchResults: searchResults.slice(0, MAX_SEARCH_RESULTS),
        query: searchQuery,
        timestamp: Date.now(),
        isActive: true,
      }

      this.state.setUserMovieContext(userId, movieContext)

      // Create selection prompt
      const selectionResponse = await this.generateChatResponse(
        messages,
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

      const errorResponse = await this.generateChatResponse(messages, 'error', {
        searchQuery,
        errorMessage: `Couldn't search for "${searchQuery}" right now. The Radarr service might be unavailable.`,
      })

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  private async handleMovieSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    movieContext: MovieSelectionContext,
    userId: string,
  ) {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing movie selection',
    )

    try {
      // Parse the user's selection using LLM
      const messageContent =
        typeof message.content === 'string'
          ? message.content
          : message.content.toString()
      const selection = await this.parseSearchSelection(messageContent).catch(
        () => null,
      )
      this.logger.log({ userId, selection }, 'Parsed movie selection')

      // If no selection was parsed, ask user to clarify
      if (!selection) {
        const clarificationResponse = await this.generateChatResponse(
          messages,
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
      const selectedMovie = this.findSelectedMovie(
        selection,
        movieContext.searchResults,
      )

      if (!selectedMovie) {
        const clarificationResponse = await this.generateChatResponse(
          messages,
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
      this.state.clearUserMovieContext(userId)
      return await this.downloadMovie(selectedMovie, message, messages, userId)
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process movie selection',
      )

      // Clear context on error
      this.state.clearUserMovieContext(userId)

      const errorResponse = await this.generateChatResponse(
        messages,
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

  private async downloadMovie(
    movie: MovieSearchResult,
    _originalMessage: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ) {
    this.logger.log(
      { userId, movieTitle: movie.title, tmdbId: movie.tmdbId },
      'Attempting to download movie',
    )

    try {
      const result = await this.radarrService.monitorAndDownloadMovie(
        movie.tmdbId,
      )

      if (result.success) {
        const successResponse = await this.generateChatResponse(
          messages,
          'success',
          {
            selectedMovie: movie,
            downloadResult: result,
          },
        )

        return {
          images: [],
          messages: messages.concat(successResponse),
        }
      } else {
        const errorResponse = await this.generateChatResponse(
          messages,
          'error',
          {
            selectedMovie: movie,
            errorMessage: `Failed to add "${movie.title}" to downloads: ${result.error}`,
          },
        )

        return {
          images: [],
          messages: messages.concat(errorResponse),
        }
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, movieTitle: movie.title },
        'Failed to download movie',
      )

      const errorResponse = await this.generateChatResponse(messages, 'error', {
        selectedMovie: movie,
        errorMessage: `Couldn't add "${movie.title}" to downloads. The Radarr service might be unavailable.`,
      })

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  private async downloadTvShow(
    show: SeriesSearchResult,
    tvSelection: TvShowSelection,
    _originalMessage: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ) {
    this.logger.log(
      {
        userId,
        showTitle: show.title,
        tvdbId: show.tvdbId,
        selection: tvSelection,
      },
      'Attempting to download TV show',
    )

    try {
      const result = await this.sonarrService.monitorAndDownloadSeries(
        show.tvdbId,
        tvSelection,
      )

      if (result.success) {
        const successResponse = await this.generateTvShowChatResponse(
          messages,
          'TV_SHOW_SUCCESS',
          {
            selectedShow: show,
            downloadResult: result,
            granularSelection: tvSelection,
          },
        )

        return {
          images: [],
          messages: messages.concat(successResponse),
        }
      } else {
        const errorResponse = await this.generateTvShowChatResponse(
          messages,
          'TV_SHOW_ERROR',
          {
            selectedShow: show,
            errorMessage: `Failed to add "${show.title}" to downloads: ${result.error}`,
          },
        )

        return {
          images: [],
          messages: messages.concat(errorResponse),
        }
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, showTitle: show.title },
        'Failed to download TV show',
      )

      const errorResponse = await this.generateTvShowChatResponse(
        messages,
        'TV_SHOW_ERROR',
        {
          selectedShow: show,
          errorMessage: `Couldn't add "${show.title}" to downloads. The Sonarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  // Movie delete methods
  private async handleNewMovieDelete(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ) {
    this.logger.log(
      { userId, content: message.content },
      'Starting new movie delete',
    )

    // Parse both search query and selection criteria upfront
    const messageContent =
      typeof message.content === 'string'
        ? message.content
        : message.content.toString()
    const { searchQuery, selection } =
      await this.parseInitialSelection(messageContent)

    if (!searchQuery.trim()) {
      const clarificationResponse = await this.generateMovieDeleteChatResponse(
        messages,
        'clarification_delete',
      )
      return {
        images: [],
        messages: messages.concat(clarificationResponse),
      }
    }

    try {
      // Search library for movies using RadarrService
      const libraryResults =
        await this.radarrService.getLibraryMovies(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: libraryResults.length,
          hasSelection: !!selection,
        },
        'Movie library search for delete completed',
      )

      if (libraryResults.length === 0) {
        const noResultsResponse = await this.generateMovieDeleteChatResponse(
          messages,
          'no_results_delete',
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
        libraryResults.length > 0
      ) {
        const selectedMovie = this.findSelectedMovieFromLibrary(
          selection,
          libraryResults,
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
            'Auto-applying movie selection for delete (explicit search selection provided)',
          )

          // Clear any existing context and delete the movie directly
          this.state.clearUserMovieDeleteContext(userId)
          return await this.deleteMovie(
            selectedMovie,
            message,
            messages,
            userId,
          )
        } else {
          this.logger.warn(
            { userId, selection, searchResultsCount: libraryResults.length },
            'Could not find selected movie from library specification, falling back to list',
          )
        }
      }

      if (libraryResults.length === 1) {
        // Only one result - delete it directly
        this.logger.log(
          { userId, tmdbId: libraryResults[0].tmdbId },
          'Single result found in library, deleting directly',
        )
        return await this.deleteMovie(
          libraryResults[0],
          message,
          messages,
          userId,
        )
      }

      // Multiple results - store context and ask user to choose
      const movieDeleteContext = {
        searchResults: libraryResults.slice(0, MAX_SEARCH_RESULTS),
        query: searchQuery,
        timestamp: Date.now(),
        isActive: true,
      }

      this.state.setUserMovieDeleteContext(userId, movieDeleteContext)

      // Create selection prompt
      const selectionResponse = await this.generateMovieDeleteChatResponse(
        messages,
        'multiple_results_delete',
        {
          searchQuery,
          movies: libraryResults.slice(0, MAX_SEARCH_RESULTS),
        },
      )

      return {
        images: [],
        messages: messages.concat(selectionResponse),
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, searchQuery },
        'Failed to search library for movie delete',
      )

      const errorResponse = await this.generateMovieDeleteChatResponse(
        messages,
        'error_delete',
        {
          searchQuery,
          errorMessage: `Couldn't search library for "${searchQuery}" right now. The Radarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  private async handleMovieDeleteSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    movieDeleteContext: MovieDeleteContext,
    userId: string,
  ) {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing movie delete selection',
    )

    try {
      // Parse the user's selection using LLM
      const messageContent =
        typeof message.content === 'string'
          ? message.content
          : message.content.toString()
      const selection = await this.parseSearchSelection(messageContent).catch(
        () => null,
      )
      this.logger.log({ userId, selection }, 'Parsed movie delete selection')

      // If no selection was parsed, ask user to clarify
      if (!selection) {
        const clarificationResponse =
          await this.generateMovieDeleteChatResponse(
            messages,
            'multiple_results_delete',
            {
              searchQuery: movieDeleteContext.query,
              movies: movieDeleteContext.searchResults,
            },
          )
        return {
          images: [],
          messages: messages.concat(clarificationResponse),
        }
      }

      // Find the selected movie from context
      const selectedMovie = this.findSelectedMovieFromLibrary(
        selection,
        movieDeleteContext.searchResults,
      )

      if (!selectedMovie) {
        const clarificationResponse =
          await this.generateMovieDeleteChatResponse(
            messages,
            'multiple_results_delete',
            {
              searchQuery: movieDeleteContext.query,
              movies: movieDeleteContext.searchResults,
            },
          )
        return {
          images: [],
          messages: messages.concat(clarificationResponse),
        }
      }

      // Clear context and delete the movie
      this.state.clearUserMovieDeleteContext(userId)
      return await this.deleteMovie(selectedMovie, message, messages, userId)
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process movie delete selection',
      )

      // Clear context on error
      this.state.clearUserMovieDeleteContext(userId)

      const errorResponse = await this.generateMovieDeleteChatResponse(
        messages,
        'processing_error_delete',
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
   * Handle new TV show delete request - search library and manage selection flow
   */
  private async handleNewTvShowDelete(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ) {
    this.logger.log(
      { userId, content: message.content },
      'Starting new TV show delete',
    )

    // Parse both search query and selections upfront
    const messageContent =
      typeof message.content === 'string'
        ? message.content
        : message.content.toString()

    try {
      const searchQuery = await this.extractTvDeleteQueryWithLLM(messageContent)

      if (!searchQuery.trim()) {
        const clarificationResponse =
          await this.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_NO_RESULTS',
            {
              searchQuery: '',
            },
          )
        return {
          images: [],
          messages: messages.concat(clarificationResponse),
        }
      }

      // Parse initial selections (both search and series selection)
      let searchSelection: SearchSelection | null = null
      let tvSelection: TvShowSelection | null = null

      try {
        // Try to parse search selection (which show to select)
        searchSelection = await this.parseSearchSelection(messageContent).catch(
          () => null,
        )
        // Try to parse TV show selection (which parts to delete)
        tvSelection = await this.parseTvShowSelection(messageContent).catch(
          () => null,
        )
      } catch (error) {
        this.logger.log(
          { error: getErrorMessage(error) },
          'Failed to parse initial selections, will ask user for clarification',
        )
      }

      // Search library for TV shows using SonarrService
      const libraryResults =
        await this.sonarrService.getLibrarySeries(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: libraryResults.length,
          hasSearchSelection: !!searchSelection,
          hasTvSelection: !!tvSelection,
        },
        'TV show library search for delete completed',
      )

      if (libraryResults.length === 0) {
        const noResultsResponse = await this.generateTvShowDeleteChatResponse(
          messages,
          'TV_SHOW_DELETE_NO_RESULTS',
          { searchQuery },
        )
        return {
          images: [],
          messages: messages.concat(noResultsResponse),
        }
      }

      // Limit library results to maximum
      const transformedResults = libraryResults.slice(0, MAX_SEARCH_RESULTS)

      // Apply selection validation logic based on our plan
      if (libraryResults.length === 1) {
        // Single result - only need series selection
        this.logger.log(
          {
            userId,
            tvSelection,
            tvSelectionExists: !!tvSelection,
            tvSelectionHasSelection: !!tvSelection?.selection,
            tvSelectionLength: tvSelection?.selection?.length || 0,
            searchSelection,
            searchSelectionExists: !!searchSelection,
          },
          'DEBUG: Evaluating delete criteria for single result',
        )

        if (tvSelection?.selection && tvSelection.selection.length > 0) {
          // Has both result (implied single) and series selection
          this.logger.log(
            { userId, showTitle: libraryResults[0].title, tvSelection },
            'Single result with series selection, proceeding with delete',
          )
          return await this.deleteTvShow(
            transformedResults[0],
            tvSelection,
            message,
            messages,
            userId,
          )
        } else if (tvSelection && Object.keys(tvSelection).length === 0) {
          // Empty tvSelection object means "entire series" - proceed automatically
          this.logger.log(
            { userId, showTitle: libraryResults[0].title },
            'Single result with entire series selection, proceeding with delete',
          )
          return await this.deleteTvShow(
            transformedResults[0],
            tvSelection,
            message,
            messages,
            userId,
          )
        } else {
          // Missing series selection - create context for single result case
          const tvShowDeleteContext: TvShowDeleteContext = {
            searchResults: transformedResults,
            query: searchQuery,
            timestamp: Date.now(),
            isActive: true,
            originalSearchSelection: searchSelection || undefined,
            originalTvSelection: tvSelection || undefined,
          }

          this.state.setUserTvShowDeleteContext(userId, tvShowDeleteContext)

          const needSeriesResponse =
            await this.generateTvShowDeleteChatResponse(
              messages,
              'TV_SHOW_DELETE_NEED_SERIES_SELECTION',
              {
                selectedShow: transformedResults[0],
              },
            )
          return {
            images: [],
            messages: messages.concat(needSeriesResponse),
          }
        }
      } else {
        // Multiple results - need both result and series selection
        this.logger.log(
          {
            userId,
            searchSelectionExists: !!searchSelection,
            tvSelectionExists: !!tvSelection,
            tvSelectionHasSelection: !!(
              tvSelection?.selection && tvSelection.selection.length > 0
            ),
            tvSelectionIsEntireSeries: !!(
              tvSelection && Object.keys(tvSelection).length === 0
            ),
            resultsCount: transformedResults.length,
          },
          'DEBUG: Evaluating delete criteria for multiple results',
        )

        if (
          searchSelection &&
          ((tvSelection?.selection && tvSelection.selection.length > 0) ||
            (tvSelection && Object.keys(tvSelection).length === 0))
        ) {
          // Has both selections (either specific episodes/seasons or entire series)
          const selectedShow = this.findSelectedTvShowFromLibrary(
            searchSelection,
            transformedResults,
          )
          if (selectedShow) {
            this.logger.log(
              { userId, showTitle: selectedShow.title, tvSelection },
              'Multiple results with both selections, proceeding with delete',
            )
            return await this.deleteTvShow(
              selectedShow,
              tvSelection,
              message,
              messages,
              userId,
            )
          }
        }

        // Store context for multi-turn conversation
        const tvShowDeleteContext: TvShowDeleteContext = {
          searchResults: transformedResults,
          query: searchQuery,
          timestamp: Date.now(),
          isActive: true,
          originalSearchSelection: searchSelection || undefined,
          originalTvSelection: tvSelection || undefined,
        }

        this.state.setUserTvShowDeleteContext(userId, tvShowDeleteContext)

        // Determine what we need to ask for
        if (!searchSelection && !tvSelection) {
          // Need both selections
          const response = await this.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_MULTIPLE_RESULTS_NEED_BOTH',
            {
              searchResults: transformedResults,
              searchQuery,
            },
          )
          return {
            images: [],
            messages: messages.concat(response),
          }
        } else if (!searchSelection) {
          // Need result selection
          const response = await this.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_NEED_RESULT_SELECTION',
            {
              searchResults: transformedResults,
              searchQuery,
            },
          )
          return {
            images: [],
            messages: messages.concat(response),
          }
        } else {
          // Need series selection
          const response = await this.generateTvShowDeleteChatResponse(
            messages,
            'TV_SHOW_DELETE_NEED_SERIES_SELECTION',
            {
              searchResults: transformedResults,
              searchQuery,
            },
          )
          return {
            images: [],
            messages: messages.concat(response),
          }
        }
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to search library for TV show delete',
      )

      const errorResponse = await this.generateTvShowDeleteChatResponse(
        messages,
        'TV_SHOW_DELETE_ERROR',
        {
          errorMessage: `Couldn't search library right now. The Sonarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  /**
   * Handle TV show delete selection when context exists
   */
  private async handleTvShowDeleteSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    tvShowDeleteContext: TvShowDeleteContext,
    userId: string,
  ) {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing TV show delete selection',
    )

    try {
      // Parse the user's new selections
      const messageContent =
        typeof message.content === 'string'
          ? message.content
          : message.content.toString()

      let searchSelection: SearchSelection | null = null
      let tvSelection: TvShowSelection | null = null

      try {
        searchSelection = await this.parseSearchSelection(messageContent).catch(
          () => null,
        )
        tvSelection = await this.parseTvShowSelection(messageContent).catch(
          () => null,
        )
      } catch (error) {
        this.logger.log(
          { error: getErrorMessage(error) },
          'Failed to parse selections from user message',
        )
      }

      // Combine with existing context selections
      const finalSearchSelection =
        searchSelection || tvShowDeleteContext.originalSearchSelection
      const finalTvSelection =
        tvSelection || tvShowDeleteContext.originalTvSelection

      // Validate we have both required selections
      if (
        tvShowDeleteContext.searchResults.length > 1 &&
        !finalSearchSelection
      ) {
        // Still need result selection
        const response = await this.generateTvShowDeleteChatResponse(
          messages,
          'TV_SHOW_DELETE_NEED_RESULT_SELECTION',
          {
            searchResults: tvShowDeleteContext.searchResults,
            searchQuery: tvShowDeleteContext.query,
          },
        )
        return {
          images: [],
          messages: messages.concat(response),
        }
      }

      if (
        !finalTvSelection?.selection ||
        finalTvSelection.selection.length === 0
      ) {
        // Still need series selection
        const selectedShow =
          tvShowDeleteContext.searchResults.length === 1
            ? tvShowDeleteContext.searchResults[0]
            : finalSearchSelection
              ? this.findSelectedTvShowFromLibrary(
                  finalSearchSelection,
                  tvShowDeleteContext.searchResults,
                )
              : null

        const response = await this.generateTvShowDeleteChatResponse(
          messages,
          'TV_SHOW_DELETE_NEED_SERIES_SELECTION',
          {
            selectedShow: selectedShow || undefined,
            searchResults: tvShowDeleteContext.searchResults,
            searchQuery: tvShowDeleteContext.query,
          },
        )
        return {
          images: [],
          messages: messages.concat(response),
        }
      }

      // Find the selected show
      const selectedShow =
        tvShowDeleteContext.searchResults.length === 1
          ? tvShowDeleteContext.searchResults[0]
          : finalSearchSelection
            ? this.findSelectedTvShowFromLibrary(
                finalSearchSelection,
                tvShowDeleteContext.searchResults,
              )
            : null

      if (!selectedShow) {
        const response = await this.generateTvShowDeleteChatResponse(
          messages,
          'TV_SHOW_DELETE_NEED_RESULT_SELECTION',
          {
            searchResults: tvShowDeleteContext.searchResults,
            searchQuery: tvShowDeleteContext.query,
          },
        )
        return {
          images: [],
          messages: messages.concat(response),
        }
      }

      // Clear context and proceed with deletion
      this.state.clearUserTvShowDeleteContext(userId)
      return await this.deleteTvShow(
        selectedShow,
        finalTvSelection,
        message,
        messages,
        userId,
      )
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process TV show delete selection',
      )

      // Clear context on error
      this.state.clearUserTvShowDeleteContext(userId)

      const errorResponse = await this.generateTvShowDeleteChatResponse(
        messages,
        'TV_SHOW_DELETE_ERROR',
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
   * Find selected TV show from library search results
   */
  private findSelectedTvShowFromLibrary(
    selection: SearchSelection,
    shows: Array<{ id: number; title: string; year?: number }>,
  ): { id: number; tvdbId: number; title: string; year?: number } | null {
    const { selectionType, value } = selection

    this.logger.log(
      { selectionType, value, showCount: shows.length },
      'Finding selected TV show from library results',
    )

    switch (selectionType) {
      case 'ordinal': {
        const index = parseInt(value) - 1
        if (index >= 0 && index < shows.length) {
          return shows[index] as {
            id: number
            tvdbId: number
            title: string
            year?: number
          }
        }
        return (
          (shows[0] as {
            id: number
            tvdbId: number
            title: string
            year?: number
          }) || null
        )
      }

      case 'year': {
        const yearMatch = shows.find(show => show.year?.toString() === value)
        if (yearMatch) {
          return yearMatch as {
            id: number
            tvdbId: number
            title: string
            year?: number
          }
        }
        return (
          (shows[0] as {
            id: number
            tvdbId: number
            title: string
            year?: number
          }) || null
        )
      }

      default: {
        return (
          (shows[0] as {
            id: number
            tvdbId: number
            title: string
            year?: number
          }) || null
        )
      }
    }
  }

  private async deleteMovie(
    movie: MovieLibrarySearchResult,
    _originalMessage: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ) {
    this.logger.log(
      { userId, movieTitle: movie.title, tmdbId: movie.tmdbId },
      'Attempting to delete movie',
    )

    try {
      const result = await this.radarrService.unmonitorAndDeleteMovie(
        movie.tmdbId,
        { deleteFiles: true }, // Default to deleting files
      )

      if (result.success) {
        const successResponse = await this.generateMovieDeleteChatResponse(
          messages,
          'success_delete',
          {
            selectedMovie: movie,
            deleteResult: result,
          },
        )

        return {
          images: [],
          messages: messages.concat(successResponse),
        }
      } else {
        const errorResponse = await this.generateMovieDeleteChatResponse(
          messages,
          'error_delete',
          {
            selectedMovie: movie,
            errorMessage: `Failed to delete "${movie.title}": ${result.error}`,
          },
        )

        return {
          images: [],
          messages: messages.concat(errorResponse),
        }
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, movieTitle: movie.title },
        'Failed to delete movie',
      )

      const errorResponse = await this.generateMovieDeleteChatResponse(
        messages,
        'error_delete',
        {
          selectedMovie: movie,
          errorMessage: `Couldn't delete "${movie.title}". The Radarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  private findSelectedMovieFromLibrary(
    selection: SearchSelection,
    movies: MovieLibrarySearchResult[],
  ): MovieLibrarySearchResult | null {
    // MovieLibrarySearchResult | null
    const { selectionType, value } = selection

    this.logger.log(
      { selectionType, value, movieCount: movies.length },
      'Finding selected movie from library results',
    )

    switch (selectionType) {
      case 'ordinal': {
        const index = parseInt(value) - 1
        if (index >= 0 && index < movies.length) {
          this.logger.log(
            { selectedIndex: index },
            'Selected movie by ordinal from library',
          )
          return movies[index]
        }
        this.logger.warn(
          { index, movieCount: movies.length },
          'Ordinal index out of range, defaulting to first',
        )
        return movies[0] || null
      }

      case 'year': {
        const yearMatch = movies.find(movie => movie.year?.toString() === value)
        if (yearMatch) {
          this.logger.log(
            { selectedYear: value },
            'Selected movie by year from library',
          )
          return yearMatch
        }
        this.logger.warn(
          { year: value },
          'No movie found for year in library, defaulting to first',
        )
        return movies[0] || null
      }

      default: {
        this.logger.log('Using default selection (first movie from library)')
        return movies[0] || null // Default to first
      }
    }
  }

  private async parseInitialSelection(messageContent: string): Promise<{
    searchQuery: string
    selection: SearchSelection | null
    tvSelection: TvShowSelection | null
  }> {
    this.logger.log(
      { messageContent },
      'Parsing initial selection with search query and selection criteria',
    )

    try {
      // Parse search query, search selection, and TV selection in parallel for efficiency
      const [searchQuery, searchSelection, tvSelection] = await Promise.all([
        this.extractSearchQueryWithLLM(messageContent),
        this.parseSearchSelection(messageContent).catch(() => null),
        this.parseTvShowSelection(messageContent).catch(() => null),
      ])

      this.logger.log(
        {
          searchQuery,
          searchSelection,
          tvSelection,
        },
        'Parsed initial selection components',
      )

      return {
        searchQuery,
        selection: searchSelection,
        tvSelection,
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), messageContent },
        'Failed to parse initial selection, using fallback',
      )

      // Fallback to just search query extraction
      const searchQuery = await this.extractSearchQueryWithLLM(messageContent)
      return {
        searchQuery,
        selection: null,
        tvSelection: null,
      }
    }
  }

  private async extractSearchQueryWithLLM(content: string): Promise<string> {
    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            EXTRACT_SEARCH_QUERY_PROMPT,
            new HumanMessage({ id: nanoid(), content }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-extractSearchQuery',
      )

      const extractedQuery = response.content.toString().trim()
      this.logger.log(
        { originalContent: content, extractedQuery },
        'Extracted search query using LLM',
      )

      return extractedQuery || content // Fallback to original if empty
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), content },
        'Failed to extract search query with LLM, using fallback',
      )

      // Simple fallback extraction
      return content
        .toLowerCase()
        .replace(/\b(download|add|get|find|search for|look for)\b/gi, '')
        .replace(/\b(movie|film|the)\b/gi, '')
        .trim()
    }
  }

  private async generateChatResponse(
    messages: BaseMessage[],
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
          this.getChatModel().invoke([
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
        `OpenAI-generateChatResponse-${situation}`,
      )

      return new HumanMessage({
        id: nanoid(),
        content: response.content.toString(),
      })
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), situation },
        'Failed to generate chat response, using fallback',
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

  private async generateMovieDeleteChatResponse(
    messages: BaseMessage[],
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
          this.getChatModel().invoke([
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
        `OpenAI-generateMovieDeleteChatResponse-${situation}`,
      )

      return new HumanMessage({
        id: nanoid(),
        content: response.content.toString(),
      })
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), situation },
        'Failed to generate movie delete chat response, using fallback',
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

  /**
   * Format media items as minified JSON for LLM consumption
   */
  private formatMediaAsJson(
    items: Array<{
      title: string
      year?: number
      hasFile?: boolean
      tmdbId?: number
      tvdbId?: number
      genres?: string[]
      rating?: number
      overview?: string
      status?: string
      monitored?: boolean
      id?: number
    }>,
  ): string {
    return JSON.stringify(
      items.map(item => ({
        title: item.title,
        year: item.year,
        hasFile: item.hasFile,
        tmdbId: item.tmdbId || item.tvdbId,
        genres: item.genres || [],
        rating: item.rating,
        overview: item.overview,
        status: item.status,
        monitored: item.monitored,
        id: item.id,
      })),
    )
  }

  private async fetchLibraryData(
    mediaType: MediaRequestType,
    searchQuery?: string,
  ): Promise<{
    content: string
    count: number
  }> {
    let content = ''
    let count = 0

    if (
      mediaType === MediaRequestType.Movies ||
      mediaType === MediaRequestType.Both
    ) {
      try {
        this.logger.log({ searchQuery }, 'Fetching movie library data')
        const movies = await this.radarrService.getLibraryMovies()
        count += movies.length

        if (movies.length > 0) {
          content += '\n\n**MOVIES IN LIBRARY:**\n'
          content += this.formatMediaAsJson(movies)
          content += `\n\nTotal movies: ${movies.length}`
        } else {
          content += '\n\n**MOVIES:** No movies found in library'
        }
      } catch (error) {
        this.logger.error(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Failed to fetch movie library',
        )
        content +=
          '\n\n**MOVIES:** Unable to fetch movie library (service may be unavailable)'
      }
    }

    if (
      mediaType === MediaRequestType.Shows ||
      mediaType === MediaRequestType.Both
    ) {
      try {
        this.logger.log({ searchQuery }, 'Fetching TV series library data')
        const series = await this.sonarrService.getLibrarySeries()
        count += series.length

        if (series.length > 0) {
          content += '\n\n**TV SHOWS IN LIBRARY:**\n'
          content += this.formatMediaAsJson(series)
          content += `\n\nTotal shows: ${series.length}`
        } else {
          content += '\n\n**TV SHOWS:** No TV shows found in library'
        }
      } catch (error) {
        this.logger.error(
          { error: error instanceof Error ? error.message : 'Unknown error' },
          'Failed to fetch TV series library',
        )
        content +=
          '\n\n**TV SHOWS:** Unable to fetch TV series library (service may be unavailable)'
      }
    }

    return { content, count }
  }

  private async fetchExternalSearchData(
    mediaType: MediaRequestType,
    searchQuery: string,
  ): Promise<{
    content: string
    count: number
  }> {
    let content = ''
    let count = 0

    if (
      mediaType === MediaRequestType.Movies ||
      mediaType === MediaRequestType.Both
    ) {
      try {
        this.logger.log({ searchQuery }, 'Searching for movies externally')
        const movies = await this.radarrService.searchMovies(searchQuery)
        count += movies.length

        if (movies.length > 0) {
          content += '\n\n**🔍 MOVIE SEARCH RESULTS:**\n'
          content += this.formatMediaAsJson(movies)
          content += `\n\nFound ${movies.length} movies matching "${searchQuery}"`
        } else {
          content += `\n\n**🔍 MOVIE SEARCH:** No movies found for "${searchQuery}"`
        }
      } catch (error) {
        this.logger.error(
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            searchQuery,
          },
          'Failed to search movies externally',
        )
        content += `\n\n**🔍 MOVIES:** Unable to search for "${searchQuery}" (service may be unavailable)`
      }
    }

    if (
      mediaType === MediaRequestType.Shows ||
      mediaType === MediaRequestType.Both
    ) {
      try {
        this.logger.log({ searchQuery }, 'Searching for TV shows externally')
        const shows = await this.sonarrService.searchShows(searchQuery)
        count += shows.length

        if (shows.length > 0) {
          content += '\n\n**🔍 TV SHOW SEARCH RESULTS:**\n'
          content += this.formatMediaAsJson(shows)
          content += `\n\nFound ${shows.length} shows matching "${searchQuery}"`
        } else {
          content += `\n\n**🔍 TV SHOWS:** No shows found for "${searchQuery}"`
        }
      } catch (error) {
        this.logger.error(
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            searchQuery,
          },
          'Failed to search TV shows externally',
        )
        content += `\n\n**🔍 TV SHOWS:** Unable to search for "${searchQuery}" (service may be unavailable)`
      }
    }

    return { content, count }
  }

  private async getMediaTypeAndIntent(
    message: HumanMessage,
  ): Promise<MediaRequest> {
    try {
      this.logger.log('Determining media type and search intent')
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
      return MediaRequestSchema.parse(parsedResponse)
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

  private isDeleteRequest(mediaRequest: MediaRequest): boolean {
    // Delete requests are identified by the SearchIntent.Delete
    return mediaRequest.searchIntent === SearchIntent.Delete
  }

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

  private async handleDownloadStatusRequest(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ) {
    this.logger.log({ userId }, 'Processing download status request')

    try {
      // Fetch current downloads from both services
      const [movieDownloads, episodeDownloads] = await Promise.all([
        this.radarrService.getDownloadingMovies(),
        this.sonarrService.getDownloadingEpisodes(),
      ])

      // Early return for no downloads - prevents LLM hallucination
      if (movieDownloads.length === 0 && episodeDownloads.length === 0) {
        this.logger.log(
          { userId, movieCount: 0, episodeCount: 0 },
          'No downloads active, returning predefined response',
        )

        const noDownloadsResponse = await this.generateChatResponse(
          messages,
          'no_downloads',
          {
            movieCount: 0,
            episodeCount: 0,
          },
        )

        return {
          messages: messages.concat(message, noDownloadsResponse),
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
          size: this.formatFileSize(m.size),
          timeLeft: m.estimatedCompletionTime
            ? this.formatTimeRemaining(m.estimatedCompletionTime)
            : null,
        })),
        episodes: episodeDownloads.map(e => ({
          series: e.seriesTitle,
          episode: `S${e.seasonNumber}E${e.episodeNumber}: ${e.episodeTitle}`,
          progress: e.progressPercent,
          status: e.status,
          size: this.formatFileSize(e.size),
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
      this.validateDownloadResponse(response, movieTitles, seriesTitles, userId)

      return {
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
        messages: [...messages, message, errorResponse],
      }
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  private formatTimeRemaining(completionTime: string): string | null {
    try {
      const completion = new Date(completionTime)
      const now = new Date()
      const diffMs = completion.getTime() - now.getTime()

      if (diffMs <= 0) return 'Soon'

      const hours = Math.floor(diffMs / (1000 * 60 * 60))
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))

      if (hours > 0) {
        return `${hours}h ${minutes}m`
      } else {
        return `${minutes}m`
      }
    } catch {
      return null
    }
  }

  private validateDownloadResponse(
    response: BaseMessage,
    movieTitles: string[],
    seriesTitles: string[],
    userId: string,
  ): void {
    if (!isAIMessage(response)) return

    const responseContent = response.content.toString().toLowerCase()
    const allValidTitles = [
      ...movieTitles.map(title => title.toLowerCase()),
      ...seriesTitles.map(title => title.toLowerCase()),
    ]

    // Extract potential movie/show titles from response
    // Look for patterns like quotes, specific progress percentages, etc.
    const titlePatterns = [
      /"([^"]+)"/g, // Quoted titles
      /(\w+\s+\w+(?:\s+\w+)*)\s+(?:at\s+)?[\d.]+%/g, // Titles followed by progress
    ]

    const suspiciousTitles: string[] = []

    for (const pattern of titlePatterns) {
      let match
      while ((match = pattern.exec(responseContent)) !== null) {
        const potentialTitle = match[1]?.toLowerCase().trim()
        if (
          potentialTitle &&
          potentialTitle.length > 3 && // Ignore very short matches
          !allValidTitles.some(
            validTitle =>
              validTitle.includes(potentialTitle) ||
              potentialTitle.includes(validTitle),
          )
        ) {
          suspiciousTitles.push(potentialTitle)
        }
      }
    }

    if (suspiciousTitles.length > 0) {
      this.logger.warn(
        {
          userId,
          suspiciousTitles,
          validTitles: allValidTitles,
          responseContent: response.content.toString().substring(0, 200),
        },
        'Potential hallucination detected in download status response',
      )
    }
  }

  private async parseSearchSelection(
    selectionText: string,
  ): Promise<SearchSelection> {
    this.logger.log(
      { selectionText },
      'DEBUG: Starting parseSearchSelection with input',
    )

    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            MOVIE_SELECTION_PARSING_PROMPT,
            new HumanMessage({ id: nanoid(), content: selectionText }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-parseSearchSelection',
      )

      const rawResponse = response.content.toString()
      this.logger.log(
        { rawResponse, selectionText },
        'DEBUG: Raw LLM response for search selection parsing',
      )

      const parsed = JSON.parse(rawResponse)
      this.logger.log(
        { parsed, selectionText },
        'DEBUG: Parsed JSON for search selection (before schema validation)',
      )

      // Handle error responses from LLM
      if (parsed.error) {
        this.logger.log(
          { error: parsed.error, selectionText },
          'DEBUG: LLM returned error response for search selection',
        )
        throw new Error(`LLM parsing error: ${parsed.error}`)
      }

      const validated = SearchSelectionSchema.parse(parsed)
      this.logger.log(
        { validated, selectionText },
        'DEBUG: Successfully validated search selection',
      )

      return validated
    } catch (error) {
      this.logger.error(
        {
          error: getErrorMessage(error),
          selectionText,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
        },
        'Failed to parse search selection - no fallback, letting conversation flow handle it',
      )
      throw error
    }
  }

  private findSelectedMovie(
    selection: SearchSelection,
    movies: MovieSearchResult[],
  ): MovieSearchResult | null {
    const { selectionType, value } = selection

    this.logger.log(
      { selectionType, value, movieCount: movies.length },
      'Finding selected movie from parsed selection',
    )

    switch (selectionType) {
      case 'ordinal': {
        const index = parseInt(value) - 1
        if (index >= 0 && index < movies.length) {
          this.logger.log({ selectedIndex: index }, 'Selected movie by ordinal')
          return movies[index]
        }
        this.logger.warn(
          { index, movieCount: movies.length },
          'Ordinal index out of range, defaulting to first',
        )
        return movies[0] || null
      }

      case 'year': {
        const yearMatch = movies.find(movie => movie.year?.toString() === value)
        if (yearMatch) {
          this.logger.log({ selectedYear: value }, 'Selected movie by year')
          return yearMatch
        }
        this.logger.warn(
          { year: value },
          'No movie found for year, defaulting to first',
        )
        return movies[0] || null
      }

      default: {
        this.logger.log('Using default selection (first movie)')
        return movies[0] || null // Default to first
      }
    }
  }

  private trimMessages({ messages }: typeof OverallStateAnnotation.State) {
    const lastMessage = messages.at(-1)
    const state = this.state.getState()

    if (
      lastMessage &&
      isAIMessage(lastMessage) &&
      lastMessage.response_metadata.tokenUsage.totalTokens >= state.maxTokens
    ) {
      this.logger.log('Trimming messages')

      return {
        messages: [],
      }
    }

    return {}
  }

  async sendMessage({
    message,
    user,
    userId,
  }: {
    message: string
    user: string
    userId?: string
  }): Promise<MessageResponse> {
    const userInput = `${user} said "${message}"`
    const finalUserId = userId || user // Use user as fallback if no userId provided

    this.logger.log(
      {
        user,
        message,
        userInput,
        userId: finalUserId,
      },
      'Invoking LLM ',
    )

    try {
      const state = this.state.getState()
      const { images, messages } = await this.app.invoke({
        userInput,
        userId: finalUserId,
        messages: state.graphHistory.at(-1)?.messages ?? [],
      })

      this.state.setState(prev => ({
        graphHistory: prev.graphHistory.concat({
          images,
          messages,
        }),
      }))

      const lastMessage = messages.at(-1)

      if (!lastMessage) {
        throw new Error('Did not receive a message')
      }

      if (isAIMessage(lastMessage)) {
        this.logger.log(
          lastMessage.response_metadata.tokenUsage,
          'Token count for last message',
        )
      }

      return {
        images,
        content: lastMessage.content as string,
      }
    } catch (err) {
      this.logger.error({
        error: getErrorMessage(err),

        ...(err instanceof UnhandledMessageResponseError
          ? { response: err.response }
          : {}),

        ...(err instanceof Error ? { stack: err.stack } : {}),
      })

      return {
        images: [],
        content: dedent`
          sorry an error happened:

          \`\`\`
          ${getErrorMessage(err)}
          \`\`\`
        `,
      }
    }
  }

  // TV Show download methods
  private async classifyMediaType(
    message: HumanMessage,
  ): Promise<MediaTypeClassification> {
    const messageContent =
      typeof message.content === 'string'
        ? message.content
        : message.content.toString()

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
      const result = await classificationModel.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: messageContent },
      ])

      this.logger.log(
        {
          message: messageContent,
          classification: result,
        },
        'Classified media type',
      )

      return result
    } catch (error) {
      this.logger.error(
        {
          error: getErrorMessage(error),
          message: messageContent,
        },
        'Failed to classify media type, defaulting to movie',
      )

      // Fallback to movie
      return {
        mediaType: 'movie',
        reasoning: 'Classification failed, defaulting to movie',
      }
    }
  }

  private async handleNewTvShowSearch(
    message: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ) {
    this.logger.log(
      { userId, content: message.content },
      'Starting new TV show search',
    )

    // Parse both search query and selection criteria upfront
    const messageContent =
      typeof message.content === 'string'
        ? message.content
        : message.content.toString()
    const { searchQuery, selection, tvSelection } =
      await this.parseInitialSelection(messageContent)

    if (!searchQuery.trim()) {
      const clarificationResponse = await this.generateTvShowChatResponse(
        messages,
        'TV_SHOW_CLARIFICATION',
      )
      return {
        images: [],
        messages: messages.concat(clarificationResponse),
      }
    }

    try {
      // Search for TV shows using SonarrService
      const searchResults = await this.sonarrService.searchShows(searchQuery)
      this.logger.log(
        {
          userId,
          searchQuery,
          resultCount: searchResults.length,
          hasShowSelection: !!selection,
          hasGranularSelection: !!tvSelection?.selection,
        },
        'TV show search completed',
      )

      if (searchResults.length === 0) {
        const noResultsResponse = await this.generateTvShowChatResponse(
          messages,
          'TV_SHOW_NO_RESULTS',
          { searchQuery },
        )
        return {
          images: [],
          messages: messages.concat(noResultsResponse),
        }
      }

      // Smart auto-selection: Only apply when user provides BOTH search selection (ordinal/year only) AND granular TV selection
      if (
        selection &&
        (selection.selectionType === 'ordinal' ||
          selection.selectionType === 'year') &&
        tvSelection &&
        Object.prototype.hasOwnProperty.call(tvSelection, 'selection') &&
        searchResults.length > 0
      ) {
        const selectedShow = this.findSelectedShow(selection, searchResults)
        if (selectedShow) {
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              selectionType: selection.selectionType,
              selectionValue: selection.value,
              tvSelection,
            },
            'Auto-applying complete TV show specification (search selection + granular selection)',
          )

          // Generate acknowledgment and download directly
          const response = await this.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SUCCESS',
            {
              selectedShow,
              downloadResult: {
                seriesAdded: true,
                seriesUpdated: false,
                searchTriggered: true,
              },
              autoApplied: true,
              selectionCriteria: `${selection.selectionType}: ${selection.value}`,
              granularSelection: tvSelection,
            },
          )

          // Start download process
          const downloadResult =
            await this.sonarrService.monitorAndDownloadSeries(
              selectedShow.tvdbId,
              tvSelection,
            )

          if (!downloadResult.success) {
            // Override response with error if download failed
            const errorResponse = await this.generateTvShowChatResponse(
              messages,
              'TV_SHOW_ERROR',
              {
                selectedShow,
                errorMessage: `Failed to add "${selectedShow.title}" to downloads: ${downloadResult.error}`,
              },
            )
            return {
              images: [],
              messages: messages.concat(errorResponse),
            }
          }

          return {
            images: [],
            messages: messages.concat(response),
          }
        } else {
          this.logger.warn(
            { userId, selection, searchResultsCount: searchResults.length },
            'Could not find selected show from complete specification, falling back to list',
          )
        }
      }

      // Show-only auto-selection: Apply when user provides ordinal/year selection but no granular selection
      if (
        selection &&
        (selection.selectionType === 'ordinal' ||
          selection.selectionType === 'year') &&
        (!tvSelection ||
          !Object.prototype.hasOwnProperty.call(tvSelection, 'selection')) &&
        searchResults.length > 0
      ) {
        const selectedShow = this.findSelectedShow(selection, searchResults)
        if (selectedShow) {
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              selectionType: selection.selectionType,
              selectionValue: selection.value,
            },
            'Auto-selecting TV show for granular selection phase',
          )

          // Store single selected show in context for granular selection
          const tvShowContext = {
            searchResults: [selectedShow], // Only store the selected show
            query: searchQuery,
            timestamp: Date.now(),
            isActive: true,
            originalSearchSelection: selection,
            originalTvSelection: tvSelection || undefined,
          }

          this.state.setUserTvShowContext(userId, tvShowContext)

          const granularSelectionResponse =
            await this.generateTvShowChatResponse(
              messages,
              'TV_SHOW_GRANULAR_SELECTION_NEEDED',
              { selectedShow },
            )

          return {
            images: [],
            messages: messages.concat(granularSelectionResponse),
          }
        } else {
          this.logger.warn(
            { userId, selection, searchResultsCount: searchResults.length },
            'Could not find selected show from ordinal/year selection, falling back to list',
          )
        }
      }

      if (searchResults.length === 1) {
        // Only one result - but we still need granular selection
        this.logger.log(
          { userId, tvdbId: searchResults[0].tvdbId },
          'Single result found, checking for granular selection',
        )

        // If we have granular selection, apply it directly
        if (
          tvSelection &&
          Object.prototype.hasOwnProperty.call(tvSelection, 'selection')
        ) {
          this.logger.log(
            { userId, tvdbId: searchResults[0].tvdbId },
            'Single show with granular selection, downloading directly',
          )

          const response = await this.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SUCCESS',
            {
              selectedShow: searchResults[0],
              downloadResult: {
                seriesAdded: true,
                seriesUpdated: false,
                searchTriggered: true,
              },
              autoApplied: true,
              granularSelection: tvSelection,
            },
          )

          const downloadResult =
            await this.sonarrService.monitorAndDownloadSeries(
              searchResults[0].tvdbId,
              tvSelection,
            )

          if (!downloadResult.success) {
            const errorResponse = await this.generateTvShowChatResponse(
              messages,
              'TV_SHOW_ERROR',
              {
                selectedShow: searchResults[0],
                errorMessage: `Failed to add "${searchResults[0].title}" to downloads: ${downloadResult.error}`,
              },
            )
            return {
              images: [],
              messages: messages.concat(errorResponse),
            }
          }

          return {
            images: [],
            messages: messages.concat(response),
          }
        }

        // Store context and ask for granular selection
        const tvShowContext = {
          searchResults: searchResults.slice(0, 1),
          query: searchQuery,
          timestamp: Date.now(),
          isActive: true,
          originalSearchSelection: selection || undefined,
          originalTvSelection: tvSelection || undefined,
        }

        this.state.setUserTvShowContext(userId, tvShowContext)

        const selectionResponse = await this.generateTvShowChatResponse(
          messages,
          'TV_SHOW_SELECTION_NEEDED',
          { searchQuery, shows: searchResults.slice(0, 1) },
        )

        return {
          images: [],
          messages: messages.concat(selectionResponse),
        }
      }

      // Multiple results - store context and ask user to choose
      const tvShowContext = {
        searchResults: searchResults.slice(0, MAX_SEARCH_RESULTS),
        query: searchQuery,
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: selection || undefined,
        originalTvSelection: tvSelection || undefined,
      }

      this.state.setUserTvShowContext(userId, tvShowContext)

      // Create selection prompt
      const selectionResponse = await this.generateTvShowChatResponse(
        messages,
        'TV_SHOW_SELECTION_NEEDED',
        {
          searchQuery,
          shows: searchResults.slice(0, MAX_SEARCH_RESULTS),
        },
      )

      return {
        images: [],
        messages: messages.concat(selectionResponse),
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, searchQuery },
        'Failed to search for TV shows',
      )

      const errorResponse = await this.generateTvShowChatResponse(
        messages,
        'TV_SHOW_ERROR',
        {
          searchQuery,
          errorMessage: `Couldn't search for "${searchQuery}" right now. The Sonarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  private async handleTvShowSelection(
    message: HumanMessage,
    messages: BaseMessage[],
    tvShowContext: TvShowSelectionContext,
    userId: string,
  ) {
    this.logger.log(
      { userId, selectionMessage: message.content },
      'Processing TV show selection',
    )

    try {
      // Check if this is a show selection (ordinal, title, etc.) or a granular selection
      if (tvShowContext.searchResults.length > 1) {
        // Multiple shows - first need to select which show
        const searchSelection = await this.parseSearchSelection(
          typeof message.content === 'string'
            ? message.content
            : message.content.toString(),
        ).catch(() => null)

        // If no selection was parsed, ask user to clarify
        if (!searchSelection) {
          const clarificationResponse = await this.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SELECTION_NEEDED',
            {
              searchQuery: tvShowContext.query,
              shows: tvShowContext.searchResults,
            },
          )
          return {
            images: [],
            messages: messages.concat(clarificationResponse),
          }
        }

        const selectedShow = this.findSelectedShow(
          searchSelection,
          tvShowContext.searchResults,
        )

        if (!selectedShow) {
          const clarificationResponse = await this.generateTvShowChatResponse(
            messages,
            'TV_SHOW_SELECTION_NEEDED',
            {
              searchQuery: tvShowContext.query,
              shows: tvShowContext.searchResults,
            },
          )
          return {
            images: [],
            messages: messages.concat(clarificationResponse),
          }
        }

        // Show selected - check if we have stored granular selection to apply
        if (
          tvShowContext.originalTvSelection &&
          Object.prototype.hasOwnProperty.call(
            tvShowContext.originalTvSelection,
            'selection',
          )
        ) {
          // We have the original TV selection (either undefined for entire series or array for specific) - apply it automatically
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              originalTvSelection: tvShowContext.originalTvSelection,
            },
            'Auto-applying stored granular selection after show selection',
          )

          // Clear context and download the TV show with stored granular selection
          this.state.clearUserTvShowContext(userId)
          return await this.downloadTvShow(
            selectedShow,
            tvShowContext.originalTvSelection,
            message,
            messages,
            userId,
          )
        } else {
          // No stored granular selection or empty selection - ask user for it
          this.logger.log(
            {
              userId,
              tvdbId: selectedShow.tvdbId,
              originalTvSelection: tvShowContext.originalTvSelection,
            },
            'No granular selection found, asking user for season/episode selection',
          )

          const updatedContext = {
            ...tvShowContext,
            searchResults: [selectedShow],
          }
          this.state.setUserTvShowContext(userId, updatedContext)

          const granularSelectionResponse =
            await this.generateTvShowChatResponse(
              messages,
              'TV_SHOW_SELECTION_NEEDED',
              { searchQuery: tvShowContext.query, shows: [selectedShow] },
            )

          return {
            images: [],
            messages: messages.concat(granularSelectionResponse),
          }
        }
      }

      // Single show selected - parse granular selection (seasons/episodes)
      const messageContent =
        typeof message.content === 'string'
          ? message.content
          : message.content.toString()

      const tvShowSelection = await this.parseTvShowSelection(
        messageContent,
      ).catch(() => null)
      this.logger.log(
        { userId, selection: tvShowSelection },
        'Parsed TV show selection',
      )

      // If no granular selection was parsed, ask user to specify what to download
      if (!tvShowSelection) {
        const granularSelectionResponse = await this.generateTvShowChatResponse(
          messages,
          'TV_SHOW_SELECTION_NEEDED',
          {
            searchQuery: tvShowContext.query,
            shows: tvShowContext.searchResults,
          },
        )
        return {
          images: [],
          messages: messages.concat(granularSelectionResponse),
        }
      }

      const selectedShow = tvShowContext.searchResults[0]

      // Clear context and download the TV show
      this.state.clearUserTvShowContext(userId)
      return await this.downloadTvShow(
        selectedShow,
        tvShowSelection,
        message,
        messages,
        userId,
      )
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId },
        'Failed to process TV show selection',
      )

      // Clear context on error
      this.state.clearUserTvShowContext(userId)

      const errorResponse = await this.generateTvShowChatResponse(
        messages,
        'TV_SHOW_PROCESSING_ERROR',
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
   * Delete a TV show from the library with support for complex selections
   */
  private async deleteTvShow(
    show: { id: number; tvdbId: number; title: string; year?: number },
    selection: TvShowSelection,
    _originalMessage: HumanMessage,
    messages: BaseMessage[],
    userId: string,
  ) {
    // VALIDATION GATE: Ensure we have valid selection data before proceeding
    if (
      !selection ||
      !selection.selection ||
      selection.selection.length === 0
    ) {
      this.logger.error(
        {
          userId,
          showTitle: show.title,
          selection,
        },
        'VALIDATION GATE: Invalid TV selection provided to deleteTvShow',
      )

      const errorResponse = await this.generateTvShowDeleteChatResponse(
        messages,
        'TV_SHOW_DELETE_ERROR',
        {
          selectedShow: show,
          errorMessage: 'Invalid selection data - cannot proceed with deletion',
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }

    this.logger.log(
      {
        userId,
        showTitle: show.title,
        tvdbId: show.tvdbId,
        seriesId: show.id,
        selection,
      },
      'Attempting to delete TV show',
    )

    try {
      const result = await this.sonarrService.unmonitorAndDeleteSeries(
        show.tvdbId,
        {
          selection: selection.selection,
          deleteFiles: true, // Always delete files for user-initiated deletes
        },
      )

      if (result.success) {
        this.logger.log(
          {
            userId,
            showTitle: show.title,
            situationType: 'TV_SHOW_DELETE_SUCCESS',
            deleteResult: result,
          },
          'DEBUG: Generating TV show delete success response',
        )

        const successResponse = await this.generateTvShowDeleteChatResponse(
          messages,
          'TV_SHOW_DELETE_SUCCESS',
          {
            selectedShow: show,
            deleteResult: result,
          },
        )

        return {
          images: [],
          messages: messages.concat(successResponse),
        }
      } else {
        const errorResponse = await this.generateTvShowDeleteChatResponse(
          messages,
          'TV_SHOW_DELETE_ERROR',
          {
            selectedShow: show,
            errorMessage: `Failed to delete "${show.title}": ${result.error}`,
          },
        )

        return {
          images: [],
          messages: messages.concat(errorResponse),
        }
      }
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), userId, showTitle: show.title },
        'Failed to delete TV show',
      )

      const errorResponse = await this.generateTvShowDeleteChatResponse(
        messages,
        'TV_SHOW_DELETE_ERROR',
        {
          selectedShow: show,
          errorMessage: `Couldn't delete "${show.title}". The Sonarr service might be unavailable.`,
        },
      )

      return {
        images: [],
        messages: messages.concat(errorResponse),
      }
    }
  }

  /**
   * Generate conversational response for TV show delete operations
   */
  private async generateTvShowDeleteChatResponse(
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
    try {
      this.logger.log(
        {
          situationType,
          context,
        },
        'DEBUG: Generating TV show delete chat response with context',
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
          this.getChatModel().invoke([
            TV_SHOW_DELETE_RESPONSE_CONTEXT_PROMPT,
            contextMessage,
            ...messages,
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-generateTvShowDeleteResponse',
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
        'Failed to generate TV show delete chat response',
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
   * Extract TV show delete query from user message using LLM
   */
  private async extractTvDeleteQueryWithLLM(content: string): Promise<string> {
    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            EXTRACT_TV_SEARCH_QUERY_PROMPT, // Reuse the same extraction logic
            new HumanMessage({ id: nanoid(), content }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-extractTvDeleteQuery',
      )

      const extractedQuery = response.content.toString().trim()

      // Clean the extracted query by removing surrounding quotes that LLM might add
      const cleanedQuery = extractedQuery.replace(/^["']|["']$/g, '').trim()

      this.logger.log(
        { originalContent: content, extractedQuery, cleanedQuery },
        'Extracted TV delete query using LLM',
      )

      return cleanedQuery || content // Fallback to original if empty
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), content },
        'Failed to extract TV delete query with LLM, using fallback',
      )

      // Simple fallback extraction for delete operations
      return content
        .toLowerCase()
        .replace(/\b(delete|remove|unmonitor|get rid of)\b/gi, '')
        .replace(/\b(show|series|tv|television|the)\b/gi, '')
        .trim()
    }
  }

  private async parseTvShowSelection(
    selectionText: string,
  ): Promise<TvShowSelection> {
    this.logger.log(
      { selectionText },
      'DEBUG: Starting parseTvShowSelection with input',
    )

    try {
      const response = await this.retryService.executeWithRetry(
        () =>
          this.getReasoningModel().invoke([
            TV_SHOW_SELECTION_PARSING_PROMPT,
            new HumanMessage({ id: nanoid(), content: selectionText }),
          ]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 15000,
        },
        'OpenAI-parseTvShowSelection',
      )

      const rawResponse = response.content.toString()
      this.logger.log(
        { rawResponse, selectionText },
        'DEBUG: Raw LLM response for TV show selection parsing',
      )

      const parsed = JSON.parse(rawResponse)
      this.logger.log(
        { parsed, selectionText },
        'DEBUG: Parsed JSON for TV show selection (before schema validation)',
      )

      // Handle error responses from LLM
      if (parsed.error) {
        this.logger.log(
          { error: parsed.error, selectionText },
          'DEBUG: LLM returned error response for TV show selection',
        )
        throw new Error(`LLM parsing error: ${parsed.error}`)
      }

      const validated = TvShowSelectionSchema.parse(parsed)
      this.logger.log(
        { validated, selectionText },
        'DEBUG: Successfully validated TV show selection',
      )

      return validated
    } catch (error) {
      this.logger.error(
        {
          error: getErrorMessage(error),
          selectionText,
          errorType:
            error instanceof Error ? error.constructor.name : typeof error,
        },
        'Failed to parse TV show selection - no fallback, letting conversation flow handle it',
      )
      throw error
    }
  }

  private findSelectedShow(
    selection: SearchSelection,
    shows: SeriesSearchResult[],
  ): SeriesSearchResult | null {
    const { selectionType, value } = selection

    this.logger.log(
      { selectionType, value, showCount: shows.length },
      'Finding selected TV show from parsed selection',
    )

    switch (selectionType) {
      case 'ordinal': {
        const index = parseInt(value) - 1
        if (index >= 0 && index < shows.length) {
          this.logger.log(
            { selectedIndex: index },
            'Selected TV show by ordinal',
          )
          return shows[index]
        }
        this.logger.warn(
          { index, showCount: shows.length },
          'Ordinal index out of range, defaulting to first',
        )
        return shows[0] || null
      }

      case 'year': {
        const yearMatch = shows.find(show => show.year?.toString() === value)
        if (yearMatch) {
          this.logger.log({ selectedYear: value }, 'Selected TV show by year')
          return yearMatch
        }
        this.logger.warn(
          { year: value },
          'No TV show found for year, defaulting to first',
        )
        return shows[0] || null
      }

      default: {
        this.logger.log('Using default selection (first TV show)')
        return shows[0] || null // Default to first
      }
    }
  }

  private async generateTvShowChatResponse(
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
          this.getChatModel().invoke([
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
        `OpenAI-generateTvShowChatResponse-${situation}`,
      )

      return new HumanMessage({
        id: nanoid(),
        content: response.content.toString(),
      })
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), situation },
        'Failed to generate TV show chat response, using fallback',
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

  // TV Show helper methods
}
