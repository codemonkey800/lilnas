import { randomUUID } from 'node:crypto'

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
  SEAT_CLAIM_MIN_INTERVAL_MS,
  TABLET_STATE_MIN_INTERVAL_MS,
  THEATER_ROOM,
  VALID_CHARACTER_IDS,
  VIDEO_COMMAND_MIN_INTERVAL_MS,
} from './presence.constants'
import {
  type AnimState,
  HandshakeSchema,
  PresencePacketSchema,
} from './presence.schema'
import {
  applyEnqueue,
  applyMove,
  applyNext,
  applyRemove,
  type QueueEntry,
  type QueueState,
} from './queue'
import { PeerMuteSchema, RtcSignalMessageSchema } from './rtc.schema'
import { SEAT_IDS, SeatClaimSchema } from './seat.schema'
import { type TabletState, TabletStateSchema } from './tablet.schema'
import { type VideoCommand, VideoCommandSchema } from './video.schema'

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
  lastSeatAt: number
  lastVideoCommandAt: number
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
  seatId?: string | null
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

type RateLimitField =
  | 'lastPresenceAt'
  | 'lastRtcSignalAt'
  | 'lastSeatAt'
  | 'lastTabletAt'
  | 'lastVideoCommandAt'

// `seat:claim` ack (ORCHESTRATE.md §1) — the server is the sole arbiter of
// occupancy, so every claim resolves to exactly one of these two shapes.
type SeatClaimAck = { ok: true } | { ok: false; reason: 'taken' | 'unknown' }

// Room-wide video/queue state (ORCHESTRATE.md §1 / PLAN.md "B3b") — the
// server-held anchor every client's `applyAnchor()` converges on. Not
// exported: nothing outside this file needs to name it, mirroring
// `PeerSnapshot`'s narrower export scope for its own sibling types.
type RoomVideoState = {
  queue: QueueEntry[]
  currentEntryId: string | null
  playing: boolean
  playhead: number
  atServerMs: number
}

// Fresh, empty room state — shared by the class field's initial value and
// by the "last peer left" reset in `handleDisconnect` (PLAN.md "B3b": "so a
// new session doesn't inherit yesterday's playlist/playhead"). A plain
// function rather than a class method since it closes over nothing and
// needs a fresh `Date.now()` at each call site, not just at construction
// time.
function createInitialRoomVideo(): RoomVideoState {
  return {
    queue: [],
    currentEntryId: null,
    playing: false,
    playhead: 0,
    atServerMs: Date.now(),
  }
}

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

  // seatId -> holder socket id (ORCHESTRATE.md §1 / PLAN.md "B3a") — the
  // reverse of the `seatId` each roster entry above carries (socket ->
  // seatId). The two are always mutated together, so a seat can never be
  // claimed by two sockets and a socket's `seatId` never points at a seat
  // this map doesn't also reserve for it.
  private readonly seats = new Map<string, string>()

  // Room-wide video/queue state (ORCHESTRATE.md §1 / PLAN.md "B3b"). `queue`
  // + `currentEntryId` are B2's `QueueState` shape; `playing` / `playhead` /
  // `atServerMs` are the playback anchor this file owns directly.
  // `atServerMs` pairs with `playhead`: whenever `playing` is true, the true
  // position right now is always `playhead + (Date.now() - atServerMs) /
  // 1000` (`currentPlayhead()` below). Every transition that changes
  // `playing` or jumps to a new position re-anchors both fields together so
  // that pair is never left momentarily inconsistent with `playing`.
  private roomVideo: RoomVideoState = createInitialRoomVideo()

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
      lastSeatAt: 0,
      lastVideoCommandAt: 0,
    }

    // Snapshot BEFORE adding this client's own entry, so a joiner never sees
    // itself in its own `peers:init` list (ORCHESTRATE.md §1).
    client.emit('peers:init', Array.from(this.roster.values()))
    // Deliberately NOT also emitting `video:state`/`queue:state` here
    // (bugfix — this used to be "the entire late-join story for video
    // sync"): both are dispatched synchronously, in the same task as this
    // handler, which is BEFORE the browser client's own `connect` handler
    // has even run — let alone before its `useVideoSync()` effect (gated on
    // `status === 'connected'`, itself only set from that `connect`
    // handler) has attached listeners for either event. Socket.IO buffers
    // nothing for an unhandled custom event; both emits were silently
    // dropped on every connection, 100% of the time, confirmed against a
    // real socket.io-client round trip. `handleVideoRequest` below is the
    // client-driven replacement: the client emits `video:request` only
    // once its listeners are actually attached (src/playback/sync.ts), so
    // this server-side response is always heard, and — as a bonus over the
    // old push-on-connect design — the same request also resyncs a client
    // after a reconnect that swaps in a fresh socket.
    client.join(THEATER_ROOM)

    const snapshot: PeerSnapshot = {
      id: client.id,
      username,
      characterId,
      p: [0, 0, 0],
      y: 0,
      a: 'idle',
      seatId: null,
    }
    this.roster.set(client.id, snapshot)

    client.to(THEATER_ROOM).emit('peer:join', snapshot)
    this.logger.log(`peer joined: ${username} (${client.id})`)
  }

  handleDisconnect(client: PresenceSocket): void {
    // Free any seat this client held, unconditionally, alongside whatever
    // roster/voice/tablet cleanup follows below — PLAN.md calls a leaked
    // seat "the single most likely bug in the phase": without this,
    // `seats` keeps mapping a now-disconnected socket id forever and the
    // seat can never be claimed again.
    const peer = this.roster.get(client.id)
    if (peer?.seatId) {
      this.seats.delete(peer.seatId)
      client.to(THEATER_ROOM).emit('peer:seat', { id: client.id, seatId: null })
    }

    if (!this.roster.delete(client.id)) {
      return
    }
    client.to(THEATER_ROOM).emit('peer:leave', { id: client.id })
    this.logger.log(`peer left: ${client.id}`)

    // Last peer left — reset the room's video/queue state so tomorrow's
    // session doesn't inherit today's playlist and playhead (PLAN.md
    // "B3b").
    if (this.roster.size === 0) {
      this.roomVideo = createInitialRoomVideo()
    }
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

  @SubscribeMessage('seat:claim')
  handleSeatClaim(
    @ConnectedSocket() client: PresenceSocket,
    @MessageBody() body: unknown,
  ): SeatClaimAck {
    const peer = this.roster.get(client.id)
    if (!peer) {
      return { ok: false, reason: 'unknown' }
    }

    const parsed = SeatClaimSchema.safeParse(body)
    if (
      !parsed.success ||
      !this.acceptRate(client, 'lastSeatAt', SEAT_CLAIM_MIN_INTERVAL_MS)
    ) {
      return { ok: false, reason: 'unknown' }
    }

    const { seatId } = parsed.data
    if (!SEAT_IDS.has(seatId)) {
      return { ok: false, reason: 'unknown' }
    }

    const holderId = this.seats.get(seatId)
    if (holderId !== undefined && holderId !== client.id) {
      return { ok: false, reason: 'taken' }
    }
    if (holderId === client.id) {
      // Already holds this exact seat — a no-op success, not a move.
      return { ok: true }
    }

    // A claim implies a move: free whichever seat this client currently
    // holds before claiming the new one.
    if (peer.seatId) {
      this.seats.delete(peer.seatId)
    }

    this.seats.set(seatId, client.id)
    peer.seatId = seatId

    client.to(THEATER_ROOM).emit('peer:seat', { id: client.id, seatId })

    return { ok: true }
  }

  @SubscribeMessage('seat:release')
  handleSeatRelease(@ConnectedSocket() client: PresenceSocket): {
    ok: true
  } {
    const peer = this.roster.get(client.id)
    if (
      !peer ||
      !this.acceptRate(client, 'lastSeatAt', SEAT_CLAIM_MIN_INTERVAL_MS)
    ) {
      return { ok: true }
    }

    if (peer.seatId) {
      this.seats.delete(peer.seatId)
      peer.seatId = null
      client.to(THEATER_ROOM).emit('peer:seat', { id: client.id, seatId: null })
    }

    return { ok: true }
  }

  @SubscribeMessage('video:command')
  handleVideoCommand(
    @ConnectedSocket() client: PresenceSocket,
    @MessageBody() body: unknown,
  ): void {
    if (!this.roster.has(client.id)) {
      return
    }

    const parsed = VideoCommandSchema.safeParse(body)
    if (
      !parsed.success ||
      !this.acceptRate(
        client,
        'lastVideoCommandAt',
        VIDEO_COMMAND_MIN_INTERVAL_MS,
      )
    ) {
      return
    }

    const command = parsed.data
    switch (command.kind) {
      case 'enqueue': {
        this.videoEnqueue(client, command.entry)
        break
      }
      case 'remove': {
        this.videoRemove(command.entryId)
        break
      }
      case 'move': {
        this.videoMove(command.entryId, command.beforeEntryId)
        break
      }
      case 'jump': {
        this.videoJump(command.entryId)
        break
      }
      case 'next': {
        this.videoNext(command.afterEntryId)
        break
      }
      case 'play': {
        this.videoPlay()
        break
      }
      case 'pause': {
        this.videoPause()
        break
      }
      case 'seek': {
        this.videoSeek(command.playhead)
        break
      }
    }
  }

  // Bugfix: the client-driven half of late-join/reconnect video sync (see
  // `handleConnection`'s comment on why the old push-on-connect design never
  // worked). No payload, mirroring `seat:release`'s shape — this is a pure
  // "send me the current room state" pull, not a mutation, so there's
  // nothing to validate. Rate-limited on the SAME floor/field as
  // `video:command` — it's a video-transport-plane message just like those
  // eight kinds, and `client.emit` only ever costs the requester their own
  // bandwidth (never broadcast), but `videoStatePayload()` below does a
  // linear queue scan per call, so a scripted client spamming this in a
  // loop is still worth the same cheap insurance every other
  // roster-mutating handler in this file already applies.
  @SubscribeMessage('video:request')
  handleVideoRequest(@ConnectedSocket() client: PresenceSocket): void {
    if (
      !this.roster.has(client.id) ||
      !this.acceptRate(
        client,
        'lastVideoCommandAt',
        VIDEO_COMMAND_MIN_INTERVAL_MS,
      )
    ) {
      return
    }

    client.emit('video:state', this.videoStatePayload())
    client.emit('queue:state', this.queueStatePayload())
  }

  // The queue-mutation slice of `roomVideo` (`./queue`'s `QueueState`) —
  // `playing` / `playhead` / `atServerMs` are playback-anchor concerns this
  // file owns directly and are never passed to B2's pure queue functions.
  private toQueueState(): QueueState {
    return {
      queue: this.roomVideo.queue,
      currentEntryId: this.roomVideo.currentEntryId,
    }
  }

  // The TRUE playhead right now, accounting for elapsed wall-clock time
  // since the last anchor while playing (ORCHESTRATE.md §1: "playhead
  // already advanced to broadcast time"). Every transition that changes
  // `playing` or jumps to a new position must re-anchor `playhead` /
  // `atServerMs` to this value *before* mutating, so the stored pair is
  // never left momentarily inconsistent with `playing`.
  private currentPlayhead(): number {
    if (!this.roomVideo.playing) {
      return this.roomVideo.playhead
    }
    return (
      this.roomVideo.playhead + (Date.now() - this.roomVideo.atServerMs) / 1000
    )
  }

  private videoStatePayload(): {
    currentEntryId: string | null
    currentItemId: string | null
    playing: boolean
    playhead: number
  } {
    const currentItemId =
      this.roomVideo.queue.find(
        entry => entry.entryId === this.roomVideo.currentEntryId,
      )?.itemId ?? null

    return {
      currentEntryId: this.roomVideo.currentEntryId,
      currentItemId,
      playing: this.roomVideo.playing,
      playhead: this.currentPlayhead(),
    }
  }

  private queueStatePayload(): { queue: QueueEntry[] } {
    return { queue: this.roomVideo.queue }
  }

  // Whole-room broadcast INCLUDING the sender (`this.server.to`, never
  // `client.to`) — ORCHESTRATE.md §1 invariant 2 — so every client,
  // including whoever issued the command, converges on the exact same
  // anchor. Never mutates `roomVideo`; a pure read + broadcast.
  private broadcastVideoState(): void {
    this.server.to(THEATER_ROOM).emit('video:state', this.videoStatePayload())
  }

  // Same whole-room-including-sender scope as `broadcastVideoState` — fires
  // only when the queue array itself changes, not on every transport change
  // (ORCHESTRATE.md §1).
  private broadcastQueueState(): void {
    this.server.to(THEATER_ROOM).emit('queue:state', this.queueStatePayload())
  }

  private videoEnqueue(
    client: PresenceSocket,
    entry: Extract<VideoCommand, { kind: 'enqueue' }>['entry'],
  ): void {
    const wasEmpty = this.roomVideo.currentEntryId === null

    const queueEntry: QueueEntry = {
      entryId: randomUUID(),
      itemId: entry.itemId,
      title: entry.title,
      subtitle: entry.subtitle,
      imageTag: entry.imageTag,
      runTimeTicks: entry.runTimeTicks,
      addedBy: client.data.username,
    }

    const next = applyEnqueue(this.toQueueState(), queueEntry)
    this.roomVideo.queue = next.queue
    this.roomVideo.currentEntryId = next.currentEntryId

    // The queue was empty and this entry became current — start playback,
    // or adding the very first title does nothing visible (PLAN.md "B3b").
    if (wasEmpty && next.currentEntryId !== null) {
      this.roomVideo.playhead = 0
      this.roomVideo.atServerMs = Date.now()
      this.roomVideo.playing = true
    }

    this.broadcastVideoState()
    this.broadcastQueueState()
  }

  private videoRemove(entryId: string): void {
    const previousCurrentEntryId = this.roomVideo.currentEntryId
    const next = applyRemove(this.toQueueState(), entryId)
    this.roomVideo.queue = next.queue
    this.roomVideo.currentEntryId = next.currentEntryId

    if (next.currentEntryId !== previousCurrentEntryId) {
      this.roomVideo.playhead = 0
      this.roomVideo.atServerMs = Date.now()
      if (next.currentEntryId === null) {
        this.roomVideo.playing = false
      }
      // else: the cursor advanced to the pre-removal follower — mirrors a
      // `jump` onto the new current entry, leaving `playing` as it was.
    }

    this.broadcastVideoState()
    this.broadcastQueueState()
  }

  private videoMove(entryId: string, beforeEntryId: string | null): void {
    const next = applyMove(this.toQueueState(), entryId, beforeEntryId)
    this.roomVideo.queue = next.queue
    // `applyMove` never changes the cursor (ORCHESTRATE.md §1 invariant 3)
    // — only the queue array itself changed.

    this.broadcastQueueState()
  }

  private videoJump(entryId: string): void {
    const exists = this.roomVideo.queue.some(entry => entry.entryId === entryId)
    if (!exists) {
      // Mirrors `applyMove`'s unknown-id no-op — never crash, and never ack
      // an error since `video:command` is fire-and-forget.
      return
    }

    this.roomVideo.currentEntryId = entryId
    this.roomVideo.playhead = 0
    this.roomVideo.atServerMs = Date.now()
    // `playing` is left exactly as it was.

    this.broadcastVideoState()
  }

  private videoNext(afterEntryId: string): void {
    if (afterEntryId !== this.roomVideo.currentEntryId) {
      // Every client fires `next` on `ended`; only the first to arrive
      // still matches the current cursor (ORCHESTRATE.md §1 invariant 4) —
      // the auto-advance dedup. Silently ignore the rest; no ack either
      // way.
      return
    }

    const next = applyNext(this.toQueueState())
    this.roomVideo.queue = next.queue
    this.roomVideo.currentEntryId = next.currentEntryId
    this.roomVideo.playhead = 0
    this.roomVideo.atServerMs = Date.now()
    if (next.currentEntryId === null) {
      this.roomVideo.playing = false
    }
    // else: leave `playing` as it was.

    this.broadcastVideoState()
  }

  private videoPlay(): void {
    this.roomVideo.playhead = this.currentPlayhead()
    this.roomVideo.atServerMs = Date.now()
    this.roomVideo.playing = true

    this.broadcastVideoState()
  }

  private videoPause(): void {
    this.roomVideo.playhead = this.currentPlayhead()
    this.roomVideo.atServerMs = Date.now()
    this.roomVideo.playing = false

    this.broadcastVideoState()
  }

  private videoSeek(playhead: number): void {
    this.roomVideo.playhead = playhead
    this.roomVideo.atServerMs = Date.now()
    // `playing` is left exactly as it was.

    this.broadcastVideoState()
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
