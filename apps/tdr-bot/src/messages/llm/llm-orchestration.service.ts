import {
  BaseMessage,
  HumanMessage,
  isAIMessage,
} from '@langchain/core/messages'
import { BaseCheckpointSaver } from '@langchain/langgraph'
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Mutex } from 'async-mutex'
import { nanoid } from 'nanoid'

import { LlmClient } from 'src/llm/client/llm-client'
import { toMessageName } from 'src/llm/conversation/message-name'
import { trimConversation } from 'src/llm/conversation/trim'
import { buildGraph } from 'src/llm/graph/build-graph'
import { GRAPH_CHECKPOINTER } from 'src/llm/graph/checkpointer'
import { threadIdFor } from 'src/llm/graph/thread-id'
import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'
import { SkillRegistry } from 'src/llm/skills/skill.registry'
import type { DiscordIdentity } from 'src/media-operations/request-handling/types/request-context.type'
import { PromptService } from 'src/messages/prompts/prompt.service'
import { LLMStringContentSchema } from 'src/schemas/llm.schemas'
import { MessageResponse } from 'src/schemas/messages'
import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

/** Skill label for turns that failed before the router picked one. */
const UNKNOWN_SKILL = 'unknown'

/**
 * Owns the compiled skills graph that processes every user message.
 *
 * The graph flow is:
 *   Start → router → runSkill → (reroute → router | finalize) → End
 *
 * The router picks a skill (fast path, pending follow-up, or LLM classifier)
 * and the skill produces the reply messages.
 */
@Injectable()
export class LLMOrchestrationService implements OnModuleInit {
  private readonly logger = new Logger(LLMOrchestrationService.name)

  private app!: ReturnType<typeof buildGraph>

  /** One mutex per thread with turns in flight, so a channel never races. */
  private readonly threadLocks = new Map<
    string,
    { mutex: Mutex; holders: number }
  >()

  constructor(
    @Inject(GRAPH_CHECKPOINTER)
    private readonly checkpointer: BaseCheckpointSaver,
    private readonly promptService: PromptService,
    private readonly registry: SkillRegistry,
    private readonly llm: LlmClient,
    private readonly llmMetrics: LlmMetricsService,
    private readonly metrics: TdrBotMetricsService,
  ) {}

  /** Compiles the skills graph. */
  onModuleInit() {
    this.app = buildGraph({
      registry: this.registry,
      llm: this.llm,
      metrics: this.llmMetrics,
      trim: trimConversation,
      systemPrompt: () => this.promptService.getSystemPrompt(),
      checkpointer: this.checkpointer,
    })

    this.logger.log(
      { skills: this.registry.ids() },
      'LLM orchestration graph compiled',
    )
  }

  /** Runs `fn` once every earlier turn on the same thread has finished. */
  private async withThreadLock<T>(
    threadId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lock = this.threadLocks.get(threadId) ?? {
      mutex: new Mutex(),
      holders: 0,
    }
    lock.holders++
    this.threadLocks.set(threadId, lock)
    try {
      return await lock.mutex.runExclusive(fn)
    } finally {
      if (--lock.holders === 0) {
        this.threadLocks.delete(threadId)
      }
    }
  }

  /** Messages checkpointed for a channel's thread; empty for an unknown channel. */
  async getThreadMessages(channelId: string): Promise<BaseMessage[]> {
    const snapshot = await this.app.getState({
      configurable: { thread_id: threadIdFor({ channelId }) },
    })

    return snapshot.values?.messages ?? []
  }

  /**
   * Public entry point: formats the user input, invokes the compiled
   * LangGraph, records metrics, and returns the final response.
   *
   * @param params.message - Raw message content from the user.
   * @param params.user - Display name of the message author.
   * @param params.userId - Discord user ID (falls back to `user`).
   * @param params.discord - The sender's Discord identity, carried to media
   *   strategies for attribution. Callers without a Discord message (the
   *   graph-test stdin loop) omit it and get one built from `userId`/`user`.
   * @param params.guildId - Discord guild ID for reminder delivery.
   * @param params.channelId - Conversation thread: history is kept per channel.
   * @returns The AI-generated response text and any generated images.
   */
  async sendMessage({
    message,
    user,
    userId,
    discord,
    guildId,
    channelId,
  }: {
    message: string
    user: string
    userId?: string
    discord?: DiscordIdentity
    guildId?: string
    channelId: string
  }): Promise<MessageResponse> {
    const finalUserId = userId || user
    const finalDiscord = discord ?? {
      userId: finalUserId,
      username: user,
    }

    this.logger.debug(
      { user, message, userId: finalUserId },
      'Invoking LLM Orchestration',
    )

    const humanMessage = new HumanMessage({
      id: nanoid(),
      content: message,
      name: toMessageName(user),
      additional_kwargs: { displayName: user },
    })
    const threadId = threadIdFor({ channelId, guildId })
    const startTime = Date.now()

    let skill = UNKNOWN_SKILL
    try {
      const result = await this.withThreadLock(threadId, () =>
        this.app.invoke(
          {
            messages: [humanMessage],
            userId: finalUserId,
            discord: finalDiscord,
            channelId,
            guildId: guildId ?? '',
          },
          { configurable: { thread_id: threadId } },
        ),
      )

      const { images, messages } = result
      skill = result.skill ?? skill
      const durationMs = Date.now() - startTime

      const lastMessage = messages.at(-1)

      if (!lastMessage) {
        throw new Error('Did not receive a message')
      }

      if (isAIMessage(lastMessage)) {
        const usage = lastMessage.usage_metadata

        this.logger.log(usage, 'Token count for last message')

        if (usage) {
          if (usage.input_tokens) {
            this.metrics.llmTokens('prompt_tokens', usage.input_tokens)
          }
          if (usage.output_tokens) {
            this.metrics.llmTokens('completion_tokens', usage.output_tokens)
          }
          if (usage.total_tokens) {
            this.metrics.llmTokens('total_tokens', usage.total_tokens)
          }
        }
      }

      this.metrics.intentDetected(skill)
      this.metrics.llmRequest(skill, 'success')
      this.metrics.observeLlmDuration(skill, durationMs)

      const content = LLMStringContentSchema.parse(lastMessage.content)

      return { images: images ?? [], content }
    } catch (error) {
      const durationMs = Date.now() - startTime
      this.metrics.llmRequest(skill, 'error')
      this.metrics.observeLlmDuration(skill, durationMs)
      throw error
    }
  }
}
