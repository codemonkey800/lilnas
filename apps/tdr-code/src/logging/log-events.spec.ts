import { LOG_EVENT_VALUES, LogEvent } from 'src/logging/log-events'

describe('LOG_EVENT_VALUES', () => {
  it('every slug is kebab-case', () => {
    const kebabPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/
    for (const value of LOG_EVENT_VALUES) {
      expect(value).toMatch(kebabPattern)
    }
  })

  it('has no duplicate slugs across domain groups', () => {
    expect(new Set(LOG_EVENT_VALUES).size).toBe(LOG_EVENT_VALUES.length)
  })

  it('contains every already-known seeded slug (R8 fold-in)', () => {
    const seeded = [
      // auth.guard.ts
      'auth-denied',
      'auth-check-error',
      // auth.ts guild-gate outcomes
      'guild-denied',
      'guild-check-error',
      'guild-sweep',
      // guild-gate.ts
      'guild-lookup-complete',
      // session-manager.service.ts (AE1)
      'session-insert-failed',
      'reactivation-insert-failed',
      // session-manager.service.ts (U4 sweep)
      'config-reread-applied',
      'cancel-requested',
      'session-teardown-requested',
      'teardown-bookkeeping-failed',
      'prompt-dispatched',
      'prompt-completed',
      'prompt-error',
      'queued-prompt-failed',
      'reactivation-fallback',
      'session-reactivated',
      'resume-failed-event-insert-failed',
      'sessions-busy',
      'session-created',
      'agent-process-error',
      'proc-error-bookkeeping-failed',
      'agent-process-exited-non-zero',
      'proc-exit-bookkeeping-failed',
      'sync-live-status-failed',
      // composite-acp-handler.ts (U4)
      'writer-fault',
      'context-usage-handler-fault',
      'discord-fault',
      'writer-fault-event-insert-failed',
      // command-poller.service.ts (U4)
      'command-poller-inactive',
      'command-poll-error',
      'command-validation-anomaly',
      'command-anomaly-event-insert-failed',
      'command-teardown-dispatched',
      'command-reread-config-dispatched',
      // bot-lifecycle.service.ts (U4)
      'bot-lifecycle-inactive',
      'bot-generation-id-invalid',
      'bot-generation-row-not-found',
      'bot-generation-terminal',
      'bot-generation-pid-mismatch',
      'bot-lifecycle-initialized',
      'discord-ready-during-shutdown',
      'bot-generation-mark-running-noop',
      'bot-marked-running',
      'bot-heartbeat-stopped',
      'bot-generation-finalized',
      // sqlite-writer.service.ts (U4)
      'tool-call-update-orphaned',
      'agent-message-chunk-dropped',
      'agent-message-image-dropped',
      // context-usage.service.ts (U4)
      'context-handoff-triggered',
      'context-handoff-failed',
      'context-handoff-seed-prompt-failed',
      'context-handoff-thread-creation-failed',
      // discord-handler.service.ts (U4)
      'outbound-image-dropped',
      'prompt-failed-unexpectedly',
      // clear-command.service.ts (U4)
      'clear-invoked',
      'clear-failed',
      'clear-completed',
      // stop-button.service.ts (U4)
      'stop-button-pressed',
      // image-attachments.ts (U3)
      'image-attachment-dropped',
      // identity-resolution.ts (U3, C1 fix)
      'identity-decrypt-failed',
      // git-turn-context.ts (U3)
      'git-identity-sweep-complete',
      // git-write-lock.ts (U3)
      'git-write-lock-waiter-cancelled',
      // reaper.ts (U3)
      'reaper-pass-complete',
      // supervisor.service.ts (U5)
      'standalone-mode',
      'main-shutting-down',
      'boot-reconcile-pid-mismatch',
      'boot-reconcile-reaped-survivor',
      'generation-inserted',
      'spawn-missing-generation-id',
      'bot-restart-event-insert-failed',
      'bot-spawned',
      'bot-child-exited',
      'bot-child-process-error',
      'bot-spawn-failed',
      'bot-start-timeout',
      'bot-grace-timeout',
      'supervisor-generation-finalized',
      'reaper-error',
      'attempt-counter-reset',
      // lifecycle.controller.ts (U5)
      'bot-restart-requested',
      'bot-restart-rejected',
      'bot-restart-dispatched',
      'channel-teardown-requested',
      // discord-directory.service.ts (U5)
      'discord-directory-fetch-failed',
      'discord-directory-api-error',
      // git-identity.service.ts (U5)
      'git-identity-key-validated',
      'git-identity-upserted',
      'git-identity-deleted',
      // config.service.ts (U5)
      'config-updated',
      'reread-config-enqueue-failed',
      // reconcile.service.ts (U5)
      'reconcile-stat-failed',
      'reconcile-read-failed',
      'reconcile-readfile-failed',
      // auth-admin.controller.ts (U5)
      'session-revoke-requested',
      'session-revoke-completed',
      // sessions.service.ts (U5)
      'turn-content-block-dropped',
      // live.service.ts (U5)
      'live-row-stale',
      // frontend kebab conversions
      'page-view',
      'button-click',
      'query-error',
      'mutation-error',
      'mutation-success',
      'reconcile-result',
      'reconcile-mismatch',
    ]

    for (const slug of seeded) {
      expect(LOG_EVENT_VALUES).toContain(slug)
    }
  })
})

describe('LogEvent (compile-time)', () => {
  it('accepts a known registered slug', () => {
    const event: LogEvent = 'auth-denied'
    expect(LOG_EVENT_VALUES).toContain(event)
  })

  it('rejects an unregistered slug at compile time', () => {
    // @ts-expect-error - 'totally-bogus-event' is not a registered LogEvent
    const event: LogEvent = 'totally-bogus-event'
    // Referenced only so the unused-var lint rule doesn't also flag this
    // deliberately-invalid assignment.
    expect(typeof event).toBe('string')
  })
})
