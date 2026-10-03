import {
  MessagesValue,
  StateSchema,
  UntrackedValue,
} from '@langchain/langgraph'
import { z } from 'zod'

import type { DiscordIdentity } from 'src/media-operations/request-handling/types/request-context.type'
import type { ImageResponse } from 'src/schemas/graph'

export interface PendingFollowUp {
  skill: string
  data: unknown
  /** Epoch ms when the skill wrote this follow-up. */
  createdAt: number
}

/**
 * Graph state. `messages` and `pendingFollowUps` are checkpointed per thread;
 * the rest is per-turn input or scratch, so it stays out of checkpoints.
 *
 * Follow-ups are keyed by the Discord user who started them: a thread is a
 * whole channel, but "the first one" only answers the person who was asked.
 */
export const LlmGraphState = new StateSchema({
  messages: MessagesValue,
  images: new UntrackedValue(z.custom<ImageResponse[]>()),
  userId: new UntrackedValue(z.string()),
  channelId: new UntrackedValue(z.string()),
  guildId: new UntrackedValue(z.string()),
  discord: new UntrackedValue(z.custom<DiscordIdentity>()),
  skill: new UntrackedValue(z.custom<string | undefined>()),
  reroute: new UntrackedValue(z.custom<boolean | undefined>()),
  pendingFollowUps: z
    .custom<Record<string, PendingFollowUp>>()
    .default(() => ({})),
})

export type LlmGraphStateType = typeof LlmGraphState.State
