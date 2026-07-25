import { env } from '@lilnas/utils/env'
import { Injectable, Logger } from '@nestjs/common'
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets'
import type { DefaultEventsMap, Server, Socket } from 'socket.io'

import { AuthService } from 'src/auth/auth.service'
import { EnvKeys } from 'src/env'

import {
  PRESENCE_MIN_INTERVAL_MS,
  RTC_ICE_MIN_INTERVAL_MS,
  TABLET_STATE_MIN_INTERVAL_MS,
  THEATER_ROOM,
  VALID_CHARACTER_IDS,
} from './presence.constants'
import {
  type AnimState,
  HandshakeSchema,
  PresencePacketSchema,
} from './presence.schema'
import { PeerMuteSchema, RtcSignalMessageSchema } from './rtc.schema'
import { type TabletState, TabletStateSchema } from './tablet.schema'

// Stashed on `client.data` in `handleConnection` once auth + characterId
// validation succeed. Every `@SubscribeMessage` handler below only reads it
// after confirming the socket is in `roster` (populated in the same place),
// so it can trust these fields are always fully set.
interface PresenceSocketData {
  username: string
  characterId: string
  lastPresenceAt: number
  lastTabletAt: number
  lastRtcSignalAt: number
}

type PresenceSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  PresenceSocketData
>

type PresenceServer = Server<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  PresenceSocketData
>

// Roster entry shape (ORCHESTRATE.md §1) — exported so later units (B4's
// gateway tests, and anything else that needs it) don't have to redeclare
// it.
export interface PeerSnapshot {
  id: string
  username: string
  characterId: string
  p: [number, number, number]
  y: number
  a: AnimState
  muted?: boolean
  tablet?: TabletState
}

// Dev-only CORS (PLAN.md "Routing"): native `lilnas dev` serves the browser
// page from FRONTEND_PORT while this gateway listens on BACKEND_PORT, so the
// handshake is cross-port in dev and needs an explicit allow + credentials.
// Read from `FRONTEND_PORT` (falling back to the `.env.example` default of
// 8080) rather than a hardcoded port — developers running several lilnas
// apps side by side commonly override both `FRONTEND_PORT`/`BACKEND_PORT` in
// their own `.env` to avoid collisions, and a hardcoded origin here would
// silently 403 the socket handshake for any such setup (the browser's
// `Origin` header always reflects the page's *actual* port, not the
// project's documented default). In prod, Traefik routes `/socket.io` to the
// same origin as the page (deploy.yml), so CORS never engages there. Mirrors
// the exact `env(EnvKeys.NODE_ENV, 'development') === 'production'` gate
// `auth.service.ts`'s `sessionCookieOptions` already uses.
function corsOptions() {
  if (env(EnvKeys.NODE_ENV, 'development') === 'production') {
    return undefined
  }
  return {
    origin: `http://localhost:${env(EnvKeys.FRONTEND_PORT, '8080')}`,
    credentials: true,
  }
}

type RateLimitField = 'lastPresenceAt' | 'lastRtcSignalAt' | 'lastTabletAt'

@Injectable()
@WebSocketGateway({ cors: corsOptions() })
export class PresenceGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(PresenceGateway.name)

  @WebSocketServer()
  private readonly server!: PresenceServer

  // In-memory roster, one entry per connected+authenticated socket. A plain
  // instance field is the right shape here — `PresenceGateway` is a NestJS
  // singleton provider (default scope), so this persists across
  // connections for the life of the process, same reasoning as
  // `EmbyService`'s `cachedUserId`.
  private readonly roster = new Map<string, PeerSnapshot>()

  constructor(private readonly authService: AuthService) {}

  handleConnection(client: PresenceSocket): void {
    const username = this.authService.verifySessionCookie(
      client.handshake.headers.cookie,
    )
    if (!username) {
      client.disconnect(true)
      return
    }

    const parsedHandshake = HandshakeSchema.safeParse(client.handshake.auth)
    // The schema's `characterId` is itself a `z.enum` built from
    // `VALID_CHARACTER_ID_LIST`, so a successful parse already implies
    // allowlist membership; the explicit `.has()` below is a cheap
    // belt-and-suspenders check so this stays correct even if the schema is
    // ever loosened later without this call site being revisited.
    if (
      !parsedHandshake.success ||
      !VALID_CHARACTER_IDS.has(parsedHandshake.data.characterId)
    ) {
      client.disconnect(true)
      return
    }
    const { characterId } = parsedHandshake.data

    client.data = {
      username,
      characterId,
      lastPresenceAt: 0,
      lastTabletAt: 0,
      lastRtcSignalAt: 0,
    }

    // Snapshot BEFORE adding this client's own entry, so a joiner never sees
    // itself in its own `peers:init` list (ORCHESTRATE.md §1).
    client.emit('peers:init', Array.from(this.roster.values()))

    client.join(THEATER_ROOM)

    const snapshot: PeerSnapshot = {
      id: client.id,
      username,
      characterId,
      p: [0, 0, 0],
      y: 0,
      a: 'idle',
    }
    this.roster.set(client.id, snapshot)

    client.to(THEATER_ROOM).emit('peer:join', snapshot)
    this.logger.log(`peer joined: ${username} (${client.id})`)
  }

  handleDisconnect(client: PresenceSocket): void {
    if (!this.roster.delete(client.id)) {
      return
    }
    client.to(THEATER_ROOM).emit('peer:leave', { id: client.id })
    this.logger.log(`peer left: ${client.id}`)
  }

  @SubscribeMessage('presence')
  handlePresence(
    @ConnectedSocket() client: PresenceSocket,
    @MessageBody() body: unknown,
  ): void {
    const peer = this.roster.get(client.id)
    if (!peer) {
      return
    }

    const parsed = PresencePacketSchema.safeParse(body)
    if (
      !parsed.success ||
      !this.acceptRate(client, 'lastPresenceAt', PRESENCE_MIN_INTERVAL_MS)
    ) {
      return
    }

    const { p, y, a } = parsed.data
    peer.p = p
    peer.y = y
    peer.a = a

    client.to(THEATER_ROOM).emit('peer:presence', { id: client.id, p, y, a })
  }

  @SubscribeMessage('rtc:signal')
  handleRtcSignal(
    @ConnectedSocket() client: PresenceSocket,
    @MessageBody() body: unknown,
  ): void {
    if (!this.roster.has(client.id)) {
      return
    }

    const parsed = RtcSignalMessageSchema.safeParse(body)
    if (
      !parsed.success ||
      !this.acceptRate(client, 'lastRtcSignalAt', RTC_ICE_MIN_INTERVAL_MS)
    ) {
      return
    }

    const { to, data } = parsed.data
    // Only relay to a socket actually in the room — never let a client
    // probe/signal an arbitrary socket id room-wide.
    if (!this.roster.has(to)) {
      return
    }

    // Never log `data` — it may carry SDP/ICE (ORCHESTRATE.md § security
    // checklist / PLAN.md "Voice (4B)").
    this.server.to(to).emit('rtc:signal', { from: client.id, data })
  }

  @SubscribeMessage('peer:mute')
  handlePeerMute(
    @ConnectedSocket() client: PresenceSocket,
    @MessageBody() body: unknown,
  ): void {
    const peer = this.roster.get(client.id)
    if (!peer) {
      return
    }

    const parsed = PeerMuteSchema.safeParse(body)
    if (!parsed.success) {
      return
    }

    peer.muted = parsed.data.muted
    client
      .to(THEATER_ROOM)
      .emit('peer:mute', { id: client.id, muted: parsed.data.muted })
  }

  @SubscribeMessage('tablet:state')
  handleTabletState(
    @ConnectedSocket() client: PresenceSocket,
    @MessageBody() body: unknown,
  ): void {
    const peer = this.roster.get(client.id)
    if (!peer) {
      return
    }

    const parsed = TabletStateSchema.safeParse(body)
    if (
      !parsed.success ||
      !this.acceptRate(client, 'lastTabletAt', TABLET_STATE_MIN_INTERVAL_MS)
    ) {
      return
    }

    peer.tablet = parsed.data
    client
      .to(THEATER_ROOM)
      .emit('peer:tablet', { id: client.id, ...parsed.data })
  }

  // Per-socket "min interval since last ACCEPTED message" flood guard
  // (PLAN.md "B3"). Only advances `field` when the message is accepted, so a
  // burst of rejected messages never pushes the floor further out — as soon
  // as `minIntervalMs` has elapsed since the last accepted message, the very
  // next one is let through regardless of how many were dropped in between.
  private acceptRate(
    client: PresenceSocket,
    field: RateLimitField,
    minIntervalMs: number,
  ): boolean {
    const now = Date.now()
    if (now - client.data[field] < minIntervalMs) {
      return false
    }
    client.data[field] = now
    return true
  }
}
