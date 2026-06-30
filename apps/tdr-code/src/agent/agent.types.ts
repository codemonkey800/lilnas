export type PromptOutcome =
  | { kind: 'completed'; stopReason: string }
  | { kind: 'queued' }
  | { kind: 'no_image_support' }
  | { kind: 'shutting_down' }

export interface DiffContent {
  path: string
  oldText?: string | null
  newText: string
}

export interface ImageAttachment {
  data: string
  mimeType: string
}

export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

// Context passed to onPromptStart so the SQLite writer can persist the
// R6 user-prompt block and FK turns to the right session row without a
// hot-path DB read (Decisions 3 + 4).
export interface PromptStartContext {
  // DB pk of the sessions row for this channel; null when generationId is null
  // (writer skips the write in that case — Decision 4b null-guard).
  sessionRowId: number | null
  prompt: { text: string; images: ImageAttachment[] }
}

export interface AcpEventHandlers {
  onToolCall(
    channelId: string,
    toolCallId: string,
    title: string,
    kind: string,
    status: string,
    diffs: DiffContent[],
    rawInput?: Record<string, unknown>,
  ): void
  onToolCallUpdate(
    channelId: string,
    toolCallId: string,
    status: string,
    diffs: DiffContent[],
    rawInput?: Record<string, unknown>,
  ): void
  onAgentMessageChunk(channelId: string, text: string): void
  onAgentMessageImage(channelId: string, data: string, mimeType: string): void
  // context carries sessionRowId + prompt payload (Decisions 3 + 4).
  // DiscordHandlerService accepts and ignores context — additive, non-breaking.
  onPromptStart(
    channelId: string,
    turnId: number,
    context: PromptStartContext,
  ): void
  onPromptComplete(channelId: string, stopReason: string): void
}
