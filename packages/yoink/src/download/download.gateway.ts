import { Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { JwtService } from '@nestjs/jwt'
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { parse as parseCookies } from 'cookie'
import { Server, Socket } from 'socket.io'

import { AUTH_TOKEN_COOKIE } from 'src/auth/constants'

import {
  INTERNAL_DOWNLOAD_EVENT,
  type InternalDownloadEvent,
} from './download.types'

@WebSocketGateway({
  namespace: '/downloads',
  cors: { origin: true, credentials: true },
})
export class DownloadGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(DownloadGateway.name)

  @WebSocketServer()
  server!: Server

  constructor(private readonly jwtService: JwtService) {}

  /**
   * Authenticates incoming WebSocket connections by verifying the JWT
   * token from the cookie header. Disconnects unauthorized clients.
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const rawCookie = client.handshake.headers.cookie ?? ''
      const cookies = parseCookies(rawCookie)
      const token = cookies[AUTH_TOKEN_COOKIE]

      if (!token) {
        client.disconnect()
        return
      }

      await this.jwtService.verifyAsync(token)
      this.logger.debug(`Client connected: ${client.id}`)
    } catch {
      client.disconnect()
    }
  }

  /** Logs client disconnections for debugging. */
  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`)
  }

  /** Forwards internal download events to all connected WebSocket clients. */
  @OnEvent(INTERNAL_DOWNLOAD_EVENT)
  handleDownloadEvent(event: InternalDownloadEvent): void {
    this.server.emit(event.eventName, event.payload)
  }
}
