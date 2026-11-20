import { getErrorMessage } from '@lilnas/utils/error'
import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets'
import type { IncomingMessage } from 'http'
import { WebSocket } from 'ws'

import { resolveForwardedUser } from 'src/auth/forwarded-user'
import { JobsService } from 'src/jobs/jobs.service'
import type { ServerMessage } from 'src/shared/contract'

import { JobUserService } from './job-user.service'

/** Close code for a handshake that carries no forwarded identity. */
export const CLOSE_UNAUTHORIZED = 4401

interface Viewer {
  email: string
  userId: string
}

interface Push {
  running: boolean
  again: boolean
}

/**
 * Pushes each person's `BackupView` to their open tabs: once when a tab
 * connects, then whenever `JobsService.onChange` fires for them. It takes no
 * client messages (no handlers are registered, and frames are capped tiny).
 */
@WebSocketGateway({ path: '/ws', maxPayload: 1024 })
export class BackupGateway
  implements
    OnGatewayConnection<WebSocket>,
    OnGatewayDisconnect<WebSocket>,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(BackupGateway.name)
  private readonly clients = new Map<WebSocket, Viewer>()
  // One push loop per person at a time, so two quick changes cannot deliver
  // their views out of order.
  private readonly pushes = new Map<string, Push>()
  private unsubscribe: (() => void) | undefined

  constructor(
    private readonly jobs: JobsService,
    private readonly users: JobUserService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.jobs.onChange(userId => this.schedule(userId))
  }

  onModuleDestroy(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  handleConnection(client: WebSocket, req: IncomingMessage): void {
    const viewer = resolveForwardedUser(req)
    if (!viewer) {
      client.close(CLOSE_UNAUTHORIZED, 'Unauthorized')
      return
    }
    this.clients.set(client, { email: viewer.email, userId: viewer.userId })
    // Goes to every tab this person has open: the identical view, so a repeat
    // is harmless, and it keeps one ordered path for everything they receive.
    this.schedule(viewer.userId)
  }

  handleDisconnect(client: WebSocket): void {
    this.clients.delete(client)
  }

  /** Sends `userId`'s current view to their tabs; changes that land while one is in flight are coalesced into one more send. */
  private schedule(userId: string): void {
    const state = this.pushes.get(userId)
    if (state) {
      state.again = true
      return
    }
    if (!this.hasClients(userId)) return
    const fresh: Push = { running: true, again: false }
    this.pushes.set(userId, fresh)
    void this.runPush(userId, fresh)
  }

  private async runPush(userId: string, state: Push): Promise<void> {
    try {
      do {
        state.again = false
        await this.pushOnce(userId)
      } while (state.again)
    } finally {
      this.pushes.delete(userId)
    }
  }

  private async pushOnce(userId: string): Promise<void> {
    const viewer = this.firstViewer(userId)
    if (!viewer) return
    try {
      const view = await this.jobs.getView(await this.users.resolve(viewer))
      const message: ServerMessage = { type: 'backup', data: view }
      const frame = JSON.stringify(message)
      for (const [client, who] of this.clients) {
        if (who.userId === userId && client.readyState === WebSocket.OPEN) {
          client.send(frame)
        }
      }
    } catch (err) {
      this.logger.error(
        { action: 'pushView', error: getErrorMessage(err) },
        'Failed to push a backup view',
      )
    }
  }

  private hasClients(userId: string): boolean {
    return this.firstViewer(userId) !== undefined
  }

  private firstViewer(userId: string): Viewer | undefined {
    for (const who of this.clients.values()) {
      if (who.userId === userId) return who
    }
    return undefined
  }
}
