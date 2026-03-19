import { isAIMessage } from '@langchain/core/messages'
import { StateGraph, StateType, UpdateType } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'

import { MAX_GRAPH_HISTORY_SIZE } from 'src/constants/llm'
import { PromptService } from 'src/messages/prompts/prompt.service'
import { MessageUtils } from 'src/messages/utils/message-utils'
import {
  GraphNode,
  InputStateAnnotation,
  OutputStateAnnotation,
  OverallStateAnnotation,
  ResponseType,
} from 'src/schemas/graph'
import { LLMStringContentSchema } from 'src/schemas/llm.schemas'
import { MessageResponse } from 'src/schemas/messages'
import { StateService } from 'src/state/state.service'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'
import { TDR_SYSTEM_PROMPT_ID } from 'src/utils/prompts'

import { DefaultResponseNode } from './nodes/default-response.node'
import { ImageResponseNode } from './nodes/image-response.node'
import { IntentDetectionNode } from './nodes/intent-detection.node'
import { MathResponseNode } from './nodes/math-response.node'
import { MediaResponseNode } from './nodes/media-response.node'
import { ReminderResponseNode } from './nodes/reminder-response.node'
import { getTools } from './tools'

/** Compiled LangGraph that accepts input state and returns output state. */
interface CompiledLLMGraph {
  invoke(
    input: typeof InputStateAnnotation.State,
  ): Promise<typeof OutputStateAnnotation.State>
}

/** Maps each {@link ResponseType} to its corresponding graph node. */
const RESPONSE_TYPE_GRAPH_NODE_MAP: Record<ResponseType, GraphNode> = {
  [ResponseType.Default]: GraphNode.GetModelDefaultResponse,
  [ResponseType.Math]: GraphNode.GetModelMathResponse,
  [ResponseType.Image]: GraphNode.GetModelImageResponse,
  [ResponseType.Media]: GraphNode.GetModelMediaResponse,
  [ResponseType.Reminder]: GraphNode.GetModelReminderResponse,
}

/**
 * Builds and owns the LangGraph state machine that processes
 * every user message through the AI pipeline.
 *
 * The graph flow is:
 *   Start → IntentDetection → TrimMessages → AddSystemPrompt
 *         → (conditional) → ResponseNode → End
 *
 * The default response node supports tool calling (e.g. Tavily search)
 * with a tool-call → tools → response loop.
 */
@Injectable()
export class LLMOrchestrationService implements OnModuleInit {
  private readonly logger = new Logger(LLMOrchestrationService.name)

  private app!: CompiledLLMGraph

  constructor(
    private readonly state: StateService,
    private readonly promptService: PromptService,
    private readonly intentDetection: IntentDetectionNode,
    private readonly defaultResponse: DefaultResponseNode,
    private readonly imageResponse: ImageResponseNode,
    private readonly mathResponse: MathResponseNode,
    private readonly mediaResponse: MediaResponseNode,
    private readonly reminderResponse: ReminderResponseNode,
    private readonly metrics: TdrBotMetricsService,
  ) {}

  /** Compiles the LangGraph state machine and wires all nodes and edges. */
  onModuleInit() {
    const tools = getTools()
    const toolNode = new ToolNode(tools)

    this.app = new StateGraph<
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
      .addNode(
        GraphNode.CheckResponseType,
        this.intentDetection.invoke.bind(this.intentDetection),
      )
      .addNode(GraphNode.AddTdrSystemPrompt, this.addTdrSystemPrompt.bind(this))
      .addNode(GraphNode.TrimMessages, this.trimMessages.bind(this))
      .addNode(
        GraphNode.GetModelDefaultResponse,
        this.defaultResponse.invoke.bind(this.defaultResponse),
      )
      .addNode(
        GraphNode.GetModelImageResponse,
        this.imageResponse.invoke.bind(this.imageResponse),
      )
      .addNode(
        GraphNode.GetModelMathResponse,
        this.mathResponse.invoke.bind(this.mathResponse),
      )
      .addNode(
        GraphNode.GetModelMediaResponse,
        this.mediaResponse.invoke.bind(this.mediaResponse),
      )
      .addNode(
        GraphNode.GetModelReminderResponse,
        this.reminderResponse.invoke.bind(this.reminderResponse),
      )
      .addNode(GraphNode.Tools, toolNode)
      .addEdge(GraphNode.Start, GraphNode.CheckResponseType)
      .addEdge(GraphNode.CheckResponseType, GraphNode.TrimMessages)
      .addEdge(GraphNode.TrimMessages, GraphNode.AddTdrSystemPrompt)
      .addEdge(GraphNode.Tools, GraphNode.GetModelDefaultResponse)
      .addEdge(GraphNode.GetModelImageResponse, GraphNode.End)
      .addEdge(GraphNode.GetModelMathResponse, GraphNode.End)
      .addEdge(GraphNode.GetModelMediaResponse, GraphNode.End)
      .addEdge(GraphNode.GetModelReminderResponse, GraphNode.End)
      .addConditionalEdges(
        GraphNode.AddTdrSystemPrompt,
        state => RESPONSE_TYPE_GRAPH_NODE_MAP[state.responseType],
      )
      .addConditionalEdges(
        GraphNode.GetModelDefaultResponse,
        this.handleModelResponse.bind(this),
      )
      .compile()

    this.logger.log(
      { toolCount: tools.length, toolNames: tools.map(t => t.name) },
      'LLM orchestration graph compiled',
    )
  }

  /** Prepends the TDR Bot system prompt to the message list if not already present. */
  private addTdrSystemPrompt({
    messages,
  }: typeof OverallStateAnnotation.State) {
    if (messages?.some(m => m.id === TDR_SYSTEM_PROMPT_ID)) {
      return { messages }
    }

    return {
      messages: [this.promptService.getSystemPrompt()].concat(messages),
    }
  }

  /** Routes to the Tools node if the last AI message contains tool calls, otherwise ends. */
  private handleModelResponse({
    messages,
  }: typeof OverallStateAnnotation.State) {
    const lastMessage = messages.at(-1)

    if (!lastMessage) {
      throw new Error('No messages in state')
    }

    if (MessageUtils.isToolsMessage(lastMessage)) {
      this.logger.log('Model response contains tool calls, routing to tools')
      return GraphNode.Tools
    }

    return GraphNode.End
  }

  /** Caps the conversation history to the most recent messages to control token usage. */
  private trimMessages({ messages }: typeof OverallStateAnnotation.State) {
    this.logger.log({ messageCount: messages.length }, 'Trimming messages')

    const finalMessages = MessageUtils.trimMessages(messages, 50)

    this.logger.log(
      { originalCount: messages.length, trimmedCount: finalMessages.length },
      'Messages trimmed',
    )

    return { messages: finalMessages }
  }

  /**
   * Public entry point: formats the user input, invokes the compiled
   * LangGraph, records metrics, and returns the final response.
   *
   * @param params.message - Raw message content from the user.
   * @param params.user - Display name of the message author.
   * @param params.userId - Discord user ID (falls back to `user`).
   * @param params.guildId - Discord guild ID for reminder delivery.
   * @returns The AI-generated response text and any generated images.
   */
  async sendMessage({
    message,
    user,
    userId,
    guildId,
  }: {
    message: string
    user: string
    userId?: string
    guildId?: string
  }): Promise<MessageResponse> {
    const userInput = `${user} said "${message}"`
    const finalUserId = userId || user

    this.logger.log(
      { user, message, userInput, userId: finalUserId },
      'Invoking LLM Orchestration',
    )

    const currentState = this.state.getState()
    const startTime = Date.now()

    let responseType: ResponseType = ResponseType.Default
    try {
      const {
        images,
        messages,
        responseType: detectedType,
      } = await this.app.invoke({
        userInput,
        userId: finalUserId,
        guildId: guildId ?? '',
        messages: currentState.graphHistory.at(-1)?.messages ?? [],
      })

      responseType = detectedType ?? ResponseType.Default
      const durationMs = Date.now() - startTime

      this.state.setState(prev => {
        const history = prev.graphHistory.concat({
          images,
          messages,
          responseType,
        })
        return {
          graphHistory:
            history.length > MAX_GRAPH_HISTORY_SIZE
              ? history.slice(-MAX_GRAPH_HISTORY_SIZE)
              : history,
        }
      })

      const lastMessage = messages.at(-1)

      if (!lastMessage) {
        throw new Error('Did not receive a message')
      }

      if (isAIMessage(lastMessage)) {
        const tokenUsage = lastMessage.response_metadata?.tokenUsage as
          | Record<string, number>
          | undefined

        this.logger.log(tokenUsage, 'Token count for last message')

        if (tokenUsage) {
          if (tokenUsage.promptTokens) {
            this.metrics.llmTokens('prompt_tokens', tokenUsage.promptTokens)
          }
          if (tokenUsage.completionTokens) {
            this.metrics.llmTokens(
              'completion_tokens',
              tokenUsage.completionTokens,
            )
          }
          if (tokenUsage.totalTokens) {
            this.metrics.llmTokens('total_tokens', tokenUsage.totalTokens)
          }
        }
      }

      this.metrics.llmRequest(responseType, 'success')
      this.metrics.observeLlmDuration(responseType, durationMs)

      const content = LLMStringContentSchema.parse(lastMessage.content)

      return { images, content }
    } catch (error) {
      const durationMs = Date.now() - startTime
      this.metrics.llmRequest(responseType, 'error')
      this.metrics.observeLlmDuration(responseType, durationMs)
      throw error
    }
  }
}
