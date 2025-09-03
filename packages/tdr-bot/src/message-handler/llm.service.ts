import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import {
  BaseMessage,
  HumanMessage,
  isAIMessage,
} from '@langchain/core/messages'
import { StateGraph, StateType, UpdateType } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai'
import { isEnumValue } from '@lilnas/utils/enum'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import dedent from 'dedent'
import { nanoid } from 'nanoid'

import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
import { MovieSearchResult } from 'src/media/types/radarr.types'
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
import { MessageResponse } from 'src/schemas/messages'
import {
  MovieSelection,
  MovieSelectionContext,
  MovieSelectionSchema,
} from 'src/schemas/movie'
import { EquationImageService } from 'src/services/equation-image.service'
import { StateService } from 'src/state/state.service'
import { UnhandledMessageResponseError } from 'src/utils/error'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import {
  EXTRACT_IMAGE_QUERIES_PROMPT,
  EXTRACT_SEARCH_QUERY_PROMPT,
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
      temperature: 0,
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
          : 'Determine if user switched topics from movie selection.'

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

      // Route based on intent: download vs browse
      if (this.isDownloadRequest(mediaRequest, message)) {
        this.logger.log({ userId }, 'Routing to download flow')
        return await this.handleNewMovieSearch(message, messages, userId)
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

    // Extract search terms from the message using LLM
    const messageContent =
      typeof message.content === 'string'
        ? message.content
        : message.content.toString()
    const searchQuery = await this.extractSearchQueryWithLLM(messageContent)

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
        { userId, searchQuery, resultCount: searchResults.length },
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
        searchResults: searchResults.slice(0, 10), // Limit to top 10 results
        query: searchQuery,
        timestamp: Date.now(),
        isActive: true,
      }

      this.state.setUserMovieContext(userId, movieContext)

      // Create selection prompt using LLM
      const selectionResponse = await this.generateChatResponse(
        messages,
        'multiple_results',
        { searchQuery, movies: searchResults.slice(0, 10) },
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
      const selection = await this.parseMovieSelection(messageContent)
      this.logger.log({ userId, selection }, 'Parsed movie selection')

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
      | 'processing_error',
    context?: {
      searchQuery?: string
      movies?: MovieSearchResult[]
      selectedMovie?: MovieSearchResult
      errorMessage?: string
      downloadResult?: unknown
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
            contextPrompt += `Multiple movies found for "${context.searchQuery}":\n\n${movieList}\n\nAsk the user which one they want to download. They can respond with ordinal numbers, years, actor names, etc.`
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
            contextPrompt += `Successfully ${result.movieAdded ? 'added' : 'found'} "${movie.title}" ${result.movieAdded ? 'to download queue' : 'in library'}. ${result.searchTriggered ? 'Search has been triggered.' : 'Search will start automatically.'} Respond with enthusiasm.`
          }
          break
        case 'processing_error':
          contextPrompt += `There was an error processing the user's movie selection. ${context?.errorMessage || 'Suggest they try searching again.'} Be helpful and encouraging.`
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

  private async parseMovieSelection(
    selectionText: string,
  ): Promise<MovieSelection> {
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
        'OpenAI-parseMovieSelection',
      )

      const parsed = JSON.parse(response.content.toString())
      return MovieSelectionSchema.parse(parsed)
    } catch (error) {
      this.logger.error(
        { error: getErrorMessage(error), selectionText },
        'Failed to parse movie selection, using fallback',
      )

      // Simple fallback parsing
      return {
        selectionType: 'ordinal',
        value: '1', // Default to first option
        confidence: 'low',
      }
    }
  }

  private findSelectedMovie(
    selection: MovieSelection,
    movies: MovieSearchResult[],
  ): MovieSearchResult | null {
    const { selectionType, value } = selection

    switch (selectionType) {
      case 'ordinal': {
        const index = parseInt(value) - 1
        return movies[index] || null
      }

      case 'year': {
        return movies.find(movie => movie.year?.toString() === value) || null
      }

      case 'title': {
        const titleMatch = movies.find(movie =>
          movie.title.toLowerCase().includes(value.toLowerCase()),
        )
        return titleMatch || null
      }

      case 'keyword': {
        const keywordMatch = movies.find(
          movie =>
            movie.title.toLowerCase().includes(value.toLowerCase()) ||
            movie.overview?.toLowerCase().includes(value.toLowerCase()),
        )
        return keywordMatch || null
      }

      default: {
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
}
