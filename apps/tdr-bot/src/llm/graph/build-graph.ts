import {
  BaseMessage,
  HumanMessage,
  isAIMessage,
  SystemMessage,
} from '@langchain/core/messages'
import {
  BaseCheckpointSaver,
  END,
  START,
  StateGraph,
} from '@langchain/langgraph'
import { Logger } from '@nestjs/common'
import { z } from 'zod'

import { LlmClient } from 'src/llm/client/llm-client'
import {
  DEFAULT_TRIM_TOKENS,
  trimConversation,
} from 'src/llm/conversation/trim'
import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'
import {
  getRequestContext,
  setRequestContextField,
} from 'src/llm/observability/request-context'
import { SkillInput } from 'src/llm/skills/skill.interface'
import { SkillRegistry } from 'src/llm/skills/skill.registry'

import { LlmGraphState, LlmGraphStateType, PendingFollowUp } from './state'

export const FALLBACK_SKILL = 'chat'

/** A pending follow-up older than this is stale and ignored. */
export const FOLLOW_UP_TTL_MS = 5 * 60 * 1000

function liveFollowUp(state: LlmGraphStateType): PendingFollowUp | null {
  const pending = state.pendingFollowUp
  if (!pending) return null
  return Date.now() - pending.createdAt > FOLLOW_UP_TTL_MS ? null : pending
}

export interface BuildGraphDeps {
  registry: SkillRegistry
  llm: LlmClient
  metrics: LlmMetricsService
  trim: typeof trimConversation
  systemPrompt: () => SystemMessage
  checkpointer: BaseCheckpointSaver
}

type RouterSource = 'fastpath' | 'llm' | 'followup'

const logger = new Logger('LlmGraph')

/** The new turn is the last human message; everything before it is history. */
function splitTurn(messages: BaseMessage[]): {
  message: HumanMessage
  history: BaseMessage[]
} {
  const index = messages.findLastIndex(m => HumanMessage.isInstance(m))
  if (index === -1) throw new Error('Graph state has no human message')
  return {
    message: messages[index] as HumanMessage,
    history: messages.slice(0, index),
  }
}

function toSkillInput(
  state: LlmGraphStateType,
  history: BaseMessage[],
  message: HumanMessage,
): SkillInput {
  return {
    message,
    history,
    userId: state.userId,
    channelId: state.channelId,
    guildId: state.guildId,
    discord: state.discord,
  }
}

export function buildGraph(deps: BuildGraphDeps) {
  const { registry, llm, metrics, trim, systemPrompt, checkpointer } = deps

  const classify = async (
    state: LlmGraphStateType,
    message: HumanMessage,
    history: BaseMessage[],
  ): Promise<string> => {
    const skills = registry
      .all()
      .map(s => `- ${s.id}: ${s.description}`)
      .join('\n')
    try {
      const { output } = await llm.call({
        operation: 'router.classify',
        role: 'reasoning',
        schema: z.object({ skill: z.enum(registry.ids() as [string]) }),
        messages: [
          new SystemMessage(
            `Pick the skill that should handle the user's latest message.\n\nSkills:\n${skills}\n\nRespond with the skill id only.`,
          ),
          ...history.slice(-4),
          message,
        ],
      })
      return registry.ids().includes(output.skill)
        ? output.skill
        : FALLBACK_SKILL
    } catch (error) {
      logger.warn(
        { error, channelId: state.channelId },
        'Router classification failed; falling back to chat',
      )
      return FALLBACK_SKILL
    }
  }

  const router = async (state: LlmGraphStateType) => {
    const { message, history } = splitTurn(state.messages)
    const input = toSkillInput(state, history, message)

    let skill: string
    let source: RouterSource
    const pending = liveFollowUp(state)
    if (pending && registry.ids().includes(pending.skill)) {
      skill = pending.skill
      source = 'followup'
    } else {
      const fast = registry.all().find(s => s.match?.(input))
      if (fast) {
        skill = fast.id
        source = 'fastpath'
      } else {
        skill = await classify(state, message, history)
        source = 'llm'
      }
    }

    metrics.routerDecision({ skill, source })
    setRequestContextField('skill', skill)
    return { skill }
  }

  const skillNode = async (state: LlmGraphStateType) => {
    const id = state.skill ?? FALLBACK_SKILL
    const skill = registry.get(id)
    const { message, history } = splitTurn(state.messages)
    const trimmed = await trim([systemPrompt(), ...history], {
      maxTokens: DEFAULT_TRIM_TOKENS,
    })
    const input = toSkillInput(state, trimmed, message)
    const pending = liveFollowUp(state)
    if (pending?.skill === id) {
      input.followUp = pending.data
    }

    const output = await skill.run(input, { llm, logger: new Logger(id) })
    if (output.reroute) {
      return { reroute: true, pendingFollowUp: null }
    }
    const requestId = getRequestContext()?.requestId
    if (requestId) {
      // Lets the transcript join audited LLM calls to the reply they produced.
      for (const message of output.messages) {
        if (isAIMessage(message)) {
          message.additional_kwargs = {
            ...message.additional_kwargs,
            requestId,
          }
        }
      }
    }
    return {
      reroute: false,
      messages: output.messages,
      images: output.images ?? [],
      pendingFollowUp: output.followUp
        ? { skill: id, data: output.followUp.data, createdAt: Date.now() }
        : null,
    }
  }

  const finalize = (state: LlmGraphStateType) => {
    const last = state.messages.at(-1)
    if (
      !last ||
      !isAIMessage(last) ||
      typeof last.content !== 'string' ||
      last.content.trim() === ''
    ) {
      throw new Error(
        `Skill '${state.skill}' did not end with a non-empty AI message`,
      )
    }
    return {}
  }

  return new StateGraph(LlmGraphState)
    .addNode('router', router)
    .addNode('runSkill', skillNode)
    .addNode('finalize', finalize)
    .addEdge(START, 'router')
    .addEdge('router', 'runSkill')
    .addConditionalEdges('runSkill', state =>
      state.reroute ? 'router' : 'finalize',
    )
    .addEdge('finalize', END)
    .compile({ checkpointer })
}
