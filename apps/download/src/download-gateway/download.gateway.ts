import {
  type DownloadGatewayMessage,
  MAX_WATCHED_MEDIA_IDS,
  WATCH_MEDIA_EVENT,
} from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets'
import type { IncomingMessage } from 'http'
import { WebSocket } from 'ws'
import { z } from 'zod'

import { AdminCheckService } from 'src/auth/admin-check.service'
import { resolveForwardedUser } from 'src/auth/forwarded-user'

/**
 * The WS envelope every gateway frame is wrapped in - `type` discriminates
 * between payload kinds and `data` varies per kind: `DOWNLOAD_JOB_EVENT_TYPE`
 * carries a `DownloadJobEvent` (see `DownloadStateService.broadcastJobEvent`)
 * and `MEDIA_EVENT_TYPE` a `MediaEvent`.
 *
 * Defined in `@lilnas/utils/download/types` so a frontend subscriber shares
 * it, and re-exported here so every existing import site keeps working.
 */
export type { DownloadGatewayMessage } from '@lilnas/utils/download/types'

interface ClientState {
  // Captured once at connect time and never re-derived - this is just
  // "which identity is this socket", not "is it currently an admin". Admin
  // status is resolved fresh on every broadcast (see broadcastPerViewer())
  // so it shares AdminCheckService's TTL with the REST path instead of
  // drifting from it for the life of the connection.
  email: string | undefined
  /** The movie/show ids this tab has a detail page open for. */
  watching: ReadonlySet<string>
}

/**
 * A `WATCH_MEDIA_EVENT` payload, capped since each id is an upstream call a
 * second.
 */
const WatchMediaSchema = z.object({
  mediaIds: z.array(z.string()).max(MAX_WATCHED_MEDIA_IDS),
})

/**
 * The ids `LibraryWatchService` can re-read upstream: movies and shows. Any
 * other id in a watch list is dropped rather than failing the whole list.
 */
const WATCHABLE_MEDIA_ID = /^(tmdb|tvdb):\d+$/

@WebSocketGateway({ path: '/ws' })
export class DownloadGateway
  implements OnGatewayConnection<WebSocket>, OnGatewayDisconnect<WebSocket>
{
  private readonly logger = new Logger(DownloadGateway.name)
  private readonly clients = new Map<WebSocket, ClientState>()

  constructor(private readonly adminCheckService: AdminCheckService) {}

  handleConnection(client: WebSocket, req: IncomingMessage): void {
    this.clients.set(client, {
      email: resolveForwardedUser(req)?.email,
      watching: new Set(),
    })
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
   * Replaces the set of titles `client` has a detail page open for. A
   * malformed payload is dropped and leaves the previous set alone - the
   * client re-sends its whole set on every change, so the next good one
   * corrects it.
   */
  @SubscribeMessage(WATCH_MEDIA_EVENT)
  handleWatchMedia(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: unknown,
  ): void {
    const state = this.clients.get(client)
    if (!state) return

    const parsed = WatchMediaSchema.safeParse(data)
    if (!parsed.success) {
      this.logger.warn(
        { action: 'handleWatchMedia' },
        'Malformed watch-media message - ignoring it',
      )
      return
    }

    state.watching = new Set(
      parsed.data.mediaIds.filter(id => WATCHABLE_MEDIA_ID.test(id)),
    )
  }

  /** How many clients are connected. */
  get clientCount(): number {
    return this.clients.size
  }

  /** Every title any connected client has a detail page open for. */
  watchedMediaIds(): Set<string> {
    const ids = new Set<string>()
    for (const { watching } of this.clients.values()) {
      for (const id of watching) ids.add(id)
    }
    return ids
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

  /**
   * Sends the same payload to every connected client, serialised once. For
   * frames that carry nothing viewer-specific - a media snapshot has no
   * requester for the attribution oracle to mask, so unlike a job event it
   * needs no per-viewer variants (see `broadcastPerViewer()`). Every open
   * client gets every frame; filtering is left to the client.
   */
  broadcast(message: DownloadGatewayMessage): void {
    const serialised = JSON.stringify(message)

    for (const client of this.clients.keys()) {
      if (client.readyState !== WebSocket.OPEN) continue
      client.send(serialised)
    }
  }
}
