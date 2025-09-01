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
import { EquationImageService } from 'src/services/equation-image.service'
import { StateService } from 'src/state/state.service'
import { UnhandledMessageResponseError } from 'src/utils/error'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import {
  EXTRACT_IMAGE_QUERIES_PROMPT,
  GET_CHAT_MATH_RESPONSE,
  GET_MATH_RESPONSE_PROMPT,
  GET_MEDIA_TYPE_PROMPT,
  GET_RESPONSE_TYPE_PROMPT,
  IMAGE_RESPONSE,
  MEDIA_CONTEXT_PROMPT,
  TDR_SYSTEM_PROMPT_ID,
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
  }: typeof OverallStateAnnotation.State) {
    this.logger.log('Checking response type')

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
  }: typeof OverallStateAnnotation.State) {
    this.logger.log({ message: message.content }, 'Processing media request')

    try {
      // Step 1: Determine media type and search intent
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

      // Parse and validate JSON response using Zod schema
      let mediaRequest: MediaRequest
      try {
        const responseContent = mediaTypeResponse.content as string
        const parsedResponse = JSON.parse(responseContent)
        mediaRequest = MediaRequestSchema.parse(parsedResponse)
      } catch (error) {
        this.logger.warn(
          {
            response: mediaTypeResponse.content,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
          'Invalid media request response, using defaults',
        )
        // Fallback to defaults
        mediaRequest = {
          mediaType: MediaRequestType.Both,
          searchIntent: SearchIntent.Library,
          searchTerms: '',
        }
      }

      const { mediaType, searchIntent, searchTerms } = mediaRequest
      const searchQuery = searchTerms.trim()

      this.logger.log(
        { mediaType, searchIntent, searchQuery },
        'Determined media type, search intent, and extracted search terms',
      )

      // Step 3: Fetch data based on intent and type
      let mediaData = ''
      let totalCount = 0

      // Fetch library data if needed
      if (
        searchIntent === SearchIntent.Library ||
        searchIntent === SearchIntent.Both
      ) {
        const libraryData = await this.fetchLibraryData(mediaType)
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
            mediaData += '\n\n---\n' // Separator between library and external results
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

      // Step 4: Create context prompt
      const contextPrompt = new HumanMessage({
        content: `${MEDIA_CONTEXT_PROMPT.content}\n\nUser's request: "${message.content}"\n\nMEDIA DATA:${mediaData}`,
        id: nanoid(),
      })

      // Step 5: Get conversational response
      this.logger.log('Getting conversational response with media context')
      const chatResponse = await this.retryService.executeWithRetry(
        () => this.getChatModel().invoke([...messages, contextPrompt]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 45000,
        },
        'OpenAI-getMediaChatResponse',
      )

      this.logger.log(
        { mediaType, searchIntent, totalCount },
        'Media response generated successfully',
      )

      return {
        images: [],
        messages: messages.concat(chatResponse),
      }
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Error processing media request',
      )

      // Fallback response in case of error
      const fallbackResponse = new HumanMessage({
        content:
          'Sorry, I ran into an issue with your media request! 😅 The services might be down or having trouble.',
        id: nanoid(),
      })

      return {
        images: [],
        messages: messages.concat(fallbackResponse),
      }
    }
  }

  /**
   * Fetch library data based on media type
   */
  private async fetchLibraryData(mediaType: MediaRequestType): Promise<{
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
        this.logger.log('Fetching movie library data')
        const movies = await this.radarrService.getLibraryMovies()
        count += movies.length

        if (movies.length > 0) {
          content += '\n\n**MOVIES IN LIBRARY:**\n'
          content += movies
            .slice(0, 20)
            .map(movie => {
              const status = movie.hasFile ? '✅ Downloaded' : '📥 Missing'
              const year = movie.year ? ` (${movie.year})` : ''
              return `- ${movie.title}${year} - ${status}`
            })
            .join('\n')

          if (movies.length > 20) {
            content += `\n... and ${movies.length - 20} more movies`
          }
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
        this.logger.log('Fetching TV series library data')
        const series = await this.sonarrService.getLibrarySeries()
        count += series.length

        if (series.length > 0) {
          content += '\n\n**TV SHOWS IN LIBRARY:**\n'
          content += series
            .slice(0, 20)
            .map(show => {
              const seasons = show.statistics
                ? `S${show.statistics.seasonCount || 0}`
                : ''
              const episodes = show.statistics
                ? `E${show.statistics.totalEpisodeCount || 0}`
                : ''
              const status =
                show.statistics?.percentOfEpisodes === 100
                  ? '✅ Complete'
                  : '📥 Partial'
              return `- ${show.title} ${seasons}${episodes} - ${status}`
            })
            .join('\n')

          if (series.length > 20) {
            content += `\n... and ${series.length - 20} more shows`
          }
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

  /**
   * Fetch external search data based on media type and search query
   */
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
          content += movies
            .slice(0, 15) // Limit external results to avoid overwhelming
            .map(movie => {
              const year = movie.year ? ` (${movie.year})` : ''
              const rating = movie.rating ? ` ⭐${movie.rating.toFixed(1)}` : ''
              return `- ${movie.title}${year}${rating} - 🔍 Available to add`
            })
            .join('\n')

          if (movies.length > 15) {
            content += `\n... and ${movies.length - 15} more movie results`
          }
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
          content += shows
            .slice(0, 15) // Limit external results to avoid overwhelming
            .map(show => {
              const year = show.year ? ` (${show.year})` : ''
              const rating = show.rating ? ` ⭐${show.rating.toFixed(1)}` : ''
              return `- ${show.title}${year}${rating} - 🔍 Available to add`
            })
            .join('\n')

          if (shows.length > 15) {
            content += `\n... and ${shows.length - 15} more show results`
          }
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
  }: {
    message: string
    user: string
  }): Promise<MessageResponse> {
    const userInput = `${user} said "${message}"`

    this.logger.log(
      {
        user,
        message,
        userInput,
      },
      'Invoking LLM ',
    )

    try {
      const state = this.state.getState()
      const { images, messages } = await this.app.invoke({
        userInput,
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
