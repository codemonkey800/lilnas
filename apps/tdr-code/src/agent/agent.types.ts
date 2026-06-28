export type PromptOutcome =
  | { kind: 'completed'; stopReason: string }
  | { kind: 'queued' }
  | { kind: 'no_image_support' }

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
  onPromptStart(channelId: string, turnId: number): void
  onPromptComplete(channelId: string, stopReason: string): void
}
