import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import {
  BaseMessage,
  HumanMessage,
  isAIMessage,
} from '@langchain/core/messages'
import {
  Annotation,
  StateGraph,
  StateType,
  UpdateType,
} from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai'
import { Injectable, Logger } from '@nestjs/common'
import dedent from 'dedent'
import { z } from 'zod'

import { MessageResponse } from 'src/schemas/messages'
import { StateService } from 'src/state/state.service'
import { getEquationImage } from 'src/utils/equations'
import { getErrorMessage, UnhandledMessageResponseError } from 'src/utils/error'
import {
  EXTRACT_IMAGE_QUERIES_PROMPT,
  GET_CHAT_MATH_RESPONSE,
  GET_MATH_RESPONSE_PROMPT,
  GET_RESPONSE_TYPE_PROMPT,
  TDR_SYSTEM_PROMPT_ID,
} from 'src/utils/prompts'

import { dateTool } from './tools'
import { GraphNode, ResponseType } from './types'

const ImageQuerySchema = z.array(
  z.object({
    query: z.string(),
    title: z.string(),
  }),
)

const ImageResponseSchema = z.object({
  title: z.string(),
  url: z.string(),
})

type ImageResponse = z.infer<typeof ImageResponseSchema>

const InputStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>,
  userInput: Annotation<string>,
})

const OutputStateAnnotation = Annotation.Root({
  images: Annotation<ImageResponse[]>,
  latex: Annotation<string>,
  messages: Annotation<BaseMessage[]>,
})

const OverallStateAnnotation = Annotation.Root({
  ...InputStateAnnotation.spec,
  ...OutputStateAnnotation.spec,
  message: Annotation<HumanMessage>(),
  prevMessages: Annotation<BaseMessage[]>,
  responseType: Annotation<ResponseType>,
  userInput: Annotation<string>,
})

const RESPONSE_TYPE_GRAPH_NODE_MAP: Record<ResponseType, GraphNode> = {
  [ResponseType.Default]: GraphNode.GetModelDefaultResponse,
  [ResponseType.Math]: GraphNode.GetModelMathResponse,
  [ResponseType.Image]: GraphNode.GetModelImageResponse,
}

const TOKEN_LIMIT = 50_000

/**
 * Service interacting with OpenAI's LLM.
 */
@Injectable()
export class LLMService {
  constructor(private readonly state: StateService) {}

  private readonly logger = new Logger(LLMService.name)

  private tools = [new TavilySearchResults(), dateTool]

  private toolNode = new ToolNode(this.tools)

  private smartModel = new ChatOpenAI({
    model: 'gpt-4o-mini',
    temperature: 0,
  })

  private chatModel = new ChatOpenAI({
    model: 'gpt-4-turbo',
  }).bindTools(this.tools)

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
    .addNode(GraphNode.ShortenResponse, this.shortenResponse.bind(this))
    .addNode(GraphNode.Tools, this.toolNode)
    // Edges
    .addEdge(GraphNode.Start, GraphNode.CheckResponseType)
    .addEdge(GraphNode.CheckResponseType, GraphNode.TrimMessages)
    .addEdge(GraphNode.TrimMessages, GraphNode.AddTdrSystemPrompt)
    .addEdge(GraphNode.Tools, GraphNode.GetModelDefaultResponse)
    .addEdge(GraphNode.GetModelImageResponse, GraphNode.End)
    .addEdge(GraphNode.GetModelMathResponse, GraphNode.End)
    .addEdge(GraphNode.ShortenResponse, GraphNode.End)
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

  private async checkResponseType({
    userInput,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log('Checking response type')

    const message = new HumanMessage(userInput)
    const response = await this.smartModel.invoke([
      GET_RESPONSE_TYPE_PROMPT,
      message,
    ])

    const responseType = response.content as ResponseType

    this.logger.log({ responseType }, 'Got response type')

    return { message, responseType }
  }

  private addTdrSystemPrompt({
    messages,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log('Checking for TDR system prompt')

    if (messages?.some((message) => message.id === TDR_SYSTEM_PROMPT_ID)) {
      this.logger.log('TDR system prompt found')
      return {}
    }

    this.logger.log('Adding TDR system prompt')
    return { messages: [this.state.getPrompt()] }
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

    if (lastMessage.content.length >= 2000) {
      return GraphNode.ShortenResponse
    }

    return GraphNode.End
  }

  private async getModelDefaultResponse({
    message,
    messages,
    prevMessages,
  }: typeof OverallStateAnnotation.State) {
    const allMessages = (prevMessages ?? []).concat(messages)
    const lastMessage = allMessages[messages.length - 1]
    const nextMessages = this.isToolsMessage(lastMessage)
      ? allMessages
      : allMessages.concat(message)

    this.logger.log('Getting response from model')
    const response = await this.chatModel.invoke(nextMessages)
    this.logger.log('Got response from model')

    const messagesWithResponse = nextMessages.concat(response)

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
      const extractImageQueriesResponse = await this.smartModel.invoke([
        EXTRACT_IMAGE_QUERIES_PROMPT,
        message,
      ])

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

      return { images, messages: messages.concat(message) }
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

    // Include last message for context if user asks math question in succession
    const nextMessages = messages
      .slice(messages.length - 2, messages.length - 1)
      .concat(message)

    const latexResponse = await this.smartModel.invoke([
      GET_MATH_RESPONSE_PROMPT,
      ...nextMessages,
    ])

    const latex = latexResponse.content.toString()

    const chatResponse = await this.smartModel.invoke([
      this.state.getPrompt(),
      ...nextMessages,
      message,
      GET_CHAT_MATH_RESPONSE,
    ])

    return { latex, messages: messages.concat([message, chatResponse]) }
  }

  private async shortenResponse({
    messages,
  }: typeof OverallStateAnnotation.State) {
    this.logger.log('Shortening response')
    const lastMessage = messages[messages.length - 1]
    const response = await this.chatModel.invoke(messages.concat(lastMessage))
    this.logger.log({ length: response.content.length }, 'Shortened response')

    return {
      messages: messages.slice(0, -1).concat(response),
    }
  }

  private trimMessages({ messages }: typeof OverallStateAnnotation.State) {
    const lastMessage = messages.at(-1)

    if (
      lastMessage &&
      isAIMessage(lastMessage) &&
      lastMessage.response_metadata.tokenUsage.totalTokens >= TOKEN_LIMIT
    ) {
      this.logger.log('Trimming messages')

      return {
        messages: messages.slice(messages.length - 3, messages.length),
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
      const { latex, images, messages } = await this.app.invoke({
        userInput,
        messages: state.messages,
      })

      this.state.setState(() => ({ messages }))

      const lastMessage = messages.at(-1)

      if (!lastMessage) {
        throw new Error('Did not receive a message')
      }

      let equationImage: string | undefined

      if (latex) {
        this.logger.log({ latex }, 'Getting equation image')

        const equationResponse = await getEquationImage(latex)

        if ('image' in equationResponse) {
          equationImage = equationResponse.image.split(',')[1]

          this.logger.log('Got equation image')
        }
      }

      return {
        images,
        equationImage,
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
