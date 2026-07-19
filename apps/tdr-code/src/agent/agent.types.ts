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

// Plan-mode support: the ExitPlanMode gate surfaces as a `requestPermission`
// call whose `toolCall.kind === 'switch_mode'` — acp-client.ts intercepts
// that instead of auto-resolving it, and hands the plan text + raw options
// off to whoever presents it (DiscordHandlerService). 'accept' always means
// "bypass permissions" per R (falling back to acceptEdits if the agent
// subprocess didn't offer bypass — see session-manager.service.ts); 'reject'
// means "no, keep planning".
export type PlanApprovalDecision = 'accept' | 'reject'

export interface PlanApprovalRequest {
  channelId: string
  toolCallId: string
  planText: string
  // Whether the 'bypassPermissions' option was actually offered by the agent
  // subprocess for this gate — lets the presenter label the Accept button
  // honestly (it may silently resolve to 'acceptEdits' instead).
  bypassAvailable: boolean
}

// Separate from AcpEventHandlers on purpose: every method on that interface
// is synchronous fire-and-forget (CompositeAcpHandler's whole fan-out design
// depends on that — see its header comment), whereas presenting a plan is
// just "show it" (fire-and-forget, fits fine) but settling it after the
// underlying session/process is gone is a distinct, narrower concern with no
// natural home on the ACP event-fan-out interface.
export interface PlanApprovalPresenter {
  presentPlanApproval(req: PlanApprovalRequest): void
  // Called when a pending approval is settled WITHOUT a button click (Stop
  // pressed, the session torn down for any reason, or a follow-up message
  // superseded it) so the Discord message can reflect that. `outcome` is
  // display-only — the decision of what to actually resolve the ACP request
  // with already happened in SessionManagerService before this fires.
  settlePlanApprovalUi(
    channelId: string,
    toolCallId: string,
    outcome: 'cancelled' | 'superseded' | 'accepted' | 'rejected',
  ): void
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
    // Plan-mode support: only present for a switch_mode (ExitPlanMode) tool
    // call, carrying the plan markdown extracted off its content block (see
    // acp-client.ts's extractPlanText). Additive/non-breaking — implementers
    // that don't care about plan mode can ignore it entirely.
    planText?: string,
  ): void
  // title/rawInput are only present when the ACP bridge resends a corrected
  // value once the tool's real input finishes streaming (e.g. Bash's command
  // text arrives empty on the initial tool_call, then resolved here) —
  // absent means "no change from what onToolCall already recorded".
  onToolCallUpdate(
    channelId: string,
    toolCallId: string,
    status: string,
    diffs: DiffContent[],
    rawInput?: Record<string, unknown>,
    title?: string,
    planText?: string,
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
  // Per-turn GitHub application & enforcement plan — U5: fired by
  // GitTurnContext.begin() whenever a credential axis (SSH or GitHub) did
  // NOT resolve to `configured` for this turn, immediately after the
  // corresponding DB event (git_push_blocked/git_key_decrypt_failed/
  // gh_blocked/github_token_decrypt_failed) is inserted. One generic method
  // (not two axis-specific ones) mirroring onResumeFailed's own
  // single-purpose "a thing went wrong, tell the user" shape — kind/reason
  // are enough for every implementer to build the right user-facing message
  // without needing a second interface method per axis. `reason` is never
  // 'configured' here by construction — this method only fires for the two
  // non-configured axis statuses.
  onGitOperationBlocked(
    channelId: string,
    kind: 'ssh' | 'github',
    reason: 'unconfigured' | 'decrypt_failed',
  ): void
}
