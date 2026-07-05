// Plane-neutral event registry: Node stdlib + dependency-free local imports
// ONLY. No @nestjs/*, no react/next, no pino. This file is imported from the
// main backend process, the bot child process, Next.js server code, and the
// browser bundle alike, so it must never pull in a framework — mirrors the
// import discipline in src/logging/log-paths.ts.
//
// Shape mirrors src/env.ts's EnvKeys: an `as const` object literal per domain,
// spread-merged into one catalog, with the union type derived by indexed
// access rather than hand-written. Adding a new event means adding one line
// to the right domain group (or a new group) — the derived LogEvent type and
// LOG_EVENT_VALUES catalog update themselves.
//
// Every info/warn/error/fatal log call must carry one of these slugs as its
// `event` field. `debug` calls are exempt (see the structured-logging
// convention doc for the full level-semantics table).

const AUTH_EVENTS = {
  // auth.guard.ts's AUTH_DENIED_EVENT / AUTH_CHECK_ERROR_EVENT constants,
  // folded from snake_case (R8).
  authDenied: 'auth-denied',
  authCheckError: 'auth-check-error',
} as const

const GUILD_EVENTS = {
  // auth.ts's guild-gate outcomes (guild_gate_rejected / _check_error /
  // _sweep), folded from snake_case (R8). These live in auth.ts, not
  // guild-gate.ts — see guildLookupComplete below for the one guild-gate.ts
  // site.
  guildDenied: 'guild-denied',
  guildCheckError: 'guild-check-error',
  guildSweep: 'guild-sweep',
  // guild-gate.ts's only info+ line: a lookup-outcome line, not a rejection.
  guildLookupComplete: 'guild-lookup-complete',
} as const

const SESSION_EVENTS = {
  // session-manager.service.ts's insertSession catch blocks. Both already
  // log { err, channelId }; this is the AE1 acceptance-example site.
  sessionInsertFailed: 'session-insert-failed',
  reactivationInsertFailed: 'reactivation-insert-failed',
  // session-manager.service.ts (U4 sweep) — remaining info/warn/error sites
  // across rereadConfig/cancel/teardown/executePrompt/createOrReactivateSession/
  // reactivateSession/emitResumeFailed/evictIfNeeded/createSession/
  // spawnAndConnect/syncLiveStatus.
  configRereadApplied: 'config-reread-applied',
  cancelRequested: 'cancel-requested',
  sessionTeardownRequested: 'session-teardown-requested',
  teardownBookkeepingFailed: 'teardown-bookkeeping-failed',
  promptDispatched: 'prompt-dispatched',
  promptCompleted: 'prompt-completed',
  promptError: 'prompt-error',
  queuedPromptFailed: 'queued-prompt-failed',
  reactivationFallback: 'reactivation-fallback',
  sessionReactivated: 'session-reactivated',
  resumeFailedEventInsertFailed: 'resume-failed-event-insert-failed',
  sessionsBusy: 'sessions-busy',
  sessionCreated: 'session-created',
  agentProcessError: 'agent-process-error',
  procErrorBookkeepingFailed: 'proc-error-bookkeeping-failed',
  agentProcessExitedNonZero: 'agent-process-exited-non-zero',
  procExitBookkeepingFailed: 'proc-exit-bookkeeping-failed',
  syncLiveStatusFailed: 'sync-live-status-failed',
} as const

const IDENTITY_EVENTS = {
  // crypto/identity-resolution.ts's resolveIdentity decrypt/parse-failure
  // path (C1, U3). Never logged with err.message/err.stack — the sshpk
  // parse-error path can embed decoded private-key bytes in err.message, so
  // this call site coarsens unconditionally to err.name/class only. See
  // identity-resolution.ts's own comment on this log call for the full
  // rationale.
  identityDecryptFailed: 'identity-decrypt-failed',
} as const

const GIT_IDENTITY_EVENTS = {
  // agent/git-turn-context.ts's GitTurnContext.sweep() — boot/shutdown
  // cleanup of orphaned tmpfs key/identity files from a previous crash.
  gitIdentitySweepComplete: 'git-identity-sweep-complete',
  // agent/git-write-lock.ts's cancelWaiter() — a queued waiter was cancelled
  // during teardown before ever acquiring the lock.
  gitWriteLockWaiterCancelled: 'git-write-lock-waiter-cancelled',
} as const

const DISCORD_EVENTS = {
  // composite-acp-handler.ts's handleWriterError.
  writerFault: 'writer-fault',
  // composite-acp-handler.ts's onUsageUpdate: the ContextUsageService
  // fan-out child threw. Not a "writer fault" (ContextUsageService isn't a
  // writer), so it gets its own slug rather than reusing writer-fault.
  contextUsageHandlerFault: 'context-usage-handler-fault',
  // composite-acp-handler.ts's logDiscordError, shared by every
  // AcpEventHandlers method's Discord-side catch block.
  discordFault: 'discord-fault',
  // composite-acp-handler.ts's handleWriterError double-fault path: the
  // transcript_write_failed event INSERT itself also failed (log-only, no
  // retry) — distinct from the outer writer-fault this follows.
  writerFaultEventInsertFailed: 'writer-fault-event-insert-failed',
  // discord/image-attachments.ts's extractImages: an attachment was dropped
  // (over the per-message cap, over the byte-size cap, or fetch/parse
  // failed) before it could be attached to the agent turn.
  imageAttachmentDropped: 'image-attachment-dropped',
  // discord-handler.service.ts's sendAgentImage: an agent-generated OUTBOUND
  // image was dropped for exceeding the byte cap before being sent back to
  // Discord — the mirror-image direction of imageAttachmentDropped above,
  // kept as a separate slug since the two have different field shapes and
  // an operator filtering one direction shouldn't see the other.
  outboundImageDropped: 'outbound-image-dropped',
  // discord-handler.service.ts's onMessage catch-all: sessionManager.prompt
  // rejected with something other than the expected "sessions are busy"
  // message.
  promptFailedUnexpectedly: 'prompt-failed-unexpectedly',
} as const

const COMMAND_POLLER_EVENTS = {
  // command-poller.service.ts's onModuleInit: BOT_GENERATION_ID unset, the
  // poller never arms (mirrors bot-lifecycle's own inactive slug below, but
  // kept distinct since it's a different service/subsystem going inactive).
  commandPollerInactive: 'command-poller-inactive',
  // command-poller.service.ts's poll(): claimPending threw; the poll loop
  // is rearmed and retries next tick regardless.
  commandPollError: 'command-poll-error',
  // command-poller.service.ts's dispatch(): a claimed row failed schema
  // validation — deny-by-default, never dispatched.
  commandValidationAnomaly: 'command-validation-anomaly',
  // command-poller.service.ts's dispatch(): the command_anomaly event
  // INSERT (recording the validation anomaly above) itself failed.
  commandAnomalyEventInsertFailed: 'command-anomaly-event-insert-failed',
  // command-poller.service.ts's dispatch(): a teardown_channel command was
  // successfully dispatched.
  commandTeardownDispatched: 'command-teardown-dispatched',
  // command-poller.service.ts's dispatch(): a reread_config command was
  // successfully dispatched. Distinct from the pre-existing `type:
  // 'reread_config'` field already on this log line (a different,
  // pre-existing field — this event slug is additive, not a replacement).
  commandRereadConfigDispatched: 'command-reread-config-dispatched',
} as const

const BOT_LIFECYCLE_EVENTS = {
  // bot-lifecycle.service.ts's onModuleInit: BOT_GENERATION_ID unset, the
  // service never activates.
  botLifecycleInactive: 'bot-lifecycle-inactive',
  // bot-lifecycle.service.ts's onModuleInit: BOT_GENERATION_ID is set but
  // isn't a parseable integer — fatal, process.exit(1) follows.
  botGenerationIdInvalid: 'bot-generation-id-invalid',
  // bot-lifecycle.service.ts's onModuleInit: no generation row matches
  // BOT_GENERATION_ID — fatal, process.exit(1) follows.
  botGenerationRowNotFound: 'bot-generation-row-not-found',
  // bot-lifecycle.service.ts's onModuleInit: the row is already terminal
  // (endedAt set) — fatal, process.exit(1) follows.
  botGenerationTerminal: 'bot-generation-terminal',
  // bot-lifecycle.service.ts's onModuleInit: the row's recorded pid belongs
  // to a different process — fatal, process.exit(1) follows.
  botGenerationPidMismatch: 'bot-generation-pid-mismatch',
  // bot-lifecycle.service.ts's onModuleInit: successful startup.
  botLifecycleInitialized: 'bot-lifecycle-initialized',
  // bot-lifecycle.service.ts's onReady: a 'ready' gateway event fired after
  // shutdown was already requested — ignored.
  discordReadyDuringShutdown: 'discord-ready-during-shutdown',
  // bot-lifecycle.service.ts's onReady: markRunning affected 0 rows (the
  // supervisor already moved on) — self-signals SIGTERM.
  botGenerationMarkRunningNoop: 'bot-generation-mark-running-noop',
  // bot-lifecycle.service.ts's onReady: markRunning succeeded, heartbeat armed.
  botMarkedRunning: 'bot-marked-running',
  // bot-lifecycle.service.ts's armHeartbeat: a heartbeat tick affected 0
  // rows (supervisor finalized/stopped this generation) — heartbeat stops.
  botHeartbeatStopped: 'bot-heartbeat-stopped',
  // bot-lifecycle.service.ts's finalizeGeneration: graceful-shutdown bookkeeping.
  botGenerationFinalized: 'bot-generation-finalized',
} as const

const SQLITE_WRITER_EVENTS = {
  // sqlite-writer.service.ts's onToolCallUpdate: updateToolCallStatus
  // affected 0 rows — a late or cross-turn update, skipped.
  toolCallUpdateOrphaned: 'tool-call-update-orphaned',
  // sqlite-writer.service.ts's onAgentMessageChunk: no open turn for this
  // channel — the chunk is dropped rather than persisted.
  agentMessageChunkDropped: 'agent-message-chunk-dropped',
  // sqlite-writer.service.ts's onAgentMessageImage: no open turn for this
  // channel — the image is dropped rather than persisted.
  agentMessageImageDropped: 'agent-message-image-dropped',
} as const

const CONTEXT_USAGE_EVENTS = {
  // context-usage.service.ts's onUsageUpdate: the 95% handoff threshold was
  // crossed and an automatic handoff is starting.
  contextHandoffTriggered: 'context-handoff-triggered',
  // context-usage.service.ts's onUsageUpdate: runHandoff's returned promise
  // rejected.
  contextHandoffFailed: 'context-handoff-failed',
  // context-usage.service.ts's runHandoff: the fire-and-forget seed prompt
  // on the new/continued channel rejected after the handoff doc was sent.
  contextHandoffSeedPromptFailed: 'context-handoff-seed-prompt-failed',
  // context-usage.service.ts's resolveContinuationTarget: creating a
  // sibling thread for the handoff failed — falls back to inline.
  contextHandoffThreadCreationFailed: 'context-handoff-thread-creation-failed',
} as const

const CLEAR_COMMAND_EVENTS = {
  // clear-command.service.ts's onClear: /clear invoked.
  clearInvoked: 'clear-invoked',
  // clear-command.service.ts's onClear: one of the teardown steps threw;
  // the error is rethrown after logging.
  clearFailed: 'clear-failed',
  // clear-command.service.ts's onClear: /clear completed successfully.
  clearCompleted: 'clear-completed',
} as const

const STOP_BUTTON_EVENTS = {
  // stop-button.service.ts's onStop: the Stop button was pressed.
  stopButtonPressed: 'stop-button-pressed',
} as const

const SUPERVISOR_EVENTS = {
  // supervisor/reaper.ts's reapGeneration — one pass over a generation's
  // live claude_process PGIDs, killing fresh groups and skipping stale ones.
  reaperPassComplete: 'reaper-pass-complete',
  // supervisor.service.ts (U5 sweep) — onModuleInit/onModuleDestroy,
  // reconcileOnBoot, dispatch/executeEffect's spawn/finalize/reap/
  // resetAttempt effects, and their armed-timer callbacks.
  standaloneMode: 'standalone-mode',
  mainShuttingDown: 'main-shutting-down',
  bootReconcilePidMismatch: 'boot-reconcile-pid-mismatch',
  bootReconcileReapedSurvivor: 'boot-reconcile-reaped-survivor',
  generationInserted: 'generation-inserted',
  spawnMissingGenerationId: 'spawn-missing-generation-id',
  botRestartEventInsertFailed: 'bot-restart-event-insert-failed',
  botSpawned: 'bot-spawned',
  botChildExited: 'bot-child-exited',
  botChildProcessError: 'bot-child-process-error',
  botSpawnFailed: 'bot-spawn-failed',
  botStartTimeout: 'bot-start-timeout',
  botGraceTimeout: 'bot-grace-timeout',
  supervisorGenerationFinalized: 'supervisor-generation-finalized',
  reaperError: 'reaper-error',
  attemptCounterReset: 'attempt-counter-reset',
} as const

const LIFECYCLE_CONTROLLER_EVENTS = {
  // console/lifecycle.controller.ts (U5 sweep) — the admin-triggered
  // bot-restart and channel-teardown POST handlers.
  botRestartRequested: 'bot-restart-requested',
  botRestartRejected: 'bot-restart-rejected',
  botRestartDispatched: 'bot-restart-dispatched',
  channelTeardownRequested: 'channel-teardown-requested',
} as const

const DISCORD_DIRECTORY_EVENTS = {
  // console/discord-directory.service.ts (U5 sweep) — listGuildMembers'
  // two distinct Discord-call failure modes (fetch itself threw vs. Discord
  // responded with a non-2xx status).
  discordDirectoryFetchFailed: 'discord-directory-fetch-failed',
  discordDirectoryApiError: 'discord-directory-api-error',
} as const

const GIT_IDENTITY_SERVICE_EVENTS = {
  // console/git-identity.service.ts (U5 sweep) — DB-backed identity
  // upsert/delete lifecycle. Distinct from GIT_IDENTITY_EVENTS above, which
  // covers agent/git-turn-context.ts's tmpfs sweep — a different file and a
  // different concern (ephemeral runtime files vs. persisted DB rows).
  gitIdentityKeyValidated: 'git-identity-key-validated',
  gitIdentityUpserted: 'git-identity-upserted',
  gitIdentityDeleted: 'git-identity-deleted',
} as const

const CONFIG_SERVICE_EVENTS = {
  // console/config.service.ts (U5 sweep) — updateConfig's persist + the
  // best-effort reread_config command enqueue for a running bot generation.
  configUpdated: 'config-updated',
  rereadConfigEnqueueFailed: 'reread-config-enqueue-failed',
} as const

const RECONCILE_SERVICE_EVENTS = {
  // console/reconcile.service.ts (U5 sweep) — reconcile()'s three distinct
  // JSONL file-read failure sites (stat/read/readFile). Deliberately NOT
  // reusing the frontend RECONCILE_EVENTS slugs below (reconcile-result /
  // reconcile-mismatch), which src/app/lib/reconcile-logging.ts already
  // emits: those describe a different concept — a completed reconciliation's
  // outcome (match vs. mismatch) — not this service's own file-I/O failure
  // paths, which never reach a verdict at all (they return 'cannot-reconcile'
  // before any matched/mismatched comparison happens). Backend-specific
  // slugs keep an operator filtering "reconcile file I/O broke" from also
  // matching a future "reconcile found a content mismatch" telemetry event
  // with an unrelated field shape.
  reconcileStatFailed: 'reconcile-stat-failed',
  reconcileReadFailed: 'reconcile-read-failed',
  reconcileReadFileFailed: 'reconcile-readfile-failed',
} as const

const AUTH_ADMIN_EVENTS = {
  // console/auth-admin.controller.ts (U5 sweep) — the revoke-sessions
  // break-glass route's request/completion pair.
  sessionRevokeRequested: 'session-revoke-requested',
  sessionRevokeCompleted: 'session-revoke-completed',
} as const

const SESSIONS_SERVICE_EVENTS = {
  // console/sessions.service.ts (U5 sweep) — getSessionTranscript's
  // un-narrowable turn_content block guard.
  turnContentBlockDropped: 'turn-content-block-dropped',
} as const

const LIVE_SERVICE_EVENTS = {
  // console/live.service.ts (U5 sweep) — getLive's stale-heartbeat
  // degrade-to-last-known branch.
  liveRowStale: 'live-row-stale',
} as const

const PAGE_EVENTS = {
  // page-view-tracker.tsx: page_view -> page-view.
  pageView: 'page-view',
} as const

const INTERACTION_EVENTS = {
  // click-tracker.tsx: button_click -> button-click.
  buttonClick: 'button-click',
} as const

const QUERY_EVENTS = {
  // providers.tsx's React Query cache chokepoint: query_error -> query-error.
  queryError: 'query-error',
} as const

const MUTATION_EVENTS = {
  // providers.tsx's React Query cache chokepoint.
  mutationError: 'mutation-error',
  mutationSuccess: 'mutation-success',
} as const

const RECONCILE_EVENTS = {
  // reconcile-logging.ts.
  reconcileResult: 'reconcile-result',
  reconcileMismatch: 'reconcile-mismatch',
} as const

const SSE_EVENTS = {
  // sse-hub.service.ts / notify-bus.service.ts (U1). notifyReceived fires
  // when the hub's stream$ subscription observes a signal from the bus (the
  // primary, notify-driven path); sseSignalEmitted fires when the hub
  // actually fans a MessageEvent out to a matching connection (either from
  // that primary path or from the fallback tick below) — kept distinct so
  // an operator can tell "a notify arrived" from "a client was pushed to".
  notifyReceived: 'notify-received',
  sseSignalEmitted: 'sse-signal-emitted',
  // The lazily-started fallback interval (0->1 / 1->0 subscriber
  // transitions) and each tick's outcome.
  sseFallbackIntervalStarted: 'sse-fallback-interval-started',
  sseFallbackIntervalStopped: 'sse-fallback-interval-stopped',
  sseFallbackTick: 'sse-fallback-tick',
  // sse.controller.ts (U2) — the @Sse('stream') endpoint's own connection
  // lifecycle, distinct from the hub-internal events above: sseConnected
  // fires once per subscribe() (a new EventSource handshake); sseClientDisconnected
  // fires once per finalize() teardown (the paired release for that same
  // connection id — see sse.controller.ts's own header comment).
  sseConnected: 'sse-connected',
  sseClientDisconnected: 'sse-client-disconnected',
} as const

const NOTIFY_EMITTER_EVENTS = {
  // notify-emitter.service.ts (U3) — the bot-process half of the notify
  // channel. notifyEmitted fires once per coalesced process.send() (the
  // primary, sub-second push path); notifyEmitSkippedNoIpc fires instead
  // when process.send is undefined (dev-standalone SUPERVISE_BOT=false, or
  // any Jest spec) — this is the guarded-no-op that is the bot side's
  // process-scoping guarantee (mirrors SseModule's own invariant from the
  // opposite process), logged at debug since it is an expected, routine
  // condition rather than an anomaly.
  notifyEmitted: 'notify-emitted',
  notifyEmitSkippedNoIpc: 'notify-emit-skipped-no-ipc',
} as const

const ERROR_BOUNDARY_EVENTS = {
  // error-reporter.tsx mounts a window-level 'error' listener and an
  // 'unhandledrejection' listener; each is a distinct raw-message site that
  // U7 wires to one of these two slugs instead of logging error.message
  // itself as the event.
  unhandledError: 'unhandled-error',
  unhandledRejection: 'unhandled-rejection',
  // error-boundary-logging.ts's logBoundaryError, shared by error.tsx and
  // global-error.tsx.
  errorBoundaryCaught: 'error-boundary-caught',
} as const

export const LOG_EVENTS = {
  ...AUTH_EVENTS,
  ...GUILD_EVENTS,
  ...SESSION_EVENTS,
  ...IDENTITY_EVENTS,
  ...GIT_IDENTITY_EVENTS,
  ...DISCORD_EVENTS,
  ...COMMAND_POLLER_EVENTS,
  ...BOT_LIFECYCLE_EVENTS,
  ...SQLITE_WRITER_EVENTS,
  ...CONTEXT_USAGE_EVENTS,
  ...CLEAR_COMMAND_EVENTS,
  ...STOP_BUTTON_EVENTS,
  ...SUPERVISOR_EVENTS,
  ...LIFECYCLE_CONTROLLER_EVENTS,
  ...DISCORD_DIRECTORY_EVENTS,
  ...GIT_IDENTITY_SERVICE_EVENTS,
  ...CONFIG_SERVICE_EVENTS,
  ...RECONCILE_SERVICE_EVENTS,
  ...AUTH_ADMIN_EVENTS,
  ...SESSIONS_SERVICE_EVENTS,
  ...LIVE_SERVICE_EVENTS,
  ...PAGE_EVENTS,
  ...INTERACTION_EVENTS,
  ...QUERY_EVENTS,
  ...MUTATION_EVENTS,
  ...RECONCILE_EVENTS,
  ...SSE_EVENTS,
  ...NOTIFY_EMITTER_EVENTS,
  ...ERROR_BOUNDARY_EVENTS,
} as const

export type LogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS]

// Runtime catalog of every registered slug, for tests and any future
// membership validation. Order follows LOG_EVENTS's own key order (i.e. the
// domain-group spread order above).
export const LOG_EVENT_VALUES: readonly LogEvent[] = Object.values(LOG_EVENTS)
