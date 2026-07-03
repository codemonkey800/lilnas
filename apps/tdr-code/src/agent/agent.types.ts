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
  // Fired for the ACP `session_info_update` notification when the agent reports
  // a real, non-empty title. Callers never receive null/undefined/'' here — the
  // dispatcher (acp-client.ts) filters those out before invoking this handler.
  onSessionInfoUpdate(channelId: string, title: string): void
  // U5: fired when a reactivation attempt fails for a genuine reason (not a
  // /clear racing mid-replay) so the UI layer can notify the user before the
  // fresh turn's output arrives.
  onResumeFailed(channelId: string): void
  // Fired for the ACP `usage_update` notification. used/size are forwarded
  // verbatim from the wire payload (tokens currently in context / total
  // context window size) — no filtering or validation applied by the
  // dispatcher (acp-client.ts), including no guarantee that size > 0.
  onUsageUpdate(channelId: string, used: number, size: number): void
}
