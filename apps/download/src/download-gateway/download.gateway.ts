import {
  type DownloadGatewayMessage,
  JOBS_SYNCED_TYPE,
  type JobsSyncedEvent,
  MAX_SYNC_MEDIA_IDS,
  MAX_WATCHED_MEDIA_IDS,
  SYNC_JOBS_EVENT,
  WATCH_MEDIA_EVENT,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
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

/** A `SYNC_JOBS_EVENT` payload. */
const SyncJobsSchema = z.object({
  mediaIds: z.array(z.string()).max(MAX_SYNC_MEDIA_IDS).optional(),
  since: z.iso.datetime().optional(),
})

/**
 * Builds a reconnecting socket's catch-up frames - see `SYNC_JOBS_EVENT`.
 * Resolves to a per-viewer builder, like `broadcastPerViewer()`'s, so the
 * gateway can mask attribution for the one client asking without knowing how.
 */
export type JobSyncSource = (
  since: Date | undefined,
) => Promise<(isAdmin: boolean) => DownloadGatewayMessage[]>

/**
 * Builds the media half of a catch-up: a frame per id in `mediaIds` with its
 * current state. `watching` is the asking client's watch list - the titles
 * open on a detail page, which get a fresh upstream read and their episodes.
 * Never rejects; a title it cannot build is left out.
 */
export type MediaSyncSource = (
  mediaIds: readonly string[],
  watching: ReadonlySet<string>,
) => Promise<DownloadGatewayMessage[]>

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
  private syncSource: JobSyncSource | undefined
  private mediaSyncSource: MediaSyncSource | undefined

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

  /**
   * Registers what answers `SYNC_JOBS_EVENT`. A setter rather than an
   * injection: the source lives in `DownloadModule`, which already depends on
   * this module.
   */
  setSyncSource(source: JobSyncSource): void {
    this.syncSource = source
  }

  /**
   * Registers what builds a catch-up's media frames. A setter for the same
   * reason as {@link setSyncSource}: the source lives in `MediaModule`.
   */
  setMediaSyncSource(source: MediaSyncSource): void {
    this.mediaSyncSource = source
  }

  /**
   * Replies to one client with the current state of every media it is
   * showing and every job it may have missed while it had no socket, then a
   * `JOBS_SYNCED_TYPE` frame. The client's watch list is read here, after
   * the `WATCH_MEDIA_EVENT` it sends ahead of this on every open. `serverTime` is read before the
   * source is, so a change that lands mid-sync is in the reply, on its way
   * as a live frame, or both - never neither.
   */
  @SubscribeMessage(SYNC_JOBS_EVENT)
  async handleSyncJobs(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: unknown,
  ): Promise<void> {
    const state = this.clients.get(client)
    if (!state || !this.syncSource) return

    const parsed = SyncJobsSchema.safeParse(data ?? {})
    if (!parsed.success) {
      this.logger.warn(
        { action: 'handleSyncJobs' },
        'Malformed sync-jobs message - ignoring it',
      )
      return
    }

    const serverTime = new Date().toISOString()
    const since = parsed.data.since ? new Date(parsed.data.since) : undefined
    const mediaIds = parsed.data.mediaIds ?? []

    try {
      const [build, mediaFrames] = await Promise.all([
        this.syncSource(since),
        mediaIds.length > 0 && this.mediaSyncSource
          ? this.mediaSyncSource(mediaIds, state.watching)
          : [],
      ])
      const isAdmin = state.email
        ? await this.adminCheckService.checkIsAdmin(state.email)
        : false

      if (client.readyState !== WebSocket.OPEN) return

      for (const message of [...mediaFrames, ...build(isAdmin)]) {
        client.send(JSON.stringify(message))
      }

      const synced: JobsSyncedEvent = { serverTime }
      client.send(JSON.stringify({ data: synced, type: JOBS_SYNCED_TYPE }))
    } catch (err) {
      this.logger.error(
        { action: 'handleSyncJobs', error: getErrorMessage(err) },
        'Failed to sync jobs for a client',
      )
    }
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
