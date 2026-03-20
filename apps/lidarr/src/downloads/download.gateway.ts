import { TokenClient } from '@lilnas/token-client'
import { Inject, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import { Server, Socket } from 'socket.io'

import { TOKEN_CLIENT } from 'src/auth/auth.constants'

import {
  INTERNAL_DOWNLOAD_EVENT,
  type InternalDownloadEvent,
} from './downloads.types'

@WebSocketGateway({ namespace: '/downloads', cors: { origin: true } })
export class DownloadGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(DownloadGateway.name)

  constructor(
    @Inject(TOKEN_CLIENT) private readonly tokenClient: TokenClient,
  ) {}

  @WebSocketServer()
  server!: Server

  async handleConnection(client: Socket): Promise<void> {
    try {
      const tokenValue = client.handshake.headers['x-token-value'] as
        | string
        | undefined

      if (!tokenValue) {
        client.disconnect()
        return
      }

      const valid = await this.tokenClient.validate('lidarr', tokenValue)
      if (!valid) {
        client.disconnect()
        return
      }

      this.logger.debug(`Client connected: ${client.id}`)
    } catch {
      client.disconnect()
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`)
  }

  hasConnectedClients(): boolean {
    return (this.server?.sockets?.sockets?.size ?? 0) > 0
  }

  @OnEvent(INTERNAL_DOWNLOAD_EVENT)
  handleDownloadEvent(event: InternalDownloadEvent): void {
    this.server.emit(event.eventName, event.payload)
  }
}
