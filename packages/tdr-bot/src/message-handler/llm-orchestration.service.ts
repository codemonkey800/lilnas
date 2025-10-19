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
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import dedent from 'dedent'
import { nanoid } from 'nanoid'

import { REASONING_TEMPERATURE } from 'src/constants/llm'
import { MediaRequestHandler } from 'src/media-operations/request-handling/media-request-handler.service'
import { MessageUtils } from 'src/message-handler/utils/message-utils'
import {
  GraphNode,
  ImageQuerySchema,
  ImageResponseSchema,
  InputStateAnnotation,
  OutputStateAnnotation,
  OverallStateAnnotation,
  ResponseType,
} from 'src/schemas/graph'
import {
  LLMStringContentSchema,
  ResponseTypeContentSchema,
} from 'src/schemas/llm.schemas'
import { MessageResponse } from 'src/schemas/messages'
import { EquationImageService } from 'src/services/equation-image.service'
import { StateService } from 'src/state/state.service'
import { UnhandledMessageResponseError } from 'src/utils/error'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import {
  EXTRACT_IMAGE_QUERIES_PROMPT,
  GET_CHAT_MATH_RESPONSE,
  GET_MATH_RESPONSE_PROMPT,
  GET_RESPONSE_TYPE_PROMPT,
  IMAGE_RESPONSE,
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
 * LLMOrchestrationService - Lightweight orchestration service
 *
 * This service coordinates LLM interactions using LangGraph state machine.
 * It delegates specialized work to focused services:
 * - Media operations → MediaRequestHandler (Phase 5)
 * - Math rendering → EquationImageService
 * - Image generation → DallEAPIWrapper
 *
 * This is a clean implementation built from the ground up, not a refactor.
 * Original LLMService remains untouched and can coexist during migration.
 */
@Injectable()
export class LLMOrchestrationService {
  private readonly logger = new Logger(LLMOrchestrationService.name)

  constructor(
    private readonly state: StateService,
    private readonly equationImage: EquationImageService,
    private readonly retryService: RetryService,
    private readonly errorClassifier: ErrorClassificationService,
    private readonly mediaRequestHandler: MediaRequestHandler,
  ) {
    // Log tool registration for debugging
    this.logger.log(
      {
        totalToolCount: this.tools.length,
        toolNames: this.tools.map(t => t.name),
      },
      'LLMOrchestration tools registered and initialized',
    )
  }

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

  /**
   * Get reasoning model for structured tasks (temperature 0)
   */
  /**
   * Get reasoning model for specialized tasks
   * Protected to allow testing without breaking encapsulation
   */
  protected getReasoningModel() {
    const state = this.state.getState()

    this.logger.log({ model: state.reasoningModel }, 'Getting reasoning model')

    return new ChatOpenAI({
      model: state.reasoningModel,
      temperature: REASONING_TEMPERATURE,
    })
  }

  /**
   * Get chat model with tools bound
   * Protected to allow testing without breaking encapsulation
   */
  protected getChatModel() {
    const state = this.state.getState()

    this.logger.log({ model: state.chatModel }, 'Getting chat model')

    return new ChatOpenAI({
      model: state.chatModel,
      temperature: state.temperature,
    }).bindTools(this.tools)
  }

  /**
   * Check response type with context-first optimization
   *
   * Performance optimization:
   * - First checks if user has active media context (e.g., movie selection in progress)
   * - If yes, skips LLM intent detection and returns ResponseType.Media immediately
   * - This saves ~500-1000ms latency and reduces API costs during multi-turn media operations
   *
   * Otherwise performs high-level intent detection: Media/Math/Image/Default
   */
  private async checkResponseType({
    userInput,
    userId,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log({ userId }, 'Checking response type')

    const message = new HumanMessage({
      id: nanoid(),
      content: userInput,
    })

    // OPTIMIZATION: Check for active media context FIRST
    // This skips LLM intent detection during multi-turn media conversations
    const hasActiveContext =
      await this.mediaRequestHandler.hasActiveMediaContext(userId, message)

    if (hasActiveContext) {
      this.logger.log(
        { userId },
        'Active media context detected, skipping intent detection',
      )
      return { message, responseType: ResponseType.Media }
    }

    // No active context - proceed with LLM intent detection
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

    // Validate response type using Zod schema
    const responseType = ResponseTypeContentSchema.parse(response.content)

    this.logger.log({ responseType }, 'Got response type')

    return { message, responseType }
  }

  /**
   * Add TDR system prompt to messages
   */
  private addTdrSystemPrompt({
    messages,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log('Checking for TDR system prompt')

    // Check if prompt already exists to avoid duplication
    if (messages?.some(message => message.id === TDR_SYSTEM_PROMPT_ID)) {
      this.logger.log('TDR system prompt found, skipping')
      return { messages }
    }

    this.logger.log('Adding TDR system prompt')
    return {
      messages: [this.state.getPrompt()].concat(messages),
    }
  }

  /**
   * Check if message contains tool calls
   */
  private isToolsMessage(message: BaseMessage) {
    return MessageUtils.isToolsMessage(message)
  }

  /**
   * Handle model response routing
   * If model called tools, route to tools node
   * Otherwise, end conversation
   */
  private handleModelResponse({
    messages,
  }: typeof OverallStateAnnotation.State) {
    const lastMessage = messages.at(-1)

    if (!lastMessage) {
      throw new Error('No messages in state')
    }

    if (this.isToolsMessage(lastMessage)) {
      this.logger.log('Model response contains tool calls, routing to tools')
      return GraphNode.Tools
    }

    return GraphNode.End
  }

  /**
   * Get default chat response with tool support
   */
  private async getModelDefaultResponse({
    messages,
    message,
  }: typeof OverallStateAnnotation.State) {
    const allMessages = messages.concat(message)

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

    return {
      messages: [message, response],
    }
  }

  /**
   * Generate image using DALL-E
   */
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

      // Validate content is a string before parsing
      const contentString = LLMStringContentSchema.parse(
        extractImageQueriesResponse.content,
      )
      const imageQueries = ImageQuerySchema.parse(JSON.parse(contentString))

      this.logger.log(
        {
          queryCount: imageQueries.length,
          queries: imageQueries.map(q => ({ title: q.title, query: q.query })),
        },
        'Extracted image queries, starting generation',
      )

      const dalle = new DallEAPIWrapper()
      const startTime = Date.now()
      const images = await Promise.all(
        imageQueries.map(async ({ title, query }) => {
          this.logger.log({ title, query }, 'Generating image with DALL-E')

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

          this.logger.log({ title, url }, 'Successfully generated image')

          return ImageResponseSchema.parse({
            title,
            url,
          })
        }),
      )

      this.logger.log(
        {
          imageCount: images.length,
          duration: Date.now() - startTime,
          images: images.map(img => ({ title: img.title, url: img.url })),
        },
        'All images generated successfully',
      )

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
        messages: [chatResponse],
      }
    } catch (err) {
      this.logger.error(
        {
          error: getErrorMessage(err),
          originalMessage: message.content,
          messageLength:
            typeof message.content === 'string' ? message.content.length : 0,
          ...(err instanceof Error ? { stack: err.stack } : {}),
        },
        'Failed to generate images - returning error message to user',
      )

      // Return error message instead of images
      const errorMessage = new SystemMessage({
        id: nanoid(),
        content: dedent`
          Sorry, I couldn't generate the image. Error: ${getErrorMessage(err)}
        `,
      })

      return {
        images: [],
        messages: [errorMessage],
      }
    }
  }

  /**
   * Generate math response with LaTeX rendering
   */
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

    this.logger.log(
      {
        latexLength: latex.length,
        latexPreview: latex.substring(0, 200),
      },
      'Extracted LaTeX for rendering',
    )

    // Parallelize image rendering and chat response - they're independent
    const startTime = Date.now()
    const [equationImageResponse, chatResponse] = await Promise.all([
      this.equationImage.getImage(latex),
      this.retryService.executeWithRetry(
        () => this.getChatModel().invoke([...messages, GET_CHAT_MATH_RESPONSE]),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          timeout: 30000,
        },
        'OpenAI-getModelMathResponse-chat',
      ),
    ])

    this.logger.log(
      {
        duration: Date.now() - startTime,
        hasEquationImage: !!equationImageResponse,
        equationUrl: equationImageResponse?.url,
      },
      'Completed parallel math response operations',
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
      messages: [chatResponse],
    }
  }

  /**
   * Handle media request - delegate to MediaRequestHandler
   * This is the key simplification: all media logic (2500+ lines)
   * is now handled by MediaRequestHandler and its strategies
   */
  private async getModelMediaResponse({
    message,
    messages,
    userId,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log(
      { message: message.content, userId },
      'Processing media request',
    )

    // Delegate entirely to MediaRequestHandler
    // It handles: context checking, intent detection, routing, operations
    return await this.mediaRequestHandler.handleRequest(
      message,
      messages,
      userId,
      undefined, // state parameter (not used currently)
    )
  }

  /**
   * Trim messages to fit within context window
   */
  private trimMessages({ messages }: typeof OverallStateAnnotation.State) {
    const state = this.state.getState()
    const maxTokens = state.maxTokens

    this.logger.log(
      { messageCount: messages.length, maxTokens },
      'Trimming messages',
    )

    // Delegate to MessageUtils for actual trimming logic
    // For now, just keep the last 50 messages
    // TODO: Implement proper token counting based on maxTokens
    const finalMessages = MessageUtils.trimMessages(messages, 50)

    this.logger.log(
      {
        originalCount: messages.length,
        trimmedCount: finalMessages.length,
      },
      'Messages trimmed',
    )

    return { messages: finalMessages }
  }

  /**
   * Main entry point for LLM interactions
   * Invokes LangGraph state machine and returns response
   */
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
      'Invoking LLM Orchestration',
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

      // Validate content is a string
      const content = LLMStringContentSchema.parse(lastMessage.content)

      return {
        images,
        content,
      }
    } catch (err) {
      this.logger.error(
        {
          error: getErrorMessage(err),
          user,
          userId: finalUserId,
          message,
          messageLength: message.length,
          ...(err instanceof UnhandledMessageResponseError
            ? { response: err.response }
            : {}),
          ...(err instanceof Error ? { stack: err.stack } : {}),
        },
        'LLM Orchestration failed - returning error to user',
      )

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
