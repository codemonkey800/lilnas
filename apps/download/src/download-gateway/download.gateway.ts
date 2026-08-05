import { Logger } from '@nestjs/common'
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets'
import { WebSocket } from 'ws'

/**
 * Loosely-typed broadcast payload for this phase of the gateway. A later unit
 * will wire in the real yt-dlp job status types once the job lifecycle is
 * connected to broadcasts.
 */
export interface DownloadGatewayMessage {
  type: string
  data?: unknown
}

@WebSocketGateway({ path: '/ws' })
export class DownloadGateway
  implements OnGatewayConnection<WebSocket>, OnGatewayDisconnect<WebSocket>
{
  private readonly logger = new Logger(DownloadGateway.name)
  private readonly clients = new Set<WebSocket>()

  handleConnection(client: WebSocket): void {
    this.clients.add(client)
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

  broadcast(payload: DownloadGatewayMessage): void {
    const message = JSON.stringify(payload)

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    }
  }
}
