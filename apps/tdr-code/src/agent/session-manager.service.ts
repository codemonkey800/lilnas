import { type ChildProcess, spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'

import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import { env } from '@lilnas/utils/env'
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'

import { markExited, recordSpawn } from 'src/db/claude-process.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { EnvKeys } from 'src/env'

import { createAcpClient } from './acp-client'
import { ACP_EVENT_HANDLERS } from './agent.module'
import type {
  AcpEventHandlers,
  ImageAttachment,
  PromptOutcome,
} from './agent.types'
import { buildPromptBlocks } from './message-bridge'

interface ManagedSession {
  channelId: string
  process: ChildProcess
  connection: ClientSideConnection
  sessionId: string
  lastActivity: number
  idleTimer: NodeJS.Timeout
  prompting: boolean
  imageCapable: boolean
  currentTurnId: number
  queue: Array<{ text: string; userId: string; images: ImageAttachment[] }>
  activeUserId: string
}

@Injectable()
export class SessionManagerService implements OnApplicationShutdown {
  private readonly sessions = new Map<string, ManagedSession>()
  private readonly maxConcurrentSessions: number
  private readonly idleTimeoutSec: number
  private readonly claudeCommand: string
  private readonly claudeCwd: string
  // C4: Service-global counter — never resets on session teardown/recreate, so
  // stale turn ids from old sessions cannot match new sessions (see plan Decision #3).
  private turnCounter = 0

  private readonly generationId: number | null

  constructor(
    @Inject(ACP_EVENT_HANDLERS) private readonly handlers: AcpEventHandlers,
    @Inject(DB) private readonly db: Db,
  ) {
    this.claudeCommand = env(EnvKeys.CLAUDE_COMMAND, 'claude')
    this.claudeCwd = env(EnvKeys.CLAUDE_CWD)
    this.idleTimeoutSec = parseInt(
      env(EnvKeys.AGENT_IDLE_TIMEOUT_SECONDS, '300'),
      10,
    )
    this.maxConcurrentSessions = parseInt(
      env(EnvKeys.AGENT_MAX_SESSIONS, '5'),
      10,
    )
    const genIdStr = process.env[EnvKeys.BOT_GENERATION_ID]
    this.generationId = genIdStr ? parseInt(genIdStr, 10) : null
  }

  async prompt(
    channelId: string,
    text: string,
    userId: string,
    images: ImageAttachment[] = [],
  ): Promise<PromptOutcome> {
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
        this.teardown(channelId)
      }
      return { kind: 'no_image_support' }
    }

    if (session.prompting) {
      session.queue.push({ text, userId, images: usableImages })
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
    void session.connection.cancel({ sessionId: session.sessionId })
    return true
  }

  teardown(channelId: string): void {
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
  }

  isPrompting(channelId: string): boolean {
    return this.sessions.get(channelId)?.prompting ?? false
  }

  onApplicationShutdown(): void {
    for (const channelId of Array.from(this.sessions.keys())) {
      this.teardown(channelId)
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
    const turnId = ++this.turnCounter
    session.currentTurnId = turnId
    session.prompting = true
    session.activeUserId = userId
    this.handlers.onPromptStart(session.channelId, turnId)
    // C1: Do not add any `await` between here and the finally-drain.
    // Stop-cancel race safety depends on this synchronous span (see plan Decision #2 / C1).
    try {
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
      this.teardown(session.channelId)
      throw err
    } finally {
      session.prompting = false
      if (this.sessions.has(session.channelId)) {
        const next = session.queue.shift()
        if (next) {
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
      this.teardown(oldest.channelId)
    }
  }

  private async createSession(
    channelId: string,
    userId: string,
  ): Promise<ManagedSession> {
    const args = ['--dangerously-skip-permissions']
    const proc = spawn(this.claudeCommand, args, {
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
      }
    })

    proc.on('exit', code => {
      const session = this.sessions.get(channelId)
      if (session?.process === proc) {
        clearTimeout(session.idleTimer)
        this.sessions.delete(channelId)
        if (code !== 0 && code !== null) {
          console.warn(
            `Agent process for channel ${channelId} exited with code ${code}`,
          )
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

    const managed: ManagedSession = {
      channelId,
      process: proc,
      connection,
      sessionId,
      lastActivity: Date.now(),
      idleTimer: this.startIdleTimer(channelId),
      prompting: false,
      imageCapable,
      currentTurnId: 0,
      queue: [],
      activeUserId: userId,
    }

    this.sessions.set(channelId, managed)
    return managed
  }

  private startIdleTimer(channelId: string): NodeJS.Timeout {
    return setTimeout(
      () => this.teardown(channelId),
      this.idleTimeoutSec * 1000,
    )
  }

  private resetIdleTimer(session: ManagedSession): void {
    clearTimeout(session.idleTimer)
    session.idleTimer = this.startIdleTimer(session.channelId)
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
