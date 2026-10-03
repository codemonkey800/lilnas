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
import { getTools } from 'src/messages/llm/tools'

import { CHAT_SKILL_DESCRIPTION } from './prompts'

export const MAX_TOOL_ROUNDS = 5

@Injectable()
export class ChatSkill implements Skill {
  readonly id = 'chat'
  readonly description = CHAT_SKILL_DESCRIPTION

  async run(
    { message, history }: SkillInput,
    { llm, logger }: SkillContext,
  ): Promise<SkillOutput> {
    const tools = getTools()
    const produced: BaseMessage[] = [message]

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // After the last allowed round, ask for a plain answer without tools.
      const withTools = round < MAX_TOOL_ROUNDS
      logger.log({ round }, 'Getting response from model')
      const { message: response } = await llm.call({
        operation: 'chat.respond',
        role: 'chat',
        messages: [...history, ...produced],
        tools: withTools ? tools : undefined,
        overrides: { timeoutMs: 45000 },
      })
      produced.push(response)

      const toolCalls = withTools ? (response.tool_calls ?? []) : []
      if (toolCalls.length === 0) break

      for (const toolCall of toolCalls) {
        produced.push(await runTool(tools, toolCall, logger))
      }
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
    const result = await tool.invoke(toolCall.args)
    return new ToolMessage({
      tool_call_id: toolCallId,
      name: toolCall.name,
      content: typeof result === 'string' ? result : JSON.stringify(result),
    })
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
