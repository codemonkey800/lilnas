import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import {
  BaseMessage,
  HumanMessage,
  isAIMessage,
} from '@langchain/core/messages'
import { StateGraph, StateType, UpdateType } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai'
import { Injectable, Logger } from '@nestjs/common'
import dedent from 'dedent'
import { nanoid } from 'nanoid'

import {
  GraphNode,
  ImageQuerySchema,
  ImageResponseSchema,
  InputStateAnnotation,
  OutputStateAnnotation,
  OverallStateAnnotation,
  ResponseType,
} from 'src/schemas/graph'
import { MessageResponse } from 'src/schemas/messages'
import { EquationImageService } from 'src/services/equation-image.service'
import { StateService } from 'src/state/state.service'
import { isEnumValue } from 'src/utils/enum'
import { getErrorMessage, UnhandledMessageResponseError } from 'src/utils/error'
import {
  EXTRACT_IMAGE_QUERIES_PROMPT,
  GET_CHAT_MATH_RESPONSE,
  GET_MATH_RESPONSE_PROMPT,
  GET_RESPONSE_TYPE_PROMPT,
  IMAGE_RESPONSE,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'

import { dateTool } from './tools'

const RESPONSE_TYPE_GRAPH_NODE_MAP: Record<ResponseType, GraphNode> = {
  [ResponseType.Default]: GraphNode.GetModelDefaultResponse,
  [ResponseType.Math]: GraphNode.GetModelMathResponse,
  [ResponseType.Image]: GraphNode.GetModelImageResponse,
}

/**
 * Service interacting with OpenAI's LLM.
 */
@Injectable()
export class LLMService {
  constructor(
    private readonly state: StateService,
    private readonly equationImage: EquationImageService,
  ) {}

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
    .addNode(GraphNode.Tools, this.toolNode)
    // Edges
    .addEdge(GraphNode.Start, GraphNode.CheckResponseType)
    .addEdge(GraphNode.CheckResponseType, GraphNode.TrimMessages)
    .addEdge(GraphNode.TrimMessages, GraphNode.AddTdrSystemPrompt)
    .addEdge(GraphNode.Tools, GraphNode.GetModelDefaultResponse)
    .addEdge(GraphNode.GetModelImageResponse, GraphNode.End)
    .addEdge(GraphNode.GetModelMathResponse, GraphNode.End)
    // Conditional edges
    .addConditionalEdges(
      GraphNode.AddTdrSystemPrompt,
      (state) => RESPONSE_TYPE_GRAPH_NODE_MAP[state.responseType],
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

    const response = await this.getReasoningModel().invoke([
      GET_RESPONSE_TYPE_PROMPT,
      message,
    ])

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

    if (messages?.some((message) => message.id === TDR_SYSTEM_PROMPT_ID)) {
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
    const response = await this.getChatModel().invoke(allMessages)
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
      const extractImageQueriesResponse = await this.getReasoningModel().invoke(
        [EXTRACT_IMAGE_QUERIES_PROMPT, message],
      )

      const imageQueries = ImageQuerySchema.parse(
        JSON.parse(extractImageQueriesResponse.content as string),
      )

      this.logger.log({ queries: imageQueries }, 'Got image queries')

      const dalle = new DallEAPIWrapper()
      const images = await Promise.all(
        imageQueries.map(async ({ title, query }) => {
          const url = await dalle.invoke(query)

          return ImageResponseSchema.parse({
            title,
            url,
          })
        }),
      )

      this.logger.log({ images }, 'Got image URLs')

      const chatResponse = await this.getChatModel().invoke([
        ...messages,
        IMAGE_RESPONSE,
      ])

      return {
        images: images.map((image) => ({
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

    const latexResponse = await this.getReasoningModel().invoke(
      messages
        .filter((message) => message.id !== TDR_SYSTEM_PROMPT_ID)
        .concat(GET_MATH_RESPONSE_PROMPT),
    )

    const latex = latexResponse.content.toString()

    const chatResponse = await this.getChatModel().invoke([
      ...messages,
      GET_CHAT_MATH_RESPONSE,
    ])

    return {
      latex,
      latexParentId: chatResponse.id,
      messages: messages.concat(chatResponse),
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
      const { latex, latexParentId, images, messages } = await this.app.invoke({
        userInput,
        messages: state.graphHistory.at(-1)?.messages ?? [],
      })

      this.state.setState((prev) => ({
        graphHistory: prev.graphHistory.concat({
          images,
          latex,
          latexParentId,
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

      let equationImage = await this.equationImage.getImage(latex)
      if (equationImage) {
        equationImage = equationImage.split(',')[1]
      }

      return {
        equationImage,
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

      console.error('breh', err)

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
