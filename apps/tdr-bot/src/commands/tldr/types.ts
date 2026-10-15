/** Hard cap on messages per summary, channel plus threads. */
export const MAX_WINDOW_MESSAGES = 1000

/** Window size when the requester has no message in the channel. */
export const FALLBACK_MESSAGE_COUNT = 100

/** Discord's page size for messages.fetch. */
export const DISCORD_FETCH_PAGE = 100

/** Max threads under a channel that one summary reads. */
export const MAX_THREADS = 20

/** Longest single message content kept in the transcript. */
export const MAX_MESSAGE_CHARS = 1500

export interface WindowMessage {
  id: string
  /** Channel or thread the message lives in. */
  channelId: string
  /** Thread name; null for messages in the parent channel. */
  threadName: string | null
  authorId: string
  /** Server display name. */
  authorName: string
  isBot: boolean
  createdAt: Date
  /** `message.cleanContent`: mentions already rendered as @name / #channel. */
  content: string
  attachments: string[]
  embedTitles: string[]
  /** Id of the message this one replies to, if any. */
  replyToId: string | null
  url: string
}

export type SinceSource = 'option' | 'lastMessage' | 'fallback'

export interface TldrWindow {
  guildId: string
  channelId: string
  channelName: string
  /** Effective start; the oldest kept message when clipped. */
  since: Date
  sinceSource: SinceSource
  /** Oldest first. */
  messages: WindowMessage[]
  threadCount: number
  clipped: boolean
}

export type TldrErrorCode =
  | 'dm'
  | 'unsupported_channel'
  | 'no_access'
  | 'bot_no_access'
  | 'bad_since'
  | 'future_since'
  | 'empty'
  | 'busy'

export class TldrError extends Error {
  constructor(
    readonly code: TldrErrorCode,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'TldrError'
  }
}
