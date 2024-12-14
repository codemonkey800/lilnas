import { TavilySearchResults } from '@langchain/community/tools/tavily_search'
import { AIMessage, HumanMessage, trimMessages } from '@langchain/core/messages'
import { RunnableConfig } from '@langchain/core/runnables'
import { MessagesAnnotation, StateGraph } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI, DallEAPIWrapper } from '@langchain/openai'
import { Injectable, Logger } from '@nestjs/common'
import dedent from 'dedent'
import { z } from 'zod'

import { StateService } from 'src/state/state.service'
import { getErrorMessage, UnhandledMessageResponseError } from 'src/utils/error'

const MessageResponseSchema = z.object({
  content: z.string().describe('The content of the message'),
  images: z
    .array(
      z.object({
        url: z.string().describe('The URL of the image'),
        title: z.string().describe('The title of the image'),
        description: z.string().describe('The description of the image'),
      }),
    )
    .describe(
      'An array of images to display to the user if the user asks to generate an image using the DALLE tool',
    ),
})

export type MessageResponse = z.infer<typeof MessageResponseSchema>

/**
 * Service interacting with OpenAI's LLM.
 */
@Injectable()
export class LLMService {
  constructor(private readonly state: StateService) {}

  private readonly logger = new Logger(LLMService.name)

  private tools = [new TavilySearchResults(), new DallEAPIWrapper()]

  private toolNode = new ToolNode(this.tools)

  model = new ChatOpenAI({
    model: 'gpt-4',
    temperature: 0,
  }).bindTools(this.tools)

  private workflow = new StateGraph(MessagesAnnotation)
    .addNode('agent', this.callModel.bind(this))
    .addNode('tools', this.toolNode)
    .addEdge('__start__', 'agent') // __start__ is a special name for the entrypoint
    .addConditionalEdges('agent', this.shouldContinue.bind(this))
    .addEdge('tools', 'agent')

  private app = this.workflow.compile()

  private shouldContinue({ messages }: typeof MessagesAnnotation.State) {
    const lastMessage = messages[messages.length - 1] as AIMessage

    // If no tool call, then we stop
    if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
      return '__end__'
    }

    // If the last function call is a "Response" tool, then we stop
    if (lastMessage.tool_calls[0].name === 'Response') {
      return '__end__'
    }

    // Otherwise continue with using the next appropriate tool
    return 'tools'
  }

  private async callModel(
    state: typeof MessagesAnnotation.State,
    config?: RunnableConfig,
  ) {
    const response = await this.model.invoke(state.messages, config)

    // We return a list, because this will get added to the existing list
    return { messages: [response] }
  }

  async sendMessage({
    message,
    user,
  }: {
    message: string
    user: string
  }): Promise<MessageResponse> {
    const content = `${user} said "${message}"`

    this.logger.log({
      info: 'Invoking LLM',
      user,
      message,
      content,
    })

    try {
      const state = this.state.getState()

      const finalState = await this.app.invoke({
        messages: [
          ...(state.messages.length === 0 ? this.state.getPrompt() : []),
          ...state.messages,
          new HumanMessage(content),
        ],
      })

      const nextMessages = finalState.messages
      const trimmedMessages = await trimMessages(nextMessages, {
        maxTokens: 50_000,
        strategy: 'last',
        tokenCounter: new ChatOpenAI({ model: 'gpt-4' }),
        includeSystem: true,
      })
      this.state.setState({ messages: trimmedMessages })

      const response = trimmedMessages.at(-1)?.content

      if (!response) {
        throw new Error('no response from ChatGPT')
      }

      if (typeof response === 'string') {
        try {
          const parsedResponse = MessageResponseSchema.safeParse(
            JSON.parse(response),
          )

          if (parsedResponse.success) {
            return parsedResponse.data
          }
        } catch {
          return {
            images: [],
            content: response,
          }
        }

        return {
          images: [],
          content: response,
        }
      }

      throw new UnhandledMessageResponseError('unexpected response', response)
    } catch (err) {
      this.logger.error({
        error: getErrorMessage(err),

        ...(err instanceof UnhandledMessageResponseError
          ? { response: err.response }
          : {}),
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
