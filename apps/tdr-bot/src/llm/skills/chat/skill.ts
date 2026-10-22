import { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages'
import { StructuredToolInterface } from '@langchain/core/tools'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable } from '@nestjs/common'

import {
  Skill,
  SkillContext,
  SkillInput,
  SkillOutput,
} from 'src/llm/skills/skill.interface'
import { LlmTools } from 'src/llm/tools/tools'
import { PromptService } from 'src/messages/prompts/prompt.service'

import { CHAT_SKILL_DESCRIPTION } from './prompts'

export const MAX_TOOL_ROUNDS = 5

@Injectable()
export class ChatSkill implements Skill {
  readonly id = 'chat'
  readonly description = CHAT_SKILL_DESCRIPTION

  constructor(
    private readonly prompts: PromptService,
    private readonly tools: LlmTools,
  ) {}

  async run(
    { message, history }: SkillInput,
    { llm, logger }: SkillContext,
  ): Promise<SkillOutput> {
    const tools = this.tools.all
    const produced: BaseMessage[] = []
    // Sent to the model each round but never returned, so it is not stored.
    const styleNote = this.prompts.getStyleNote(history)
    const context = styleNote
      ? [...history, styleNote, message]
      : [...history, message]

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // After the last allowed round, ask for a plain answer without tools.
      const withTools = round < MAX_TOOL_ROUNDS
      logger.log({ round }, 'Getting response from model')
      const { message: response } = await llm.call({
        operation: 'chat.respond',
        role: 'chat',
        messages: [...context, ...produced],
        tools: withTools ? tools : undefined,
        overrides: { timeoutMs: 45000 },
      })
      produced.push(response)

      const toolCalls = withTools ? (response.tool_calls ?? []) : []
      if (toolCalls.length === 0) break

      produced.push(
        ...(await Promise.all(
          toolCalls.map(toolCall => runTool(tools, toolCall, logger)),
        )),
      )
    }

    return { messages: produced }
  }
}

async function runTool(
  tools: StructuredToolInterface[],
  toolCall: NonNullable<AIMessage['tool_calls']>[number],
  logger: SkillContext['logger'],
): Promise<ToolMessage> {
  const toolCallId = toolCall.id ?? toolCall.name
  const tool = tools.find(t => t.name === toolCall.name)
  if (!tool) {
    return new ToolMessage({
      tool_call_id: toolCallId,
      name: toolCall.name,
      status: 'error',
      content: `Unknown tool: ${toolCall.name}`,
    })
  }

  try {
    // Invoked with the whole ToolCall, a tool returns a ToolMessage that
    // already carries the call's id and name.
    const result: ToolMessage = await tool.invoke({
      ...toolCall,
      id: toolCallId,
      type: 'tool_call',
    })
    // Content blocks are stringified so trimming and the transcript only
    // ever see text.
    if (typeof result.content !== 'string') {
      result.content = JSON.stringify(result.content)
    }
    return result
  } catch (err) {
    logger.warn(
      { tool: toolCall.name, error: getErrorMessage(err) },
      'Tool call failed',
    )
    return new ToolMessage({
      tool_call_id: toolCallId,
      name: toolCall.name,
      status: 'error',
      content: `Tool ${toolCall.name} failed: ${getErrorMessage(err)}`,
    })
  }
}
