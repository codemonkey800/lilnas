import { type ChildProcess, spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'

import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'

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
import { closeSession, insertSession } from 'src/db/sessions.repo'
import { EnvKeys } from 'src/env'

import { createAcpClient } from './acp-client'
import { ACP_EVENT_HANDLERS } from './agent.module'
import type {
  AcpEventHandlers,
  ImageAttachment,
  PromptOutcome,
} from './agent.types'
import { GitTurnContext } from './git-turn-context'
import { globalGitWriteLock } from './git-write-lock'
import { buildPromptBlocks } from './message-bridge'

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

@Injectable()
export class SessionManagerService implements OnApplicationShutdown {
  private readonly sessions = new Map<string, ManagedSession>()
  // Mutable — rereadConfig() replaces these at runtime without re-spawning.
  private maxConcurrentSessions: number
  private idleTimeoutSec: number
  private claudeCommand: string
  private claudeCwd: string
  private claudeArgs: string[]
  // C4: Service-global counter — never resets on session teardown/recreate, so
  // stale turn ids from old sessions cannot match new sessions (see plan Decision #3).
  private turnCounter = 0

  private readonly generationId: number | null

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
    const genIdStr = process.env[EnvKeys.BOT_GENERATION_ID]
    this.generationId = genIdStr ? parseInt(genIdStr, 10) : null

    this.gitTurnContext = new GitTurnContext({
      db,
      generationId: this.generationId,
      cwd: this.claudeCwd,
      handlers,
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
  }

  async prompt(
    channelId: string,
    text: string,
    userId: string,
    images: ImageAttachment[] = [],
  ): Promise<PromptOutcome> {
    if (this.shutdownRequested) return { kind: 'shutting_down' }
    const session = await this.getOrCreate(channelId, userId)
    session.lastActivity = Date.now()
    this.resetIdleTimer(session)

    const usableImages = session.imageCapable ? images : []
    if (images.length > 0 && usableImages.length === 0) {
      console.log(
        `[session-manager] channel=${channelId}: dropping ${images.length} image(s) — agent not image-capable`,
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
    const session = this.sessions.get(channelId)
    if (!session) return false
    if (!session.prompting) return false
    if (turnId !== undefined && turnId !== session.currentTurnId) return false
    session.queue = []
    // U8: signal the lock-acquire/identity-application window to abort before
    // connection.prompt (Decision #5). The flag is reset synchronously at the
    // start of the next executePrompt prologue so a drained turn is unaffected.
    session.cancelRequested = true
    this.syncLiveStatus(session)
    void session.connection.cancel({ sessionId: session.sessionId })
    return true
  }

  teardown(
    channelId: string,
    endReason: 'evicted' | 'teardown' | 'interrupted' = 'teardown',
  ): void {
    const session = this.sessions.get(channelId)
    if (!session) return
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
            context: { endReason },
            createdAt: new Date(),
          })
        }
        removeLiveStatus(this.db, channelId, this.generationId)
      } catch (err) {
        console.warn(
          `[session-manager] teardown bookkeeping failed channel=${channelId}:`,
          err instanceof Error ? err.message : String(err),
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
    // U5: sync live_status before the await (prompting=true transition).
    this.syncLiveStatus(session)
    this.handlers.onPromptStart(session.channelId, turnId, {
      sessionRowId: session.sessionRowId,
      prompt: { text, images },
    })

    // U8: Acquire the global git-write lock AFTER the synchronous prologue
    // (preserves C1's guarantee up to the lock await). The lock spans the entire
    // turn because the agent runs git at arbitrary, undetectable points
    // (Decision #4). Release is unconditionally at the top of the finally block
    // — see the release placement comment below.
    let gitBegun = false
    try {
      const gitRelease = await globalGitWriteLock.acquire(session.channelId)

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

      // U8: Single cancelRequested check immediately before connection.prompt —
      // the latest possible point. Narrows the stop-cancel window opened by the
      // lock-acquire await (Decision #5). A cancel that lands in the residual
      // check→prompt tick still relies on the existing ACP cancel tolerance.
      if (session.cancelRequested) {
        this.handlers.onPromptComplete(session.channelId, 'cancelled')
        return { kind: 'queued' } // treated as a queued-then-cancelled turn
      }

      const result = await session.connection.prompt({
        sessionId: session.sessionId,
        prompt: buildPromptBlocks(text, images),
      })
      this.handlers.onPromptComplete(session.channelId, result.stopReason)
      return { kind: 'completed', stopReason: result.stopReason }
    } catch (err) {
      console.error(
        `Prompt error for channel ${session.channelId}, tearing down session:`,
        err,
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
            console.error(
              `Queued prompt failed for channel ${session.channelId}:`,
              err,
            )
          })
        }
      }
    }
  }

  private async getOrCreate(
    channelId: string,
    userId: string,
  ): Promise<ManagedSession> {
    const existing = this.sessions.get(channelId)
    if (existing) return existing

    this.evictIfNeeded()

    return this.createSession(channelId, userId)
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
    const proc = spawn(this.claudeCommand, this.claudeArgs, {
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: this.claudeCwd,
      detached: true,
    })

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
      console.error(
        `Agent process error for channel ${channelId}: ${e.message} ` +
          `(code=${e.code ?? '?'} syscall=${e.syscall ?? '?'})`,
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
            console.warn(
              `[session-manager] proc-error bookkeeping failed channel=${channelId}:`,
              dbErr instanceof Error ? dbErr.message : String(dbErr),
            )
          }
        }
      }
    })

    proc.on('exit', code => {
      const session = this.sessions.get(channelId)
      if (session?.process === proc) {
        clearTimeout(session.idleTimer)
        this.sessions.delete(channelId)
        // U9: Belt-and-suspenders abort (same as proc.on('error')).
        this.gitTurnContext.abort(channelId)
        if (code !== 0 && code !== null) {
          console.warn(
            `Agent process for channel ${channelId} exited with code ${code}`,
          )
        }
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
            console.warn(
              `[session-manager] proc-exit bookkeeping failed channel=${channelId}:`,
              dbErr instanceof Error ? dbErr.message : String(dbErr),
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

    let connection: ClientSideConnection
    let sessionId: string
    let imageCapable = false
    try {
      const stream = ndJsonStream(
        Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
      )

      const client = createAcpClient(channelId, this.handlers)
      connection = new ClientSideConnection(() => client, stream)

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
      imageCapable =
        initResult.agentCapabilities?.promptCapabilities?.image ?? false
      console.log(
        `[session-manager] channel=${channelId}: imageCapable=${imageCapable}`,
      )

      const result = await connection.newSession({
        cwd: this.claudeCwd,
        mcpServers: [],
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
          context: { acpSessionId: sessionId, cwd: this.claudeCwd },
          createdAt: new Date(),
        })
      } catch (err) {
        console.error(
          `[session-manager] session-row insert failed channel=${channelId}:`,
          err instanceof Error ? err.message : String(err),
        )
        sessionRowId = null
      }
    }

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
      console.warn(
        `[session-manager] syncLiveStatus failed channel=${session.channelId}:`,
        err instanceof Error ? err.message : String(err),
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
}
