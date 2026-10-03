import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { Logger } from '@nestjs/common'

import { LlmClient } from 'src/llm/client/llm-client'
import type { DiscordIdentity } from 'src/media-operations/request-handling/types/request-context.type'
import type { ImageResponse } from 'src/schemas/graph'

export interface SkillInput {
  message: HumanMessage
  /** Trimmed conversation before `message`, led by the system prompt. */
  history: BaseMessage[]
  userId: string
  channelId: string
  guildId: string
  discord: DiscordIdentity
  /** Set when the skill asked for the previous turn's follow-up. */
  followUp?: unknown
}

export interface SkillOutput {
  messages: BaseMessage[]
  images?: ImageResponse[]
  /**
   * Set: the next message in this channel routes back to this skill with
   * `followUp.data`. Null: clear any pending follow-up.
   */
  followUp?: { data: unknown } | null
  /**
   * The skill declined the message (e.g. the user changed topic mid
   * follow-up): the graph re-runs routing on the same message and discards
   * this output's `messages`.
   */
  reroute?: boolean
}

export interface SkillContext {
  llm: LlmClient
  logger: Logger
}

export interface Skill {
  readonly id: string
  /** Shown to the router LLM when choosing a skill. */
  readonly description: string
  /** Deterministic fast path; checked before the router LLM. */
  match?(input: SkillInput): boolean
  run(input: SkillInput, ctx: SkillContext): Promise<SkillOutput>
}

/** Nest multi-provider token collecting every {@link Skill}. */
export const SKILLS = Symbol('SKILLS')
