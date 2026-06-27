import { type ChildProcess, spawn } from 'node:child_process'
import { Readable, Writable } from 'node:stream'

import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk'
import { env } from '@lilnas/utils/env'
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'

import { EnvKeys } from 'src/env'

import { createAcpClient } from './acp-client'
import { ACP_EVENT_HANDLERS } from './agent.module'
import type { AcpEventHandlers } from './agent.types'

interface ManagedSession {
  channelId: string
  process: ChildProcess
  connection: ClientSideConnection
  sessionId: string
  lastActivity: number
  idleTimer: NodeJS.Timeout
  prompting: boolean
  queue: Array<{ text: string; userId: string }>
  activeUserId: string
}

@Injectable()
export class SessionManagerService implements OnApplicationShutdown {
  private readonly sessions = new Map<string, ManagedSession>()
  private readonly maxConcurrentSessions: number
  private readonly idleTimeoutSec: number
  private readonly claudeCommand: string
  private readonly claudeCwd: string

  constructor(
    @Inject(ACP_EVENT_HANDLERS) private readonly handlers: AcpEventHandlers,
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
  }

  async prompt(
    channelId: string,
    text: string,
    userId: string,
  ): Promise<string> {
    const session = await this.getOrCreate(channelId, userId)
    session.lastActivity = Date.now()
    this.resetIdleTimer(session)

    if (session.prompting) {
      session.queue.push({ text, userId })
      return 'queued'
    }

    return this.executePrompt(session, text, userId)
  }

  cancel(channelId: string): void {
    const session = this.sessions.get(channelId)
    if (session) {
      session.connection.cancel({ sessionId: session.sessionId })
    }
  }

  teardown(channelId: string): void {
    const session = this.sessions.get(channelId)
    if (!session) return
    clearTimeout(session.idleTimer)
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
  ): Promise<string> {
    session.prompting = true
    session.activeUserId = userId
    try {
      const result = await session.connection.prompt({
        sessionId: session.sessionId,
        prompt: [{ type: 'text', text }],
      })
      this.handlers.onPromptComplete(session.channelId, result.stopReason)
      return result.stopReason
    } catch (err) {
      console.error(
        `Prompt error for channel ${session.channelId}, tearing down session:`,
        err,
      )
      this.handlers.onPromptComplete(session.channelId, 'error')
      this.teardown(session.channelId)
      throw err
    } finally {
      session.prompting = false
      if (this.sessions.has(session.channelId)) {
        const next = session.queue.shift()
        if (next) {
          this.executePrompt(session, next.text, next.userId).catch(err => {
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
    })

    let connection: ClientSideConnection
    let sessionId: string
    try {
      const stream = ndJsonStream(
        Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>,
      )

      const client = createAcpClient(channelId, this.handlers)
      connection = new ClientSideConnection(() => client, stream)

      await connection.initialize({
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
