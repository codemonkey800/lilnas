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

const DEV_LOGIN_EVENTS = {
  // dev-login.plugin.ts — the dev-only synthetic-session mint and its
  // rejection path. Logged at warn (not info) so a stray occurrence stands
  // out even though it is expected in local dev.
  devLoginMinted: 'dev-login-minted',
  devLoginRejected: 'dev-login-rejected',
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

const GITHUB_TOKEN_EVENTS = {
  // crypto/github-token-resolution.ts's resolveGithubToken decrypt/parse-
  // failure path — the sibling of IDENTITY_EVENTS' identityDecryptFailed for
  // the GitHub OAuth token store (github_credential). Never logged with
  // err.message/err.stack, same rationale as identityDecryptFailed:
  // coarsened unconditionally to err.name/class only.
  githubTokenDecryptFailed: 'github-token-decrypt-failed',
} as const

const GITHUB_ACCOUNT_HOOK_EVENTS = {
  // auth/github-account-hook.ts's fetchGithubProfile — GET /user failed
  // (network error, non-200, malformed JSON, or an unexpected body shape).
  // Fires at warn since the hook rejects the link in every one of these
  // cases (fail-closed) rather than partially provisioning a credential.
  // Never logged with err.message/err.stack, matching the structured-
  // logging convention's coarsening rule for any path touching token
  // material.
  githubProfileFetchFailed: 'github-profile-fetch-failed',
  // auth/github-account-hook.ts's pre-flight duplicate-link check — the
  // GitHub account being linked already belongs to a different tdr-code
  // user. Fires before any encryption/upsert work; the hook throws a
  // distinct APIError immediately after this log line.
  githubAccountAlreadyLinked: 'github-account-already-linked',
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
  // supervisor.service.ts (U4) — the supervisor's IPC bridge received a
  // `message` on the bot child's channel that failed isNotifyMessage
  // validation (wrong shape, non-array topics, or a malformed topic
  // element). Dropped without publishing; never thrown.
  notifyReceivedMalformed: 'notify-received-malformed',
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
  // use-live-stream.ts (U5) — the BROWSER-side half of the topic contract,
  // distinct from every event above (all server-side). Each subscribed
  // topic is its own named SSE event (addEventListener(topic, ...), not the
  // generic onmessage — see that file's header comment), so the topic is
  // always known from which listener fired and there is no payload to
  // validate. sseSessionExpiryFallback fires the one bounded authenticated
  // request the hook issues after N consecutive onerror events with no
  // intervening onopen/message — see that file's own header comment for why
  // this exists (removing refetchInterval removed the only guaranteed
  // periodic request() that used to trigger api.ts's 401->/login redirect
  // latch).
  sseSessionExpiryFallback: 'sse-session-expiry-fallback',
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

const LOGS_EVENTS = {
  // log-reader.service.ts (U2, tdr-code logs viewer) — readWindow's seek/read
  // failure path for the windowed byte-offset read endpoint.
  logWindowReadFailed: 'log-window-read-failed',
  // log-sources.service.ts (U3, tdr-code logs viewer) — the tab-bootstrap
  // stat loop's non-ENOENT failure path (a missing file is not an error; see
  // that service's own header comment).
  logSourceStatFailed: 'log-source-stat-failed',
  // log-tail.service.ts (Phase 2 U8, append-delta tail push endpoint) — a new
  // connection's watcher successfully attached and the initial backlog was
  // emitted; fires once per subscribe(), mirroring sse.controller.ts's own
  // sseConnected slug for the unrelated /api/stream endpoint.
  logTailStarted: 'log-tail-started',
  // log-tail.service.ts — fs.watch itself failed to attach (e.g. the file
  // does not exist yet and never will during this connection's lifetime) or
  // emitted an 'error' event mid-stream. Distinct from logWindowReadFailed
  // (a one-shot windowed read) since this is a long-lived watcher failing.
  logTailWatchFailed: 'log-tail-watch-failed',
  // log-tail.service.ts — the watched file's inode changed between one
  // debounced change and the next (rotation: renamed + recreated under the
  // same path) and the service successfully reopened the new file and
  // resumed following it from byte 0.
  logTailReopened: 'log-tail-reopened',
  // log-search.service.ts (Phase 2 U9, whole-file streaming scan engine) —
  // a real stat/read error while streaming the file for a search request.
  // Deliberately NOT fired on a clean AbortSignal cancellation (a superseding
  // request aborting this one is an expected, deliberate outcome — see
  // scan()'s own comment on that distinction), only on a genuine I/O failure.
  logSearchFailed: 'log-search-failed',
  // use-log-tail.ts (Phase 2 U13, tail transport hardening) — the BROWSER
  // side's own consecutive-onerror session-expiry fallback for the
  // /api/logs/tail connection specifically. Distinct from SSE_EVENTS'
  // sseSessionExpiryFallback (the unrelated /api/stream connection's own
  // identical mitigation) so an operator filtering Loki can tell which
  // long-lived connection actually triggered the fallback probe, per this
  // module's own cross-plane-desync discipline (see U8's header comment on
  // why the tail never imports from src/sse/*).
  logTailSessionExpiryFallback: 'log-tail-session-expiry-fallback',
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

const FRONTEND_SERVER_EVENTS = {
  // instrumentation.ts's register() (Node runtime only — the file guards on
  // NEXT_RUNTIME) — a boot marker written the first time frontendServerLogger
  // has a real call site, so an operator can pin "the Next server (re)started
  // at T" in the frontend-server.<env>.log stream and correlate a burst of
  // client anomalies with a redeploy or crash.
  frontendServerBooted: 'frontend-server-booted',
  // instrumentation.ts's onRequestError — Next's server-side request-error
  // hook (SSR/RSC render, Route Handlers, Server Actions), the frontend-server
  // mirror of ERROR_BOUNDARY_EVENTS' browser-side unhandled-error. `err` is
  // un-pathable free text (see the structured-logging convention doc's C1
  // rule), so the call site coarsens to err.name + a length-capped message and
  // NEVER logs a raw stack; the request path is query-stripped there too (the
  // frontend-server redact paths are root-anchored to the pino-http req.*
  // shape and would not match this flat `path` field).
  serverRequestError: 'server-request-error',
} as const

const AUTH_BOUNDARY_EVENTS = {
  // api.ts's redirectToLogin() 401 latch — fired once per page life (inside
  // the hasRedirectedForSessionExpiry guard) right before the /login
  // navigation. The browser-plane answer to "why was I bounced to login",
  // complementing middleware.ts's cookie gate and the NestJS auth guard. The
  // only pre-existing 401 signal was the indirect idle-EventSource fallbacks
  // (sseSessionExpiryFallback / logTailSessionExpiryFallback); a failing fetch
  // logged nothing.
  sessionExpiredRedirect: 'session-expired-redirect',
  // login/page.tsx's LoginErrorBanner — the user-EXPERIENCED auth failure (the
  // ?error banner actually rendered), complementing the backend's guild-denied
  // / auth-check-error (which record the server-side decision). session_expired
  // is routine (logged info via logEvent); not_guild_member / oauth_failed are
  // notable (logged warn via logToServer), mirroring the banner's own tone
  // split.
  loginErrorShown: 'login-error-shown',
} as const

const CONNECTION_EVENTS = {
  // use-live-stream.ts (/api/stream EventSource) — the CLIENT half of the
  // long-lived-connection lifecycle, complementing sse.controller.ts's
  // server-side sseConnected/sseClientDisconnected. connected fires once per
  // mount's first onopen; reconnected fires on every subsequent onopen (an
  // EventSource silently auto-reconnects), so a rising reconnected rate is the
  // earliest signal of a flaky proxy/backend — warn so it filters cleanly.
  liveStreamConnected: 'live-stream-connected',
  liveStreamReconnected: 'live-stream-reconnected',
  // use-log-tail.ts (/api/logs/tail EventSource) — the same connect/reconnect
  // pair for the log-tail transport, kept distinct from the live-stream slugs
  // (a different long-lived connection) so an operator can tell which one is
  // churning, mirroring the module's own logTailSessionExpiryFallback vs
  // sseSessionExpiryFallback split.
  logTailConnected: 'log-tail-connected',
  logTailReconnected: 'log-tail-reconnected',
} as const

const CONFIG_FLOW_EVENTS = {
  // config/page.tsx's save mutation onSuccess — the domain-specific audit the
  // generic mutation-success chokepoint can't give: WHICH fields changed
  // (names only, never values — cwd/customSystemPrompt are sensitive) and
  // whether the bot was offline (a deferred-effect save that applies at next
  // bot start rather than immediately).
  configSaved: 'config-saved',
  // config/page.tsx's handleSubmit claudeArgs guard — a client-only validation
  // rejection that returns before any request, so it is otherwise invisible
  // (no query, no mutation, no server call). The template for the whole class
  // of client-side guards that never reach the backend.
  clientValidationRejected: 'client-validation-rejected',
} as const

const WEB_VITALS_EVENTS = {
  // web-vitals-reporter.tsx via next/web-vitals' useReportWebVitals — Core Web
  // Vitals (LCP/INP/CLS/FCP/TTFB) as browser telemetry. The metric name and
  // rating ride in the context object; the slug itself is one value regardless
  // of which metric fired.
  webVital: 'web-vital',
} as const

export const LOG_EVENTS = {
  ...AUTH_EVENTS,
  ...GUILD_EVENTS,
  ...DEV_LOGIN_EVENTS,
  ...SESSION_EVENTS,
  ...IDENTITY_EVENTS,
  ...GITHUB_TOKEN_EVENTS,
  ...GITHUB_ACCOUNT_HOOK_EVENTS,
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
  ...LOGS_EVENTS,
  ...FRONTEND_SERVER_EVENTS,
  ...AUTH_BOUNDARY_EVENTS,
  ...CONNECTION_EVENTS,
  ...CONFIG_FLOW_EVENTS,
  ...WEB_VITALS_EVENTS,
} as const

export type LogEvent = (typeof LOG_EVENTS)[keyof typeof LOG_EVENTS]

// Runtime catalog of every registered slug, for tests and any future
// membership validation. Order follows LOG_EVENTS's own key order (i.e. the
// domain-group spread order above).
export const LOG_EVENT_VALUES: readonly LogEvent[] = Object.values(LOG_EVENTS)
