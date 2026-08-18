import { Logger } from '@nestjs/common'
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets'
import type { IncomingMessage } from 'http'
import { WebSocket } from 'ws'

import { AdminCheckService } from 'src/auth/admin-check.service'
import { resolveForwardedUser } from 'src/auth/forwarded-user'

/**
 * The WS envelope every gateway frame is wrapped in. Deliberately
 * loosely-typed: `type` discriminates between payload kinds and `data`
 * varies per kind. The one kind sent today is `DOWNLOAD_JOB_EVENT_TYPE`
 * carrying a `DownloadJobEvent` (see
 * `DownloadStateService.broadcastJobEvent`).
 */
export interface DownloadGatewayMessage {
  type: string
  data?: unknown
}

interface ClientState {
  // Captured once at connect time and never re-derived - this is just
  // "which identity is this socket", not "is it currently an admin". Admin
  // status is resolved fresh on every broadcast (see broadcastPerViewer())
  // so it shares AdminCheckService's TTL with the REST path instead of
  // drifting from it for the life of the connection.
  email: string | undefined
}

@WebSocketGateway({ path: '/ws' })
export class DownloadGateway
  implements OnGatewayConnection<WebSocket>, OnGatewayDisconnect<WebSocket>
{
  private readonly logger = new Logger(DownloadGateway.name)
  private readonly clients = new Map<WebSocket, ClientState>()

  constructor(private readonly adminCheckService: AdminCheckService) {}

  handleConnection(client: WebSocket, req: IncomingMessage): void {
    this.clients.set(client, { email: resolveForwardedUser(req)?.email })
    this.logger.log(
      { action: 'handleConnection', totalClients: this.clients.size },
      'WebSocket client connected',
    )
  }

  handleDisconnect(client: WebSocket): void {
    this.clients.delete(client)
    this.logger.log(
      { action: 'handleDisconnect', totalClients: this.clients.size },
      'WebSocket client disconnected',
    )
  }

  /**
   * Sends a viewer-specific payload to every connected client, built by
   * `build(isAdmin)`. Resolves each connected client's admin status fresh
   * on every call (via `AdminCheckService`'s own TTL cache, so a repeat
   * call is cheap) rather than trusting a value captured at connect time -
   * that's what lets a revoked admin lose live-update attribution within
   * the same TTL window REST already enforces, and an admin whose tab
   * connected during an auth blip recover just as fast.
   *
   * Two levels of de-duplication keep this at the same cost as a single
   * broadcast: `checkIsAdmin()` is called at most once per distinct email
   * connected (not once per socket), and each distinct `isAdmin` payload is
   * `JSON.stringify`'d at most once (not once per client) - there are only
   * ever two possible variants.
   */
  async broadcastPerViewer(
    build: (isAdmin: boolean) => DownloadGatewayMessage,
  ): Promise<void> {
    const isAdminByEmail = new Map<string | undefined, boolean>()
    const messageByIsAdmin = new Map<boolean, string>()

    for (const [client, { email }] of this.clients) {
      if (client.readyState !== WebSocket.OPEN) continue

      let isAdmin = isAdminByEmail.get(email)
      if (isAdmin === undefined) {
        isAdmin = email
          ? await this.adminCheckService.checkIsAdmin(email)
          : false
        isAdminByEmail.set(email, isAdmin)
      }

      let message = messageByIsAdmin.get(isAdmin)
      if (message === undefined) {
        message = JSON.stringify(build(isAdmin))
        messageByIsAdmin.set(isAdmin, message)
      }

      client.send(message)
    }
  }
}
