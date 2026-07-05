import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'

import type { InitializeResponse } from '@agentclientprotocol/sdk'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { markExited, recordSpawn } from 'src/db/claude-process.repo'
import { getConfig } from 'src/db/config.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { insertEvent } from 'src/db/events.repo'
import {
  heartbeatLiveStatus,
  removeLiveStatus,
  upsertLiveStatus,
} from 'src/db/live-status.repo'
import type { EventContext, SessionRow } from 'src/db/schema'
import {
  closeSession,
  getLatestSessionForChannel,
  insertSession,
} from 'src/db/sessions.repo'
import { EnvKeys } from 'src/env'
import { LOG_EVENTS } from 'src/logging/log-events'

import { createAcpClient } from './acp-client'
import { ACP_EVENT_HANDLERS } from './agent.module'
import type {
  AcpEventHandlers,
  ImageAttachment,
  PromptOutcome,
} from './agent.types'
import { errorCode } from './error-code'
import { GitTurnContext } from './git-turn-context'
import { globalGitWriteLock } from './git-write-lock'
import { buildPromptBlocks } from './message-bridge'
import { BASE_SYSTEM_PROMPT } from './system-prompt.constants'

// A rate-limited/hung ACP loadSession() can silently never resolve or reject
// while replaying an arbitrarily large persisted transcript — race it against
// this timeout (same failure mode and remedy as discord-handler.service.ts's
// THREAD_RENAME_TIMEOUT_MS for setName()) so a reactivation attempt always
// settles promptly and falls through to a fresh session instead of wedging
// the channel behind the U8 pending-guard forever.
const LOAD_SESSION_TIMEOUT_MS = 30_000

interface ManagedSession {
  channelId: string
  process: ChildProcess
  connection: ClientSideConnection
  sessionId: string
  // DB sessions.id — null when generationId is null (Decision 4b).
  sessionRowId: number | null
  lastActivity: number
  idleTimer: NodeJS.Timeout
  prompting: boolean
  imageCapable: boolean
  currentTurnId: number
  queue: Array<{ text: string; userId: string; images: ImageAttachment[] }>
  activeUserId: string
  // C1/U8: set synchronously by cancel() during the lock-acquire window so the
  // turn can short-circuit before connection.prompt (Decision #5). Reset at
  // the top of executePrompt's synchronous prologue alongside C3 turnId mint.
  cancelRequested: boolean
}

// U8: One entry per channel with an in-flight getOrCreate attempt (fresh
// create today; a future unit's reactivation will share this same guard).
// `promise` is the single in-flight attempt concurrent callers join instead
// of starting their own; `cancelled` is a flag a future consumer (U4's
// reactivation) checks at its own checkpoints before committing a DB write —
// it is NOT a cancellation mechanism and never aborts anything itself.
interface PendingSession {
  promise: Promise<ManagedSession>
  cancelled: boolean
}

@Injectable()
export class SessionManagerService implements OnApplicationShutdown {
  private readonly sessions = new Map<string, ManagedSession>()
  // U8: per-channel in-flight create/reactivate guard — see PendingSession.
  private readonly pendingSessions = new Map<string, PendingSession>()
  // Mutable — rereadConfig() replaces these at runtime without re-spawning.
  private maxConcurrentSessions: number
  private idleTimeoutSec: number
  private claudeCommand: string
  private claudeCwd: string
  private claudeArgs: string[]
  private customSystemPrompt: string
  // C4: Service-global counter — never resets on session teardown/recreate, so
  // stale turn ids from old sessions cannot match new sessions (see plan Decision #3).
  private turnCounter = 0

  private readonly generationId: number | null

  // Resolved once in the constructor — same for all sessions.
  private readonly scriptsDir: string
  private readonly realGit: string

  // U5: live_status heartbeat — one timer per bot lifetime, cleared by shutdown
  // authority before finalizeGeneration (Decision 8c).
  private liveStatusTimer: NodeJS.Timeout | null = null
  // Set alongside stopLiveStatusHeartbeat() to gate prompt() and
  // ensureLiveStatusHeartbeat() during the shutdown window (Decision 8c).
  private shutdownRequested = false

  // U9: per-turn identity application context (shared across all channels).
  private gitTurnContext: GitTurnContext

  constructor(
    @Inject(ACP_EVENT_HANDLERS) private readonly handlers: AcpEventHandlers,
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {
    const cfg = getConfig(db)
    if (!cfg) {
      // Main must seed the config row before spawning the bot (Decision #1).
      throw new Error(
        '[session-manager] config row missing — main server did not seed before bot start',
      )
    }
    this.claudeCommand = cfg.claudeCommand
    this.claudeCwd = cfg.cwd
    this.claudeArgs = cfg.claudeArgs
    this.idleTimeoutSec = cfg.idleTimeoutSec
    this.maxConcurrentSessions = cfg.maxConcurrentSessions
    this.customSystemPrompt = cfg.customSystemPrompt
    const genIdStr = process.env[EnvKeys.BOT_GENERATION_ID]
    this.generationId = genIdStr ? parseInt(genIdStr, 10) : null

    this.scriptsDir = path.resolve(__dirname, '../../scripts')
    this.realGit = execFileSync('which', ['git'], { encoding: 'utf-8' }).trim()

    this.gitTurnContext = new GitTurnContext({
      db,
      generationId: this.generationId,
    })

    // Boot-time sweep of any orphaned tmpfs key files from a previous crash.
    GitTurnContext.sweep()
  }

  // Called by the command poller when a reread_config command arrives.
  // Replaces the four mutable config fields; existing sessions are unaffected
  // (R3: cwd/command/args → new sessions only; idleTimeout → next reset;
  // maxSessions → next create).
  rereadConfig(): void {
    const cfg = getConfig(this.db)
    if (!cfg) return
    this.claudeCommand = cfg.claudeCommand
    this.claudeCwd = cfg.cwd
    this.claudeArgs = cfg.claudeArgs
    this.idleTimeoutSec = cfg.idleTimeoutSec
    this.maxConcurrentSessions = cfg.maxConcurrentSessions
    this.customSystemPrompt = cfg.customSystemPrompt
    this.logger.info(
      {
        event: LOG_EVENTS.configRereadApplied,
        claudeCommand: this.claudeCommand,
        cwd: this.claudeCwd,
        idleTimeoutSec: this.idleTimeoutSec,
        maxConcurrentSessions: this.maxConcurrentSessions,
        // Logged in full, unredacted — operator-authored config text, not a
        // secret (same posture as the other four fields above).
        customSystemPrompt: this.customSystemPrompt,
      },
      'Config reread applied',
    )
  }

  // Combines the hardcoded base prompt (R4/R5, always applied) with the live
  // operator-editable custom prompt (R3). Custom text is trimmed and, when
  // non-empty, appended after a blank line so it reads as the most-recent —
  // highest-weighted — instruction; when empty/whitespace-only, the result is
  // exactly BASE_SYSTEM_PROMPT with no trailing separator.
  private buildSystemPrompt(): string {
    const custom = this.customSystemPrompt.trim()
    return custom ? `${BASE_SYSTEM_PROMPT}\n\n${custom}` : BASE_SYSTEM_PROMPT
  }

  async prompt(
    channelId: string,
    text: string,
    userId: string,
    images: ImageAttachment[] = [],
  ): Promise<PromptOutcome> {
    this.logger.debug({ channelId, userId }, 'Prompt received')
    if (this.shutdownRequested) return { kind: 'shutting_down' }
    const session = await this.getOrCreate(channelId, userId)
    session.lastActivity = Date.now()
    this.resetIdleTimer(session)

    const usableImages = session.imageCapable ? images : []
    if (images.length > 0 && usableImages.length === 0) {
      this.logger.debug(
        { channelId, dropped: images.length },
        'Dropping images — agent not image-capable',
      )
    }

    if (!text && usableImages.length === 0) {
      // Reclaim process + eviction slot if session was never used (just spawned)
      if (session.currentTurnId === 0 && session.queue.length === 0) {
        this.teardown(channelId, 'teardown')
      }
      return { kind: 'no_image_support' }
    }

    if (session.prompting) {
      session.queue.push({ text, userId, images: usableImages })
      this.syncLiveStatus(session)
      return { kind: 'queued' }
    }

    return this.executePrompt(session, text, userId, usableImages)
  }

  // C2: Await-free ordered guard — all reads + queue clear are synchronous so
  // nothing can mutate prompting/currentTurnId between the checks and the clear.
  cancel(channelId: string, turnId?: number): boolean {
    const logResult = (cancelled: boolean): boolean => {
      this.logger.info(
        { event: LOG_EVENTS.cancelRequested, channelId, turnId, cancelled },
        'Cancel requested',
      )
      return cancelled
    }
    const session = this.sessions.get(channelId)
    if (!session) return logResult(false)
    if (!session.prompting) return logResult(false)
    if (turnId !== undefined && turnId !== session.currentTurnId)
      return logResult(false)
    session.queue = []
    // U8: signal the lock-acquire/identity-application window to abort before
    // connection.prompt (Decision #5). The flag is reset synchronously at the
    // start of the next executePrompt prologue so a drained turn is unaffected.
    session.cancelRequested = true
    this.syncLiveStatus(session)
    void session.connection.cancel({ sessionId: session.sessionId })
    return logResult(true)
  }

  // extraContext: additive tag merged into the closing session_evicted event's
  // free-form context bag (e.g. `{reason: 'context_limit'}` for the
  // ContextUsageService handoff) — optional and backward compatible, every
  // existing call site omits it.
  teardown(
    channelId: string,
    endReason: 'evicted' | 'teardown' | 'interrupted' = 'teardown',
    extraContext?: EventContext,
  ): void {
    const session = this.sessions.get(channelId)
    if (!session) return
    this.logger.info(
      { event: LOG_EVENTS.sessionTeardownRequested, channelId, endReason },
      'Session teardown requested',
    )
    clearTimeout(session.idleTimer)
    // A force-killed process orphans the in-flight connection.prompt — it never
    // settles, so onPromptComplete never fires via the normal path. Signal it
    // explicitly so the handler can stop typing and finalize the turn. The
    // executePrompt error path sets session.prompting = false before calling
    // teardown, ensuring this fires exactly once.
    if (session.prompting) {
      this.handlers.onPromptComplete(channelId, 'aborted')
    }
    this.killProcessTree(session.process)
    this.sessions.delete(channelId)
    // U9: belt-and-suspenders abort — removes tmpfs key and releases lock if
    // this channel holds it. Idempotent with executePrompt's finally.
    this.gitTurnContext.abort(channelId)
    // U7: belt-and-suspenders for a session torn down while merely PARKED on
    // globalGitWriteLock.acquire (not yet holding it) — gitTurnContext.abort
    // above only releases if this channel is the current HOLDER, so a queued
    // waiter entry would otherwise survive teardown and the lock would be
    // briefly granted to this now-dead channel when the real holder releases.
    // The primary fix (idle timer cleared while prompting) should prevent
    // this from ever firing for the idle-eviction path; this covers other
    // teardown callers (e.g. explicit cancellation of a parked session).
    globalGitWriteLock.cancelWaiter(channelId)

    // U2 + U5: best-effort DB bookkeeping — mirror syncLiveStatus try/catch so a
    // transient SQLITE_BUSY inside a setTimeout callback cannot crash the process.
    if (this.generationId != null) {
      try {
        if (session.sessionRowId != null) {
          closeSession(this.db, {
            id: session.sessionRowId,
            endedAt: new Date(),
            endReason,
          })
          insertEvent(this.db, {
            generationId: this.generationId,
            sessionId: session.sessionRowId,
            channelId,
            type: 'session_evicted',
            level: 'info',
            context: { endReason, ...extraContext },
            createdAt: new Date(),
          })
        }
        removeLiveStatus(this.db, channelId, this.generationId)
      } catch (err) {
        this.logger.warn(
          { event: LOG_EVENTS.teardownBookkeepingFailed, err, channelId },
          'Teardown bookkeeping failed',
        )
      }
    }
  }

  isPrompting(channelId: string): boolean {
    return this.sessions.get(channelId)?.prompting ?? false
  }

  onApplicationShutdown(): void {
    for (const channelId of Array.from(this.sessions.keys())) {
      this.teardown(channelId, 'teardown')
    }
    // U9: Shutdown sweep of any remaining tmpfs key files.
    GitTurnContext.sweep()
  }

  // U5: clear the live_status heartbeat timer — called by bot-bootstrap SIGTERM
  // authority BEFORE finalizeGeneration (Decision 8c).
  stopLiveStatusHeartbeat(): void {
    this.shutdownRequested = true
    if (this.liveStatusTimer) {
      clearTimeout(this.liveStatusTimer)
      this.liveStatusTimer = null
    }
  }

  private async executePrompt(
    session: ManagedSession,
    text: string,
    userId: string,
    images: ImageAttachment[] = [],
  ): Promise<PromptOutcome> {
    // C3: Mint turn id at the top of executePrompt, before the await, so each
    // queued drain auto-mints a fresh id for the next turn.
    // U8: Reset cancelRequested here in the same synchronous span as the C3
    // turnId mint so a drained turn's flag is cleared before prompting=true
    // (Decision #5 — a Stop for the previous turn cannot cancel the next turn).
    const turnId = ++this.turnCounter
    session.currentTurnId = turnId
    session.cancelRequested = false
    session.prompting = true
    session.activeUserId = userId
    // U7: a prompting session is by definition not idle — this includes the
    // window where it is merely PARKED on globalGitWriteLock.acquire below,
    // waiting behind another channel's long-running turn. Without this, the
    // idle timer armed by prompt()/resetIdleTimer keeps ticking and can fire
    // teardown('evicted') while this turn is still in flight, orphaning its
    // queued grant in the lock (see cancelWaiter in git-write-lock.ts for the
    // defense-in-depth half of this fix). Re-armed in the finally block below
    // once the turn (including any queued drain) fully settles.
    clearTimeout(session.idleTimer)
    // U5: sync live_status before the await (prompting=true transition).
    this.syncLiveStatus(session)
    this.handlers.onPromptStart(session.channelId, turnId, {
      sessionRowId: session.sessionRowId,
      prompt: { text, images },
    })
    this.logger.info(
      {
        event: LOG_EVENTS.promptDispatched,
        channelId: session.channelId,
        turnId,
        sessionId: session.sessionId,
        sessionRowId: session.sessionRowId,
      },
      'Prompt dispatched',
    )

    // U8: Acquire the global git-write lock AFTER the synchronous prologue
    // (preserves C1's guarantee up to the lock await). The lock spans the entire
    // turn because the agent runs git at arbitrary, undetectable points
    // (Decision #4). Release is unconditionally at the top of the finally block
    // — see the release placement comment below.
    let gitBegun = false
    try {
      this.logger.debug(
        { channelId: session.channelId, turnId },
        'Acquiring git-write lock',
      )
      const gitRelease = await globalGitWriteLock.acquire(session.channelId)
      this.logger.debug(
        { channelId: session.channelId, turnId },
        'Git-write lock acquired',
      )

      // U9: Apply per-turn identity under the lock. This writes .git/config
      // and (for configured users) decrypts the key to a chmod-600 tmpfs file.
      // The gitRelease fn is passed through so gitTurnContext.end() can release
      // the lock first, then remove the tmpfs key (ordering matters — Decision #4).
      await this.gitTurnContext.begin(
        session.channelId,
        session.activeUserId,
        gitRelease,
      )
      gitBegun = true
      this.logger.debug(
        { channelId: session.channelId, turnId },
        'Git identity applied for turn',
      )

      // U8: Single cancelRequested check immediately before connection.prompt —
      // the latest possible point. Narrows the stop-cancel window opened by the
      // lock-acquire await (Decision #5). A cancel that lands in the residual
      // check→prompt tick still relies on the existing ACP cancel tolerance.
      if (session.cancelRequested) {
        this.logger.debug(
          { channelId: session.channelId, turnId },
          'Turn cancelled before prompt dispatch',
        )
        this.handlers.onPromptComplete(session.channelId, 'cancelled')
        return { kind: 'queued' } // treated as a queued-then-cancelled turn
      }

      const result = await session.connection.prompt({
        sessionId: session.sessionId,
        prompt: buildPromptBlocks(text, images),
      })
      this.handlers.onPromptComplete(session.channelId, result.stopReason)
      this.logger.info(
        {
          event: LOG_EVENTS.promptCompleted,
          channelId: session.channelId,
          turnId,
          stopReason: result.stopReason,
        },
        'Prompt completed',
      )
      return { kind: 'completed', stopReason: result.stopReason }
    } catch (err) {
      this.logger.error(
        {
          event: LOG_EVENTS.promptError,
          err,
          channelId: session.channelId,
          turnId,
        },
        'Prompt error — tearing down session',
      )
      this.handlers.onPromptComplete(session.channelId, 'error')
      // Mark no-longer-prompting before teardown so teardown's abort signal
      // fires exactly once (teardown checks prompting to decide whether to signal).
      session.prompting = false
      this.teardown(session.channelId, 'teardown')
      throw err
    } finally {
      // U8/U9: Release the git-write lock and remove the tmpfs key UNCONDITIONALLY
      // at the top of the finally block, BEFORE the sessions.has drain guard.
      // Load-bearing: on the error/teardown path teardown() deletes the session
      // from the map before finally runs, so a release nested inside the drain
      // guard would be skipped → permanent deadlock (Decision #4).
      // gitTurnContext.end() releases the lock first, then removes the key.
      if (gitBegun) {
        this.gitTurnContext.end(session.channelId)
      } else {
        // Lock was acquired but begin() threw before gitBegun=true —
        // belt-and-suspenders release via the lock directly.
        globalGitWriteLock.releaseIfHeldBy(session.channelId)
      }

      session.prompting = false
      // U5: sync live_status after prompting=false (drain transition).
      if (this.sessions.has(session.channelId)) {
        // U7: re-arm the idle timer now that the turn has fully drained —
        // mirrors the prompting=true clearTimeout above. If a queued turn
        // starts immediately below, its recursive executePrompt call clears
        // this again before any real time elapses (a still-queued session is
        // never idle either).
        this.resetIdleTimer(session)
        this.syncLiveStatus(session)
        const next = session.queue.shift()
        if (next) {
          // U5: sync live_status after drain shift.
          this.syncLiveStatus(session)
          this.executePrompt(
            session,
            next.text,
            next.userId,
            next.images,
          ).catch(err => {
            this.logger.error(
              {
                event: LOG_EVENTS.queuedPromptFailed,
                err,
                channelId: session.channelId,
              },
              'Queued prompt failed',
            )
          })
        }
      }
    }
  }

  // U8: Live sessions bypass the pending-guard entirely (existing fast path,
  // unchanged in shape). Otherwise, concurrent callers for the same channel
  // join a single in-flight attempt rather than each starting their own —
  // closes the fresh-create race today, and is the primitive a future unit's
  // seconds-long reactivation window will need to stay safe under R5.
  private async getOrCreate(
    channelId: string,
    userId: string,
  ): Promise<ManagedSession> {
    const existing = this.sessions.get(channelId)
    if (existing) return existing

    const pending = this.pendingSessions.get(channelId)
    if (pending) return pending.promise

    const entry: PendingSession = {
      promise: this.createOrReactivateSession(channelId, userId),
      cancelled: false,
    }
    this.pendingSessions.set(channelId, entry)
    // Clear the pending entry once the attempt settles (success or failure)
    // so a channel is never permanently stuck behind a stale attempt. The
    // derived promise from .finally() is intentionally not returned/awaited
    // by this method — entry.promise (below) is what callers observe, and
    // this cleanup-only chain gets its own .catch() so a rejection here
    // doesn't surface as an unhandled rejection independent of the caller's
    // handling of entry.promise.
    entry.promise
      .finally(() => {
        if (this.pendingSessions.get(channelId) === entry) {
          this.pendingSessions.delete(channelId)
        }
      })
      .catch(() => {
        /* rejection is the caller's concern via entry.promise, not this chain */
      })
    return entry.promise
  }

  // U8: Marks a channel's in-flight pending attempt (if any) as cancelled.
  // No-op if nothing is pending. This does NOT reject or otherwise interfere
  // with the in-flight promise itself — it is a flag for a future consumer
  // (U4's reactivation) to check at its own checkpoints, not a cancellation
  // mechanism that aborts anything today. Fresh createSession does not (and
  // should not) check this flag; only future reactivation logic will.
  cancelPending(channelId: string): void {
    const pending = this.pendingSessions.get(channelId)
    if (!pending) return
    pending.cancelled = true
  }

  // U8: The actual create/reactivate work, wrapped by getOrCreate's guard.
  // U4: branches on the channel's latest DB session row — a resumable
  // linkage (acpSessionId present) attempts reactivation first, falling
  // through to fresh create on ANY failure (capability absent, loadSession
  // rejects, or the pre-insert re-check fails). evictIfNeeded runs exactly
  // once here, hoisted above the branch, since both paths consume a
  // session-map slot.
  private async createOrReactivateSession(
    channelId: string,
    userId: string,
  ): Promise<ManagedSession> {
    this.evictIfNeeded()

    const latestRow = getLatestSessionForChannel(this.db, channelId)
    if (latestRow?.acpSessionId != null) {
      try {
        return await this.reactivateSession(channelId, userId, latestRow)
      } catch (err) {
        // U5: reactivateSession itself already differentiated "silent
        // because /clear happened" from "genuine failure, notice needed" at
        // each of its own throw sites (it knows why it's failing there,
        // without needing to re-inspect DB state after the fact) — see
        // emitResumeFailed and the comments at its two genuine-failure call
        // sites plus the silent re-check branch. Every reactivation failure,
        // genuine or not, still falls through to a plain fresh session here.
        this.logger.warn(
          { event: LOG_EVENTS.reactivationFallback, err, channelId },
          'Session reactivation failed — falling back to fresh session',
        )
      }
    }

    return this.createSession(channelId, userId)
  }

  // U4: Restores a dormant thread's agent memory via ACP loadSession. Spawns
  // a fresh process (spawnAndConnect, shared with createSession), replays
  // the persisted transcript with all session/update notifications
  // suppressed via a per-attempt `replaying` box, then closes the dangling
  // prior row and inserts a new one before un-suppressing immediately ahead
  // of the live turn. Throws on any failure — capability absent, loadSession
  // rejects, or a /clear landing mid-replay — so the caller
  // (createOrReactivateSession) can fall through to a fresh session.
  //
  // Known gap (out of scope for this unit): this service has no Discord
  // awareness (it works purely on opaque channelId strings), so it cannot
  // detect a locked/archived/undeliverable thread before running the
  // reactivated turn. The existing `.catch(() => {})` around every Discord
  // send elsewhere in the app already prevents a crash in that case, but it
  // does not prevent silently consuming a turn (and the git lock) with no
  // visible output on an undeliverable thread. A cross-file fix wasn't
  // scoped here.
  private async reactivateSession(
    channelId: string,
    userId: string,
    latestRow: SessionRow,
  ): Promise<ManagedSession> {
    // Guaranteed non-null by the caller's `latestRow?.acpSessionId != null`
    // check immediately before calling reactivateSession — TypeScript can't
    // see across that boundary, so this is a single well-commented assertion
    // at a call site the caller has already made safe (see
    // type-guards-over-nonnull-assertions convention: that guidance targets
    // DB rows read fresh WITHOUT a preceding check, which isn't the case here).
    const acpSessionId = latestRow.acpSessionId!

    // U3/U4: per-spawn-attempt suppression box, created BEFORE the ACP
    // connection exists — the SDK's receive loop is live from
    // ClientSideConnection construction and can stream setup/replay
    // session/update notifications before any session is registered.
    const box = { replaying: true }

    const { proc, connection, initResult } = await this.spawnAndConnect(
      channelId,
      () => box.replaying,
    )

    const loadSessionCapable =
      initResult.agentCapabilities?.loadSession ?? false
    if (!loadSessionCapable) {
      // U5: genuine failure (not a /clear race) — notify before cleanup so
      // the notice precedes the fresh turn's output (see the re-check branch
      // below for the one path that stays silent instead).
      this.emitResumeFailed(channelId, 'capability_absent')
      this.killProcessTree(proc)
      throw new Error(
        `[session-manager] channel=${channelId}: agent does not advertise loadSession capability`,
      )
    }

    const systemPrompt = this.buildSystemPrompt()
    try {
      // Race against LOAD_SESSION_TIMEOUT_MS — see its comment for why an
      // un-timed-out loadSession is a channel-wedge hazard, not just a slow call.
      await Promise.race([
        connection.loadSession({
          sessionId: acpSessionId,
          cwd: latestRow.cwd,
          mcpServers: [],
          _meta: { systemPrompt: { append: systemPrompt } },
        }),
        this.timeoutReject(LOAD_SESSION_TIMEOUT_MS, 'loadSession timed out'),
      ])
    } catch (err) {
      // U5: genuine failure — same notify-then-cleanup ordering as above.
      this.emitResumeFailed(channelId, errorCode(err))
      this.killProcessTree(proc)
      throw err
    }

    // U8/R14: re-check state immediately before committing — a /clear may
    // have landed mid-replay (nulling acpSessionId) or cancelled this exact
    // pending attempt. this.pendingSessions.get(channelId) is safe to read
    // here: reactivateSession runs INSIDE the promise that IS that pending
    // entry's `.promise`, registered by getOrCreate before
    // createOrReactivateSession was ever called, so the entry is guaranteed
    // to exist for the whole duration of this call.
    const recheck = getLatestSessionForChannel(this.db, channelId)
    const cancelled = this.pendingSessions.get(channelId)?.cancelled ?? false
    if (recheck?.acpSessionId == null || cancelled) {
      // U5: deliberately NO onResumeFailed call and NO resumeFailed event
      // here — this is the expected /clear-mid-replay case (R14), not a
      // genuine failure. A /clear during replay is the user's own action,
      // not something that failed unexpectedly, so it stays silent (the
      // fresh createSession fallback is the only visible effect).
      this.killProcessTree(proc)
      throw new Error(
        `[session-manager] channel=${channelId}: reactivation aborted — cleared during replay`,
      )
    }

    // Close the dangling prior row (mandatory, close-first) before inserting
    // the new one. closeSession is a blind-guarded UPDATE (WHERE ended_at IS
    // NULL) so this is a safe no-op when latestRow was already closed (the
    // common case — idle-eviction/teardown already closed it cleanly); it
    // only does real work for the crash-recovery case (a row left dangling
    // because the process died without clean teardown). 'interrupted'
    // matches this file's existing convention for "process is gone, wasn't
    // a clean teardown" (see proc.on('exit')/proc.on('error') above).
    closeSession(this.db, {
      id: latestRow.id,
      endedAt: new Date(),
      endReason: 'interrupted',
    })

    // Try/catch mirrors createSession's own insert step: a throw here must
    // not orphan the already-spawned (and now successfully resumed) proc —
    // continue with sessionRowId=null (in-memory session only) rather than
    // discarding a working, memory-restored connection over a DB write
    // failure. The prior row above is already closed regardless.
    let sessionRowId: number | null = null
    if (this.generationId != null) {
      try {
        const row = insertSession(this.db, {
          channelId,
          generationId: this.generationId,
          triggeringUserId: userId,
          acpSessionId,
          cwd: latestRow.cwd,
          createdAt: new Date(),
        })
        sessionRowId = row.id
        insertEvent(this.db, {
          generationId: this.generationId,
          sessionId: row.id,
          channelId,
          type: 'session_created',
          level: 'info',
          context: {
            acpSessionId,
            cwd: latestRow.cwd,
            resumed: true,
            // Same audit pair as createSession's session_created event — see
            // its comment for why a length/boolean pair, not the prompt text.
            promptAppendLength: systemPrompt.length,
            hasCustom: this.customSystemPrompt.trim().length > 0,
          },
          createdAt: new Date(),
        })
      } catch (err) {
        this.logger.error(
          { event: LOG_EVENTS.reactivationInsertFailed, err, channelId },
          'Reactivation session-row insert failed',
        )
        sessionRowId = null
      }
    }

    // U4: un-suppress here, immediately before the live turn — NOT on
    // loadSession's resolution. The ACP spec gives no ordering guarantee
    // that all replay notifications land before loadSession's promise
    // resolves, so clearing earlier could leak a trailing replayed event.
    // There is no `await` between this function returning and
    // executePrompt's onPromptStart firing (getOrCreate's synchronous
    // continuation leads straight into prompt()'s executePrompt call), so
    // there is no interleaving window for a stray event here.
    box.replaying = false

    this.logger.info(
      {
        event: LOG_EVENTS.sessionReactivated,
        channelId,
        sessionId: acpSessionId,
        sessionRowId,
      },
      'Session reactivated',
    )

    const managed: ManagedSession = {
      channelId,
      process: proc,
      connection,
      sessionId: acpSessionId,
      sessionRowId,
      lastActivity: Date.now(),
      idleTimer: this.startIdleTimer(channelId),
      prompting: false,
      imageCapable:
        initResult.agentCapabilities?.promptCapabilities?.image ?? false,
      currentTurnId: 0,
      queue: [],
      activeUserId: userId,
      cancelRequested: false,
    }

    this.sessions.set(channelId, managed)

    // U5: upsert live_status immediately and ensure heartbeat is running —
    // same as createSession.
    this.syncLiveStatus(managed)
    this.ensureLiveStatusHeartbeat()

    return managed
  }

  // U5: notify + record a genuine reactivation failure (capability absent or
  // loadSession rejects) — NOT called for the /clear-mid-replay re-check
  // branch, which is expected and stays silent (see that branch's comment).
  // Fires the Discord-visible notice via handlers.onResumeFailed BEFORE the
  // caller's killProcessTree/throw so the notice precedes the fresh turn's
  // output (mirrors reactivateSession's own header-comment ordering
  // rationale). sessionId is omitted — there is no sessions row for a
  // reactivation attempt that never got past this point.
  private emitResumeFailed(channelId: string, reason: string): void {
    this.handlers.onResumeFailed(channelId)
    if (this.generationId != null) {
      // Guarded (unlike a bare call) so a transient DB fault (e.g.
      // SQLITE_BUSY — realistic given the two-process bot/main DB split)
      // degrades to log-only instead of throwing out of this method and
      // skipping the caller's killProcessTree(proc), which would otherwise
      // leak the half-spawned reactivation process (the exact F8 failure U5
      // exists to prevent).
      try {
        insertEvent(this.db, {
          generationId: this.generationId,
          channelId,
          type: 'session_created',
          level: 'warn',
          context: { resumeFailed: true, reason },
          createdAt: new Date(),
        })
      } catch (err) {
        this.logger.warn(
          {
            event: LOG_EVENTS.resumeFailedEventInsertFailed,
            err,
            channelId,
          },
          'emitResumeFailed event insert failed',
        )
      }
    }
  }

  private evictIfNeeded(): void {
    while (this.sessions.size >= this.maxConcurrentSessions) {
      let oldest: ManagedSession | null = null
      for (const session of this.sessions.values()) {
        if (session.prompting) continue
        if (!oldest || session.lastActivity < oldest.lastActivity) {
          oldest = session
        }
      }
      if (!oldest) {
        this.logger.warn(
          {
            event: LOG_EVENTS.sessionsBusy,
            sessionCount: this.sessions.size,
            max: this.maxConcurrentSessions,
          },
          'All agent sessions busy — rejecting new session',
        )
        throw new Error(
          'All agent sessions are busy. Please wait for the current task to finish.',
        )
      }
      this.teardown(oldest.channelId, 'evicted')
    }
  }

  private async createSession(
    channelId: string,
    userId: string,
  ): Promise<ManagedSession> {
    const { proc, connection, initResult } =
      await this.spawnAndConnect(channelId)
    const imageCapable =
      initResult.agentCapabilities?.promptCapabilities?.image ?? false

    const systemPrompt = this.buildSystemPrompt()
    let sessionId: string
    try {
      const result = await connection.newSession({
        cwd: this.claudeCwd,
        mcpServers: [],
        _meta: { systemPrompt: { append: systemPrompt } },
      })
      sessionId = result.sessionId
    } catch (err) {
      this.killProcessTree(proc)
      throw err
    }

    // U2: Insert sessions row AFTER newSession resolves so acp_session_id
    // and cwd land in the initial INSERT (no backfill UPDATE needed).
    // Guard on generationId — FK is NOT NULL (Decision 4b).
    // Try/catch: a throw here must not orphan the already-spawned proc; on
    // failure we fall through with sessionRowId=null (in-memory session only).
    let sessionRowId: number | null = null
    if (this.generationId != null) {
      try {
        const row = insertSession(this.db, {
          channelId,
          generationId: this.generationId,
          triggeringUserId: userId,
          acpSessionId: sessionId,
          cwd: this.claudeCwd,
          createdAt: new Date(),
        })
        sessionRowId = row.id
        insertEvent(this.db, {
          generationId: this.generationId,
          sessionId: row.id,
          channelId,
          type: 'session_created',
          level: 'info',
          context: {
            acpSessionId: sessionId,
            cwd: this.claudeCwd,
            // What was actually sent in _meta.systemPrompt.append — a
            // length/boolean pair rather than the prompt text itself, kept
            // small and durable enough to audit composition on every session.
            promptAppendLength: systemPrompt.length,
            hasCustom: this.customSystemPrompt.trim().length > 0,
          },
          createdAt: new Date(),
        })
      } catch (err) {
        this.logger.error(
          { event: LOG_EVENTS.sessionInsertFailed, err, channelId },
          'Session-row insert failed',
        )
        sessionRowId = null
      }
    }

    this.logger.info(
      { event: LOG_EVENTS.sessionCreated, channelId, sessionId, sessionRowId },
      'Session created',
    )

    const managed: ManagedSession = {
      channelId,
      process: proc,
      connection,
      sessionId,
      sessionRowId,
      lastActivity: Date.now(),
      idleTimer: this.startIdleTimer(channelId),
      prompting: false,
      imageCapable,
      currentTurnId: 0,
      queue: [],
      activeUserId: userId,
      cancelRequested: false,
    }

    this.sessions.set(channelId, managed)

    // U5: upsert live_status immediately and ensure heartbeat is running.
    this.syncLiveStatus(managed)
    this.ensureLiveStatusHeartbeat()

    return managed
  }

  // U4: Shared spawn/wire/connect setup extracted from createSession so
  // reactivateSession can reuse it verbatim — spawn (same env/stdio),
  // recordSpawn, the generic proc.on('error'/'exit') cleanup handlers
  // (channel-keyed and no-op if this channel isn't registered yet, so they
  // give reactivation correct cleanup-on-death semantics for free), building
  // the ndJsonStream, creating the ACP client (with the caller's optional
  // isReplaying predicate), constructing ClientSideConnection, and calling
  // initialize(). Does NOT call newSession or loadSession — callers branch
  // on that afterward. On any failure the process tree is killed and the
  // error rethrown; callers do not need to duplicate that cleanup.
  private async spawnAndConnect(
    channelId: string,
    isReplaying?: () => boolean,
  ): Promise<{
    proc: ChildProcess
    connection: ClientSideConnection
    initResult: InitializeResponse
  }> {
    const proc = spawn(this.claudeCommand, this.claudeArgs, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: this.claudeCwd,
      detached: true,
      env: {
        ...process.env,
        // Prepend scripts dir so our git wrapper intercepts git calls.
        PATH: `${this.scriptsDir}:${process.env.PATH ?? ''}`,
        // Used by the git wrapper to read the per-turn identity dir.
        TDR_CHANNEL_ID: channelId,
        // Real git binary — prevents infinite recursion in the wrapper.
        TDR_REAL_GIT: this.realGit,
      },
    })
    this.logger.debug(
      { channelId, pid: proc.pid, command: this.claudeCommand },
      'Agent process spawned',
    )

    // Record PGID synchronously with no await between spawn() and INSERT
    // so a bot SIGKILLed in this window still has its PGID persisted.
    // better-sqlite3 is synchronous, so this is a plain sequential call.
    if (this.generationId != null && proc.pid != null) {
      recordSpawn(this.db, {
        generationId: this.generationId,
        pgid: proc.pid,
        channelId,
        spawnedAt: new Date(),
      })
    }

    proc.on('error', err => {
      const e = err as NodeJS.ErrnoException
      this.logger.error(
        {
          event: LOG_EVENTS.agentProcessError,
          err,
          channelId,
          pid: proc.pid,
          code: e.code,
          syscall: e.syscall,
        },
        'Agent process error',
      )
      const session = this.sessions.get(channelId)
      if (session?.process === proc) {
        clearTimeout(session.idleTimer)
        this.sessions.delete(channelId)
        // U9: The process died — executePrompt's finally may not have run yet.
        // abort() releases the lock AND removes the tmpfs key (belt-and-suspenders).
        this.gitTurnContext.abort(channelId)
        if (this.generationId != null) {
          try {
            if (session.sessionRowId != null) {
              closeSession(this.db, {
                id: session.sessionRowId,
                endedAt: new Date(),
                endReason: 'interrupted',
              })
            }
            removeLiveStatus(this.db, channelId, this.generationId)
          } catch (dbErr) {
            this.logger.warn(
              {
                event: LOG_EVENTS.procErrorBookkeepingFailed,
                err: dbErr,
                channelId,
              },
              'Proc-error bookkeeping failed',
            )
          }
        }
      }
    })

    proc.on('exit', code => {
      if (code !== 0 && code !== null) {
        this.logger.warn(
          {
            event: LOG_EVENTS.agentProcessExitedNonZero,
            channelId,
            pid: proc.pid,
            code,
          },
          'Agent process exited non-zero',
        )
      } else {
        this.logger.debug(
          { channelId, pid: proc.pid, code },
          'Agent process exited',
        )
      }
      const session = this.sessions.get(channelId)
      if (session?.process === proc) {
        clearTimeout(session.idleTimer)
        this.sessions.delete(channelId)
        // U9: Belt-and-suspenders abort (same as proc.on('error')).
        this.gitTurnContext.abort(channelId)
        if (this.generationId != null) {
          try {
            if (session.sessionRowId != null) {
              closeSession(this.db, {
                id: session.sessionRowId,
                endedAt: new Date(),
                endReason: 'interrupted',
              })
            }
            removeLiveStatus(this.db, channelId, this.generationId)
          } catch (dbErr) {
            this.logger.warn(
              {
                event: LOG_EVENTS.procExitBookkeepingFailed,
                err: dbErr,
                channelId,
              },
              'Proc-exit bookkeeping failed',
            )
          }
        }
      }
      if (this.generationId != null && proc.pid != null) {
        markExited(this.db, {
          pgid: proc.pid,
          generationId: this.generationId,
          exitedAt: new Date(),
        })
      }
    })

    try {
      const stream = ndJsonStream(
        Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
      )

      const client = createAcpClient(channelId, this.handlers, isReplaying)
      const connection = new ClientSideConnection(() => client, stream)

      const initResult = await connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
        clientInfo: {
          name: 'tdr-code',
          title: 'TDR Code Bot',
          version: '0.1.0',
        },
      })

      const imageCapable =
        initResult.agentCapabilities?.promptCapabilities?.image ?? false
      // U4: production observability — the plan flags SDK-version-vs-wrapper-
      // capability as an open runtime question (installed client SDK is
      // 0.15.0; the deployed claude-agent-acp wrapper resolves at runtime
      // via npx). Logging on every spawn (not just reactivation attempts)
      // lets operators confirm the actual capability before the first
      // reactivation is ever attempted.
      this.logger.debug(
        {
          channelId,
          imageCapable,
          loadSessionCapable:
            initResult.agentCapabilities?.loadSession ?? false,
        },
        'Agent initialized',
      )

      return { proc, connection, initResult }
    } catch (err) {
      this.killProcessTree(proc)
      throw err
    }
  }

  private startIdleTimer(channelId: string): NodeJS.Timeout {
    return setTimeout(
      () => this.teardown(channelId, 'evicted'),
      this.idleTimeoutSec * 1000,
    )
  }

  private resetIdleTimer(session: ManagedSession): void {
    clearTimeout(session.idleTimer)
    session.idleTimer = this.startIdleTimer(session.channelId)
  }

  // U5: Single generation-guarded upsert helper (Decision 8).
  // Called at every live_status state-change transition; null-guarded on generationId.
  private syncLiveStatus(session: ManagedSession): void {
    const genId = this.generationId
    if (genId == null) return
    try {
      upsertLiveStatus(this.db, {
        channelId: session.channelId,
        generationId: genId,
        triggeringUserId: session.activeUserId,
        prompting: session.prompting,
        queueDepth: session.queue.length,
        lastActivityAt: new Date(session.lastActivity),
        lastHeartbeatAt: new Date(),
      })
    } catch (err) {
      this.logger.warn(
        {
          event: LOG_EVENTS.syncLiveStatusFailed,
          err,
          channelId: session.channelId,
        },
        'syncLiveStatus failed',
      )
    }
  }

  // U5: Arm the live_status heartbeat (one per bot lifetime, Decision 8c).
  private ensureLiveStatusHeartbeat(): void {
    if (this.shutdownRequested) return
    if (this.liveStatusTimer != null) return
    this.armLiveStatusHeartbeat()
  }

  private armLiveStatusHeartbeat(): void {
    const intervalMs = parseInt(
      process.env[EnvKeys.BOT_HEARTBEAT_MS] ?? '5000',
      10,
    )
    const beat = () => {
      if (this.shutdownRequested) return
      const genId = this.generationId
      if (genId == null) return
      const changes = heartbeatLiveStatus(this.db, genId, new Date())
      if (changes === 0) {
        // No active rows — stop heartbeating. Will re-arm on next syncLiveStatus.
        this.liveStatusTimer = null
        return
      }
      this.liveStatusTimer = setTimeout(beat, intervalMs).unref()
    }
    this.liveStatusTimer = setTimeout(beat, intervalMs).unref()
  }

  private killProcessTree(proc: ChildProcess): void {
    if (!proc.pid) {
      proc.kill()
      return
    }
    try {
      process.kill(-proc.pid, 'SIGTERM')
    } catch {
      try {
        proc.kill('SIGTERM')
      } catch {
        /* already dead */
      }
    }
    setTimeout(() => {
      try {
        process.kill(-proc.pid!, 'SIGKILL')
      } catch {
        /* already dead */
      }
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already dead */
      }
    }, 5000).unref()
  }

  // Rejects after `ms` — used to race against an ACP call that can silently
  // hang forever (never resolve or reject) so callers always get a settled
  // outcome. Unref'd so a pending timeout can never keep the process alive.
  private timeoutReject(ms: number, message: string): Promise<never> {
    return new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error(message)), ms)
      t.unref()
    })
  }
}
