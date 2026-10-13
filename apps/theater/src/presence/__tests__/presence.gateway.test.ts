import type { AuthService } from 'src/auth/auth.service'
import {
  PRESENCE_MIN_INTERVAL_MS,
  RTC_ICE_MIN_INTERVAL_MS,
  SEAT_CLAIM_MIN_INTERVAL_MS,
  TABLET_STATE_MIN_INTERVAL_MS,
  THEATER_ROOM,
  VALID_CHARACTER_ID_LIST,
  VIDEO_COMMAND_MIN_INTERVAL_MS,
} from 'src/presence/presence.constants'
import {
  type PeerSnapshot,
  PresenceGateway,
} from 'src/presence/presence.gateway'
import type { QueueEntry } from 'src/presence/queue'
import type { TabletState } from 'src/presence/tablet.schema'
import type { VideoCommand } from 'src/presence/video.schema'

const CLIENT_A_ID = 'socket-a'
const CLIENT_A_USERNAME = 'alice'
const CLIENT_B_ID = 'socket-b'
const CLIENT_B_USERNAME = 'bob'

const CHARACTER_ID_A = VALID_CHARACTER_ID_LIST[0]
const CHARACTER_ID_B = VALID_CHARACTER_ID_LIST[1]

const DEFAULT_SNAPSHOT_A: PeerSnapshot = {
  id: CLIENT_A_ID,
  username: CLIENT_A_USERNAME,
  characterId: CHARACTER_ID_A,
  p: [0, 0, 0],
  y: 0,
  a: 'idle',
  // `handleConnection` seeds every new roster entry with `seatId: null`
  // (ORCHESTRATE.md §1) — an explicit `null`, not an absent key, so `toEqual`
  // (which distinguishes `null` from a missing/`undefined` property) needs
  // it spelled out here too.
  seatId: null,
}

const DEFAULT_SNAPSHOT_B: PeerSnapshot = {
  id: CLIENT_B_ID,
  username: CLIENT_B_USERNAME,
  characterId: CHARACTER_ID_B,
  p: [0, 0, 0],
  y: 0,
  a: 'idle',
  seatId: null,
}

const VALID_TABLET_STATE: TabletState = {
  open: true,
  view: 'grid',
  seriesId: null,
  seasonId: null,
  search: '',
  typeFilter: 'all',
  scrollTop: 0,
}

// A well-formed `enqueue` payload (ORCHESTRATE.md §1's `entry` shape) — the
// server fills in `entryId` (randomUUID) and `addedBy` (from the session),
// so neither is client-supplied and neither appears here.
const VALID_ENQUEUE_ENTRY: Extract<VideoCommand, { kind: 'enqueue' }>['entry'] =
  {
    itemId: 'item-1',
    title: 'Big Movie',
    subtitle: '2019',
    imageTag: 'poster-tag-1',
    runTimeTicks: 72_000_000_000,
  }

// Minimal hand-built Socket.IO `Socket` stand-in. `to` always returns the
// SAME object (via `mockReturnValue`), so every broadcast a given mock
// socket makes through `client.to(ROOM).emit(...)` lands on one shared
// `roomEmit` mock regardless of how many times `to` is called — that's what
// lets tests assert "the room received X" without reaching into
// `to.mock.results`.
interface MockSocket {
  id: string
  handshake: {
    headers: { cookie?: string }
    auth: unknown
  }
  data: Record<string, unknown>
  disconnect: jest.Mock
  emit: jest.Mock
  join: jest.Mock
  to: jest.Mock
  roomEmit: jest.Mock
}

function createMockSocket(id: string): MockSocket {
  const roomEmit = jest.fn()
  return {
    id,
    handshake: { headers: {}, auth: {} },
    data: {},
    disconnect: jest.fn(),
    emit: jest.fn(),
    join: jest.fn(),
    to: jest.fn().mockReturnValue({ emit: roomEmit }),
    roomEmit,
  }
}

// Same shared-return trick for the injected `@WebSocketServer() server`,
// used only by `handleRtcSignal` (`this.server.to(to).emit(...)`).
interface MockServer {
  to: jest.Mock
  toEmit: jest.Mock
}

function createMockServer(): MockServer {
  const toEmit = jest.fn()
  return {
    to: jest.fn().mockReturnValue({ emit: toEmit }),
    toEmit,
  }
}

function createMockAuthService(): jest.Mocked<AuthService> {
  return {
    verifyPassword: jest.fn(),
    issueSession: jest.fn(),
    verifySessionCookie: jest.fn(),
    readSession: jest.fn(),
    clearSession: jest.fn(),
  }
}

// Every handler's `client` parameter is typed as a `PresenceSocket` alias
// that presence.gateway.ts declares but never exports. Indexing the class
// type by a method name recovers that exact parameter type without needing
// to export it just for this test file — every handler shares the same
// alias, so any one of them works as the source.
type ClientSocketParam = Parameters<PresenceGateway['handleConnection']>[0]

function asClientSocket(socket: MockSocket): ClientSocketParam {
  return socket as unknown as ClientSocketParam
}

// `@WebSocketServer()` only wires up `server` when Nest actually bootstraps
// the gateway — these tests construct `PresenceGateway` directly, so this
// stands in for that DI wiring. Casting through a small local interface
// (rather than importing the private, unexported `PresenceServer` type) is
// enough to satisfy the field for every method this suite calls.
function injectServer(gateway: PresenceGateway, server: MockServer): void {
  ;(gateway as unknown as { server: MockServer }).server = server
}

function rosterOf(gateway: PresenceGateway): Map<string, PeerSnapshot> {
  return (gateway as unknown as { roster: Map<string, PeerSnapshot> }).roster
}

function buildGateway(): {
  gateway: PresenceGateway
  authService: jest.Mocked<AuthService>
  server: MockServer
} {
  const authService = createMockAuthService()
  const server = createMockServer()
  const gateway = new PresenceGateway(authService)
  injectServer(gateway, server)
  return { gateway, authService, server }
}

function connectClient(
  gateway: PresenceGateway,
  authService: jest.Mocked<AuthService>,
  params: { id: string; username: string; characterId: string },
): MockSocket {
  authService.verifySessionCookie.mockReturnValueOnce(params.username)
  const socket = createMockSocket(params.id)
  socket.handshake.auth = { characterId: params.characterId }
  gateway.handleConnection(asClientSocket(socket))
  return socket
}

// Connects one authenticated client (A) and clears the mocks its own
// `handleConnection` call already populated (the `peers:init` emit +
// `peer:join` broadcast), so message-handler tests start from a clean slate
// and only see the emissions their own call under test produces.
function buildConnectedGateway(): {
  gateway: PresenceGateway
  server: MockServer
  socket: MockSocket
} {
  const { gateway, authService, server } = buildGateway()
  const socket = connectClient(gateway, authService, {
    id: CLIENT_A_ID,
    username: CLIENT_A_USERNAME,
    characterId: CHARACTER_ID_A,
  })
  socket.emit.mockClear()
  socket.to.mockClear()
  socket.roomEmit.mockClear()
  return { gateway, server, socket }
}

function buildGatewayWithTwoPeers(): {
  gateway: PresenceGateway
  server: MockServer
  clientA: MockSocket
  clientB: MockSocket
} {
  const { gateway, authService, server } = buildGateway()
  const clientA = connectClient(gateway, authService, {
    id: CLIENT_A_ID,
    username: CLIENT_A_USERNAME,
    characterId: CHARACTER_ID_A,
  })
  const clientB = connectClient(gateway, authService, {
    id: CLIENT_B_ID,
    username: CLIENT_B_USERNAME,
    characterId: CHARACTER_ID_B,
  })

  for (const client of [clientA, clientB]) {
    client.emit.mockClear()
    client.to.mockClear()
    client.roomEmit.mockClear()
  }
  server.to.mockClear()
  server.toEmit.mockClear()

  return { gateway, server, clientA, clientB }
}

describe('PresenceGateway.handleConnection — auth', () => {
  it('does not disconnect a client with a valid cookie and characterId, and adds it to the roster', () => {
    const { gateway, authService } = buildGateway()

    const socket = connectClient(gateway, authService, {
      id: CLIENT_A_ID,
      username: CLIENT_A_USERNAME,
      characterId: CHARACTER_ID_A,
    })

    expect(socket.disconnect).not.toHaveBeenCalled()
    expect(rosterOf(gateway).get(CLIENT_A_ID)).toEqual(DEFAULT_SNAPSHOT_A)
  })

  it('disconnects and never adds the client to the roster when the session cookie is invalid', () => {
    const { gateway, authService } = buildGateway()
    authService.verifySessionCookie.mockReturnValue(null)
    const socket = createMockSocket(CLIENT_A_ID)
    socket.handshake.auth = { characterId: CHARACTER_ID_A }

    gateway.handleConnection(asClientSocket(socket))

    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(rosterOf(gateway).size).toBe(0)
    expect(socket.emit).not.toHaveBeenCalled()
    expect(socket.roomEmit).not.toHaveBeenCalled()
  })
})

describe('PresenceGateway.handleConnection — characterId allowlist', () => {
  it('disconnects and never adds the client when characterId is outside the allowlist', () => {
    const { gateway, authService } = buildGateway()
    authService.verifySessionCookie.mockReturnValue(CLIENT_A_USERNAME)
    const socket = createMockSocket(CLIENT_A_ID)
    socket.handshake.auth = { characterId: 'nonexistent-character' }

    gateway.handleConnection(asClientSocket(socket))

    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(rosterOf(gateway).size).toBe(0)
  })

  it('disconnects and never adds the client when characterId is missing entirely', () => {
    const { gateway, authService } = buildGateway()
    authService.verifySessionCookie.mockReturnValue(CLIENT_A_USERNAME)
    const socket = createMockSocket(CLIENT_A_ID)
    socket.handshake.auth = {}

    gateway.handleConnection(asClientSocket(socket))

    expect(socket.disconnect).toHaveBeenCalledWith(true)
    expect(rosterOf(gateway).size).toBe(0)
  })
})

describe('PresenceGateway.handleConnection — join behavior', () => {
  let gateway: PresenceGateway
  let clientA: MockSocket
  let clientB: MockSocket

  beforeEach(() => {
    const built = buildGateway()
    gateway = built.gateway
    clientA = connectClient(gateway, built.authService, {
      id: CLIENT_A_ID,
      username: CLIENT_A_USERNAME,
      characterId: CHARACTER_ID_A,
    })
    clientB = connectClient(gateway, built.authService, {
      id: CLIENT_B_ID,
      username: CLIENT_B_USERNAME,
      characterId: CHARACTER_ID_B,
    })
  })

  it('sends the first joiner an empty peers:init (nobody else in the room yet)', () => {
    expect(clientA.emit).toHaveBeenCalledWith('peers:init', [])
  })

  it("sends the second joiner a peers:init containing only the other peer's snapshot, not its own", () => {
    const peersInitCall = clientB.emit.mock.calls.find(
      ([event]) => event === 'peers:init',
    )

    expect(peersInitCall).toBeDefined()
    expect(peersInitCall?.[1]).toEqual([DEFAULT_SNAPSHOT_A])
  })

  it("broadcasts peer:join with the joiner's own snapshot to the room", () => {
    expect(clientB.to).toHaveBeenCalledWith(THEATER_ROOM)
    expect(clientB.roomEmit).toHaveBeenCalledWith(
      'peer:join',
      DEFAULT_SNAPSHOT_B,
    )
  })
})

describe('PresenceGateway.handlePresence', () => {
  it('updates the roster and broadcasts peer:presence for a well-formed body', () => {
    const { gateway, socket } = buildConnectedGateway()

    gateway.handlePresence(asClientSocket(socket), {
      p: [1, 2, 3],
      y: 0.5,
      a: 'walk_fwd',
    })

    expect(rosterOf(gateway).get(CLIENT_A_ID)).toEqual({
      ...DEFAULT_SNAPSHOT_A,
      p: [1, 2, 3],
      y: 0.5,
      a: 'walk_fwd',
    })
    expect(socket.to).toHaveBeenCalledWith(THEATER_ROOM)
    expect(socket.roomEmit).toHaveBeenCalledWith('peer:presence', {
      id: CLIENT_A_ID,
      p: [1, 2, 3],
      y: 0.5,
      a: 'walk_fwd',
    })
  })

  it('drops a body whose position tuple is short, without throwing, mutating the roster, or emitting', () => {
    const { gateway, socket } = buildConnectedGateway()

    expect(() =>
      gateway.handlePresence(asClientSocket(socket), {
        p: [1, 2],
        y: 0,
        a: 'idle',
      }),
    ).not.toThrow()

    expect(rosterOf(gateway).get(CLIENT_A_ID)).toEqual(DEFAULT_SNAPSHOT_A)
    expect(socket.roomEmit).not.toHaveBeenCalled()
  })

  it('drops a body with an anim state outside the 5 valid values, without throwing, mutating the roster, or emitting', () => {
    const { gateway, socket } = buildConnectedGateway()

    expect(() =>
      gateway.handlePresence(asClientSocket(socket), {
        p: [1, 2, 3],
        y: 0,
        a: 'jumping',
      }),
    ).not.toThrow()

    expect(rosterOf(gateway).get(CLIENT_A_ID)).toEqual(DEFAULT_SNAPSHOT_A)
    expect(socket.roomEmit).not.toHaveBeenCalled()
  })

  it('drops a body with a non-finite yaw, without throwing, mutating the roster, or emitting', () => {
    const { gateway, socket } = buildConnectedGateway()

    expect(() =>
      gateway.handlePresence(asClientSocket(socket), {
        p: [1, 2, 3],
        y: Number.POSITIVE_INFINITY,
        a: 'idle',
      }),
    ).not.toThrow()

    expect(rosterOf(gateway).get(CLIENT_A_ID)).toEqual(DEFAULT_SNAPSHOT_A)
    expect(socket.roomEmit).not.toHaveBeenCalled()
  })

  it('drops a second update sent before PRESENCE_MIN_INTERVAL_MS elapses, and accepts a third sent after the floor elapses from the first accepted one', () => {
    const { gateway, socket } = buildConnectedGateway()
    const nowSpy = jest.spyOn(Date, 'now')

    nowSpy.mockReturnValue(1_000)
    gateway.handlePresence(asClientSocket(socket), {
      p: [1, 0, 0],
      y: 0,
      a: 'idle',
    })
    expect(socket.roomEmit).toHaveBeenCalledTimes(1)

    nowSpy.mockReturnValue(1_000 + PRESENCE_MIN_INTERVAL_MS - 1)
    gateway.handlePresence(asClientSocket(socket), {
      p: [2, 0, 0],
      y: 0,
      a: 'idle',
    })
    expect(socket.roomEmit).toHaveBeenCalledTimes(1)
    expect(rosterOf(gateway).get(CLIENT_A_ID)?.p).toEqual([1, 0, 0])

    nowSpy.mockReturnValue(1_000 + PRESENCE_MIN_INTERVAL_MS)
    gateway.handlePresence(asClientSocket(socket), {
      p: [3, 0, 0],
      y: 0,
      a: 'idle',
    })
    expect(socket.roomEmit).toHaveBeenCalledTimes(2)
    expect(rosterOf(gateway).get(CLIENT_A_ID)?.p).toEqual([3, 0, 0])
  })
})

describe('PresenceGateway.handleRtcSignal', () => {
  it('relays a valid signal to the specific target socket via the server, not the whole room', () => {
    const { server, gateway, clientA } = buildGatewayWithTwoPeers()
    const data = { kind: 'offer', sdp: 'sdp-blob' }

    gateway.handleRtcSignal(asClientSocket(clientA), {
      to: CLIENT_B_ID,
      data,
    })

    expect(server.to).toHaveBeenCalledWith(CLIENT_B_ID)
    expect(server.toEmit).toHaveBeenCalledWith('rtc:signal', {
      from: CLIENT_A_ID,
      data,
    })
    expect(clientA.to).not.toHaveBeenCalled()
  })

  it('drops the signal when `to` does not reference a socket in the roster', () => {
    const { server, gateway, clientA } = buildGatewayWithTwoPeers()

    gateway.handleRtcSignal(asClientSocket(clientA), {
      to: 'not-a-real-socket-id',
      data: { kind: 'offer', sdp: 'sdp-blob' },
    })

    expect(server.to).not.toHaveBeenCalled()
    expect(server.toEmit).not.toHaveBeenCalled()
  })

  it('drops malformed signal data (an offer missing sdp), without throwing', () => {
    const { server, gateway, clientA } = buildGatewayWithTwoPeers()

    expect(() =>
      gateway.handleRtcSignal(asClientSocket(clientA), {
        to: CLIENT_B_ID,
        data: { kind: 'offer' },
      }),
    ).not.toThrow()

    expect(server.to).not.toHaveBeenCalled()
    expect(server.toEmit).not.toHaveBeenCalled()
  })

  it('rate-limits like presence/tablet: drops a second signal sent before RTC_ICE_MIN_INTERVAL_MS elapses, and accepts a third sent after the floor elapses', () => {
    const { server, gateway, clientA } = buildGatewayWithTwoPeers()
    const nowSpy = jest.spyOn(Date, 'now')

    nowSpy.mockReturnValue(5_000)
    gateway.handleRtcSignal(asClientSocket(clientA), {
      to: CLIENT_B_ID,
      data: { kind: 'ice', candidate: { candidate: 'first' } },
    })
    expect(server.toEmit).toHaveBeenCalledTimes(1)

    nowSpy.mockReturnValue(5_000 + RTC_ICE_MIN_INTERVAL_MS - 1)
    gateway.handleRtcSignal(asClientSocket(clientA), {
      to: CLIENT_B_ID,
      data: { kind: 'ice', candidate: { candidate: 'second' } },
    })
    expect(server.toEmit).toHaveBeenCalledTimes(1)

    nowSpy.mockReturnValue(5_000 + RTC_ICE_MIN_INTERVAL_MS)
    gateway.handleRtcSignal(asClientSocket(clientA), {
      to: CLIENT_B_ID,
      data: { kind: 'ice', candidate: { candidate: 'third' } },
    })
    expect(server.toEmit).toHaveBeenCalledTimes(2)
  })
})

describe('PresenceGateway.handlePeerMute', () => {
  it('updates the roster muted field and broadcasts peer:mute to the room', () => {
    const { gateway, socket } = buildConnectedGateway()

    gateway.handlePeerMute(asClientSocket(socket), { muted: true })

    expect(rosterOf(gateway).get(CLIENT_A_ID)?.muted).toBe(true)
    expect(socket.roomEmit).toHaveBeenCalledWith('peer:mute', {
      id: CLIENT_A_ID,
      muted: true,
    })
  })

  it('drops a malformed body silently, without throwing or mutating the roster', () => {
    const { gateway, socket } = buildConnectedGateway()

    expect(() =>
      gateway.handlePeerMute(asClientSocket(socket), { muted: 'yes' }),
    ).not.toThrow()

    expect(rosterOf(gateway).get(CLIENT_A_ID)?.muted).toBeUndefined()
    expect(socket.roomEmit).not.toHaveBeenCalled()
  })
})

describe('PresenceGateway.handleTabletState', () => {
  it('updates the roster tablet field and broadcasts peer:tablet to the room', () => {
    const { gateway, socket } = buildConnectedGateway()

    gateway.handleTabletState(asClientSocket(socket), VALID_TABLET_STATE)

    expect(rosterOf(gateway).get(CLIENT_A_ID)?.tablet).toEqual(
      VALID_TABLET_STATE,
    )
    expect(socket.roomEmit).toHaveBeenCalledWith('peer:tablet', {
      id: CLIENT_A_ID,
      ...VALID_TABLET_STATE,
    })
  })

  it('drops a malformed body (a view outside the valid set), without throwing or mutating the roster', () => {
    const { gateway, socket } = buildConnectedGateway()

    expect(() =>
      gateway.handleTabletState(asClientSocket(socket), {
        ...VALID_TABLET_STATE,
        view: 'not-a-real-view',
      }),
    ).not.toThrow()

    expect(rosterOf(gateway).get(CLIENT_A_ID)?.tablet).toBeUndefined()
    expect(socket.roomEmit).not.toHaveBeenCalled()
  })

  // The other half of the `view` union's four hand-mirrored copies (the
  // frontend guard is covered in multiplayer/__tests__/store.test.ts). If
  // tablet.schema.ts's zod enum falls behind, a peer on that page silently
  // stops mirroring rather than erroring — so every member gets asserted.
  it('accepts every view in the union, including player', () => {
    const views = ['grid', 'seasons', 'episodes', 'queue', 'player'] as const

    for (const view of views) {
      const { gateway, socket } = buildConnectedGateway()
      gateway.handleTabletState(asClientSocket(socket), {
        ...VALID_TABLET_STATE,
        view,
      })

      expect(rosterOf(gateway).get(CLIENT_A_ID)?.tablet).toEqual({
        ...VALID_TABLET_STATE,
        view,
      })
    }
  })

  it('drops a second update sent before TABLET_STATE_MIN_INTERVAL_MS elapses, and accepts a third sent after the floor elapses from the first accepted one', () => {
    const { gateway, socket } = buildConnectedGateway()
    const nowSpy = jest.spyOn(Date, 'now')

    nowSpy.mockReturnValue(2_000)
    gateway.handleTabletState(asClientSocket(socket), {
      ...VALID_TABLET_STATE,
      scrollTop: 1,
    })
    expect(socket.roomEmit).toHaveBeenCalledTimes(1)

    nowSpy.mockReturnValue(2_000 + TABLET_STATE_MIN_INTERVAL_MS - 1)
    gateway.handleTabletState(asClientSocket(socket), {
      ...VALID_TABLET_STATE,
      scrollTop: 2,
    })
    expect(socket.roomEmit).toHaveBeenCalledTimes(1)
    expect(rosterOf(gateway).get(CLIENT_A_ID)?.tablet?.scrollTop).toBe(1)

    nowSpy.mockReturnValue(2_000 + TABLET_STATE_MIN_INTERVAL_MS)
    gateway.handleTabletState(asClientSocket(socket), {
      ...VALID_TABLET_STATE,
      scrollTop: 3,
    })
    expect(socket.roomEmit).toHaveBeenCalledTimes(2)
    expect(rosterOf(gateway).get(CLIENT_A_ID)?.tablet?.scrollTop).toBe(3)
  })
})

describe('PresenceGateway.handleDisconnect', () => {
  it('removes a connected client from the roster and broadcasts peer:leave', () => {
    const { gateway, socket } = buildConnectedGateway()

    gateway.handleDisconnect(asClientSocket(socket))

    expect(rosterOf(gateway).has(CLIENT_A_ID)).toBe(false)
    expect(socket.to).toHaveBeenCalledWith(THEATER_ROOM)
    expect(socket.roomEmit).toHaveBeenCalledWith('peer:leave', {
      id: CLIENT_A_ID,
    })
  })

  it('does not broadcast peer:leave for a client that never authenticated (never entered the roster)', () => {
    const { gateway } = buildGateway()
    const neverAuthed = createMockSocket('never-authed')

    gateway.handleDisconnect(asClientSocket(neverAuthed))

    expect(neverAuthed.roomEmit).not.toHaveBeenCalled()
    expect(neverAuthed.to).not.toHaveBeenCalled()
  })
})

describe('PresenceGateway.handleSeatClaim', () => {
  it('claiming a free seat succeeds, acks { ok: true }, updates the roster seatId, and broadcasts peer:seat to the room excluding the sender', () => {
    const { gateway, server, socket } = buildConnectedGateway()

    const ack = gateway.handleSeatClaim(asClientSocket(socket), {
      seatId: 'r0s0',
    })

    expect(ack).toEqual({ ok: true })
    expect(rosterOf(gateway).get(CLIENT_A_ID)?.seatId).toBe('r0s0')
    // Seat broadcasts mirror the existing peer:presence/peer:mute/peer:tablet
    // convention: `client.to(ROOM)`, i.e. the SENDER is excluded — unlike
    // video/queue state, which must reach the sender too (see the
    // `handleVideoCommand` describe block below). `server.toEmit` staying
    // uncalled confirms this handler never reaches for the other pattern.
    expect(socket.to).toHaveBeenCalledWith(THEATER_ROOM)
    expect(socket.roomEmit).toHaveBeenCalledWith('peer:seat', {
      id: CLIENT_A_ID,
      seatId: 'r0s0',
    })
    expect(server.toEmit).not.toHaveBeenCalled()
  })

  it('claiming a seat another peer already holds is rejected as taken, and does not disturb the holder or emit peer:seat for either socket', () => {
    const { gateway, clientA, clientB } = buildGatewayWithTwoPeers()

    const firstAck = gateway.handleSeatClaim(asClientSocket(clientA), {
      seatId: 'r1s2',
    })
    expect(firstAck).toEqual({ ok: true })

    clientA.to.mockClear()
    clientA.roomEmit.mockClear()

    const secondAck = gateway.handleSeatClaim(asClientSocket(clientB), {
      seatId: 'r1s2',
    })

    expect(secondAck).toEqual({ ok: false, reason: 'taken' })
    expect(rosterOf(gateway).get(CLIENT_A_ID)?.seatId).toBe('r1s2')
    expect(rosterOf(gateway).get(CLIENT_B_ID)?.seatId).toBeNull()
    expect(clientA.roomEmit).not.toHaveBeenCalled()
    expect(clientB.roomEmit).not.toHaveBeenCalled()
  })

  it('claiming an unknown seatId is rejected as unknown, and is never stored', () => {
    const { gateway, socket } = buildConnectedGateway()

    const ack = gateway.handleSeatClaim(asClientSocket(socket), {
      seatId: 'r9s9',
    })

    expect(ack).toEqual({ ok: false, reason: 'unknown' })
    expect(rosterOf(gateway).get(CLIENT_A_ID)?.seatId).toBeNull()
    expect(socket.roomEmit).not.toHaveBeenCalled()
  })

  it('claiming a new seat while already seated frees the old seat (claimable by someone else afterward) and leaves the client holding only the new seat', () => {
    const { gateway, clientA, clientB } = buildGatewayWithTwoPeers()
    const nowSpy = jest.spyOn(Date, 'now')

    nowSpy.mockReturnValue(10_000)
    const firstClaim = gateway.handleSeatClaim(asClientSocket(clientA), {
      seatId: 'r0s0',
    })
    expect(firstClaim).toEqual({ ok: true })

    // seat:claim/seat:release share one rate-limit floor
    // (SEAT_CLAIM_MIN_INTERVAL_MS) per socket — advance past it so this
    // second claim from the SAME socket is evaluated on its own merits
    // rather than dropped by the flood guard.
    nowSpy.mockReturnValue(10_000 + SEAT_CLAIM_MIN_INTERVAL_MS)
    const secondClaim = gateway.handleSeatClaim(asClientSocket(clientA), {
      seatId: 'r0s1',
    })
    expect(secondClaim).toEqual({ ok: true })
    expect(rosterOf(gateway).get(CLIENT_A_ID)?.seatId).toBe('r0s1')

    // r0s0 must now be free.
    const claimByB = gateway.handleSeatClaim(asClientSocket(clientB), {
      seatId: 'r0s0',
    })
    expect(claimByB).toEqual({ ok: true })
    expect(rosterOf(gateway).get(CLIENT_B_ID)?.seatId).toBe('r0s0')
  })

  it('re-claiming a seat you already hold is a no-op success and does not re-broadcast peer:seat', () => {
    const { gateway, socket } = buildConnectedGateway()
    const nowSpy = jest.spyOn(Date, 'now')

    nowSpy.mockReturnValue(20_000)
    const firstClaim = gateway.handleSeatClaim(asClientSocket(socket), {
      seatId: 'r2s2',
    })
    expect(firstClaim).toEqual({ ok: true })

    socket.to.mockClear()
    socket.roomEmit.mockClear()

    nowSpy.mockReturnValue(20_000 + SEAT_CLAIM_MIN_INTERVAL_MS)
    const secondClaim = gateway.handleSeatClaim(asClientSocket(socket), {
      seatId: 'r2s2',
    })

    expect(secondClaim).toEqual({ ok: true })
    expect(rosterOf(gateway).get(CLIENT_A_ID)?.seatId).toBe('r2s2')
    expect(socket.roomEmit).not.toHaveBeenCalled()
  })
})

describe('PresenceGateway.handleSeatRelease', () => {
  it('releasing a held seat frees it, acks { ok: true }, broadcasts peer:seat with seatId: null, and lets someone else claim it', () => {
    const { gateway, clientA, clientB } = buildGatewayWithTwoPeers()
    const nowSpy = jest.spyOn(Date, 'now')

    nowSpy.mockReturnValue(30_000)
    gateway.handleSeatClaim(asClientSocket(clientA), { seatId: 'r5s6' })

    clientA.to.mockClear()
    clientA.roomEmit.mockClear()

    nowSpy.mockReturnValue(30_000 + SEAT_CLAIM_MIN_INTERVAL_MS)
    const ack = gateway.handleSeatRelease(asClientSocket(clientA))

    expect(ack).toEqual({ ok: true })
    expect(rosterOf(gateway).get(CLIENT_A_ID)?.seatId).toBeNull()
    expect(clientA.to).toHaveBeenCalledWith(THEATER_ROOM)
    expect(clientA.roomEmit).toHaveBeenCalledWith('peer:seat', {
      id: CLIENT_A_ID,
      seatId: null,
    })

    const claimByB = gateway.handleSeatClaim(asClientSocket(clientB), {
      seatId: 'r5s6',
    })
    expect(claimByB).toEqual({ ok: true })
  })
})

describe('PresenceGateway.handleDisconnect — seat cleanup', () => {
  it('disconnecting a seated client frees the seat and broadcasts peer:seat with seatId: null, and a different client can then claim it', () => {
    const { gateway, authService } = buildGateway()
    const clientA = connectClient(gateway, authService, {
      id: CLIENT_A_ID,
      username: CLIENT_A_USERNAME,
      characterId: CHARACTER_ID_A,
    })
    const clientB = connectClient(gateway, authService, {
      id: CLIENT_B_ID,
      username: CLIENT_B_USERNAME,
      characterId: CHARACTER_ID_B,
    })

    const claimAck = gateway.handleSeatClaim(asClientSocket(clientA), {
      seatId: 'r3s4',
    })
    expect(claimAck).toEqual({ ok: true })

    clientA.to.mockClear()
    clientA.roomEmit.mockClear()

    gateway.handleDisconnect(asClientSocket(clientA))

    // PLAN.md calls a leaked seat "the single most likely bug in the
    // phase" — assert the broadcast directly, not just indirectly through
    // the re-claim below.
    expect(clientA.to).toHaveBeenCalledWith(THEATER_ROOM)
    expect(clientA.roomEmit).toHaveBeenCalledWith('peer:seat', {
      id: CLIENT_A_ID,
      seatId: null,
    })

    const claimByB = gateway.handleSeatClaim(asClientSocket(clientB), {
      seatId: 'r3s4',
    })
    expect(claimByB).toEqual({ ok: true })
    expect(rosterOf(gateway).get(CLIENT_B_ID)?.seatId).toBe('r3s4')
  })
})

describe('PresenceGateway.handleVideoCommand — enqueue', () => {
  it('enqueuing into an empty room sets the cursor, starts playback, and broadcasts video:state + queue:state to the whole room INCLUDING the sender', () => {
    const { gateway, server, clientA } = buildGatewayWithTwoPeers()
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValue(50_000)

    gateway.handleVideoCommand(asClientSocket(clientA), {
      kind: 'enqueue',
      entry: VALID_ENQUEUE_ENTRY,
    })

    // The decisive check for "sender included": the broadcast goes out via
    // `this.server.to(...)`, never the sender-relative `client.to(...)`. A
    // regression to `client.to()` would still make it LOOK correct in a
    // test that only checks "did the OTHER peer receive it" (clientB would
    // still get it in real Socket.IO) — the only reliable proof the sender
    // itself is included is that the sender's own `.to` was never invoked
    // for this broadcast.
    expect(server.to).toHaveBeenCalledWith(THEATER_ROOM)
    expect(clientA.to).not.toHaveBeenCalled()

    const queueStateCall = server.toEmit.mock.calls.find(
      ([event]) => event === 'queue:state',
    )
    expect(queueStateCall).toBeDefined()
    const queue = (queueStateCall?.[1] as { queue: QueueEntry[] } | undefined)
      ?.queue
    expect(queue).toHaveLength(1)
    const entry = queue?.[0]
    expect(entry).toEqual({
      entryId: expect.any(String),
      itemId: VALID_ENQUEUE_ENTRY.itemId,
      title: VALID_ENQUEUE_ENTRY.title,
      subtitle: VALID_ENQUEUE_ENTRY.subtitle,
      imageTag: VALID_ENQUEUE_ENTRY.imageTag,
      runTimeTicks: VALID_ENQUEUE_ENTRY.runTimeTicks,
      addedBy: CLIENT_A_USERNAME,
    })

    expect(server.toEmit).toHaveBeenCalledWith('video:state', {
      currentEntryId: entry?.entryId,
      currentItemId: VALID_ENQUEUE_ENTRY.itemId,
      playing: true,
      playhead: 0,
    })
  })
})

describe('PresenceGateway.handleVideoCommand — next dedup', () => {
  it('a next command whose afterEntryId does not match the current cursor is silently ignored (no state change, no broadcast)', () => {
    const { gateway, authService, server } = buildGateway()
    const clientA = connectClient(gateway, authService, {
      id: CLIENT_A_ID,
      username: CLIENT_A_USERNAME,
      characterId: CHARACTER_ID_A,
    })
    const nowSpy = jest.spyOn(Date, 'now')

    nowSpy.mockReturnValue(300_000)
    gateway.handleVideoCommand(asClientSocket(clientA), {
      kind: 'enqueue',
      entry: VALID_ENQUEUE_ENTRY,
    })

    const enqueueQueueCall = server.toEmit.mock.calls.find(
      ([event]) => event === 'queue:state',
    )
    const originalEntryId = (
      enqueueQueueCall?.[1] as { queue: QueueEntry[] } | undefined
    )?.queue[0]?.entryId
    expect(originalEntryId).toEqual(expect.any(String))

    server.to.mockClear()
    server.toEmit.mockClear()

    // Advance past VIDEO_COMMAND_MIN_INTERVAL_MS so the rejection below is
    // provably the gateway's own `afterEntryId` dedup check, not the
    // rate-limit floor rejecting a too-fast second command.
    nowSpy.mockReturnValue(300_000 + VIDEO_COMMAND_MIN_INTERVAL_MS)
    gateway.handleVideoCommand(asClientSocket(clientA), {
      kind: 'next',
      afterEntryId: 'not-the-current-entry-id',
    })

    expect(server.to).not.toHaveBeenCalled()
    expect(server.toEmit).not.toHaveBeenCalled()

    // No state change either, not just no broadcast: a late joiner
    // (video:request'ing the room's current state, per
    // handleVideoRequest) still sees the ORIGINAL entry as current —
    // neither advanced nor cleared.
    const clientB = connectClient(gateway, authService, {
      id: CLIENT_B_ID,
      username: CLIENT_B_USERNAME,
      characterId: CHARACTER_ID_B,
    })
    gateway.handleVideoRequest(asClientSocket(clientB))
    const videoStateCall = clientB.emit.mock.calls.find(
      ([event]) => event === 'video:state',
    )
    expect(
      (videoStateCall?.[1] as { currentEntryId: string | null } | undefined)
        ?.currentEntryId,
    ).toBe(originalEntryId)
  })
})

describe('PresenceGateway.handleConnection — no longer pushes video/queue state', () => {
  // Bugfix regression guard: `handleConnection` used to also
  // `client.emit('video:state', ...)` / `client.emit('queue:state', ...)`
  // directly, alongside `peers:init` — confirmed (against a real
  // socket.io-client round trip, not just this mocked unit test) to be
  // silently dropped 100% of the time, since the browser client doesn't
  // attach its `video:state`/`queue:state` listeners until AFTER `connect`
  // fires, strictly later than this synchronous emit. `handleVideoRequest`
  // (its own describe block below) is the replacement: the client explicitly
  // pulls once its listeners are actually attached. This test locks in the
  // absence of the old, silently-broken push so it can't quietly come back.
  it('sends peers:init but NOT video:state or queue:state on connect, even when the room already has queue/video state', () => {
    const { gateway, authService } = buildGateway()
    const clientA = connectClient(gateway, authService, {
      id: CLIENT_A_ID,
      username: CLIENT_A_USERNAME,
      characterId: CHARACTER_ID_A,
    })

    gateway.handleVideoCommand(asClientSocket(clientA), {
      kind: 'enqueue',
      entry: VALID_ENQUEUE_ENTRY,
    })

    const clientB = connectClient(gateway, authService, {
      id: CLIENT_B_ID,
      username: CLIENT_B_USERNAME,
      characterId: CHARACTER_ID_B,
    })

    expect(
      clientB.emit.mock.calls.find(([event]) => event === 'peers:init'),
    ).toBeDefined()
    expect(
      clientB.emit.mock.calls.find(([event]) => event === 'video:state'),
    ).toBeUndefined()
    expect(
      clientB.emit.mock.calls.find(([event]) => event === 'queue:state'),
    ).toBeUndefined()
  })
})

describe('PresenceGateway.handleVideoRequest', () => {
  it("responds with video:state AND queue:state reflecting the room's current state, sent only to the requester", () => {
    const { gateway, server, clientA, clientB } = buildGatewayWithTwoPeers()

    gateway.handleVideoCommand(asClientSocket(clientA), {
      kind: 'enqueue',
      entry: VALID_ENQUEUE_ENTRY,
    })
    server.to.mockClear()
    server.toEmit.mockClear()
    clientB.emit.mockClear()

    gateway.handleVideoRequest(asClientSocket(clientB))

    const videoStateCall = clientB.emit.mock.calls.find(
      ([event]) => event === 'video:state',
    )
    const queueStateCall = clientB.emit.mock.calls.find(
      ([event]) => event === 'queue:state',
    )

    expect(videoStateCall).toBeDefined()
    expect(queueStateCall).toBeDefined()
    expect(
      (queueStateCall?.[1] as { queue: QueueEntry[] } | undefined)?.queue,
    ).toHaveLength(1)
    expect(videoStateCall?.[1]).toMatchObject({
      currentItemId: VALID_ENQUEUE_ENTRY.itemId,
      playing: true,
    })
    expect(
      (videoStateCall?.[1] as { currentEntryId: string | null } | undefined)
        ?.currentEntryId,
    ).not.toBeNull()
    // Never broadcast — this is a reply to the ONE asking socket, unlike
    // every video:command-driven broadcast above.
    expect(server.to).not.toHaveBeenCalled()
    expect(server.toEmit).not.toHaveBeenCalled()
  })

  it('does nothing for a socket that never authenticated (never entered the roster)', () => {
    const { gateway } = buildGateway()
    const neverAuthed = createMockSocket('never-authed')

    expect(() =>
      gateway.handleVideoRequest(asClientSocket(neverAuthed)),
    ).not.toThrow()
    expect(neverAuthed.emit).not.toHaveBeenCalled()
  })

  it('rate-limits like video:command: drops a second request sent before VIDEO_COMMAND_MIN_INTERVAL_MS elapses, and accepts a third sent after the floor elapses', () => {
    const { gateway, socket } = buildConnectedGateway()
    const nowSpy = jest.spyOn(Date, 'now')

    nowSpy.mockReturnValue(400_000)
    gateway.handleVideoRequest(asClientSocket(socket))
    expect(
      socket.emit.mock.calls.filter(([event]) => event === 'video:state'),
    ).toHaveLength(1)

    nowSpy.mockReturnValue(400_000 + VIDEO_COMMAND_MIN_INTERVAL_MS - 1)
    gateway.handleVideoRequest(asClientSocket(socket))
    expect(
      socket.emit.mock.calls.filter(([event]) => event === 'video:state'),
    ).toHaveLength(1)

    nowSpy.mockReturnValue(400_000 + VIDEO_COMMAND_MIN_INTERVAL_MS)
    gateway.handleVideoRequest(asClientSocket(socket))
    expect(
      socket.emit.mock.calls.filter(([event]) => event === 'video:state'),
    ).toHaveLength(2)
  })

  it('shares its rate-limit floor with video:command (a request right after a command can be dropped, and vice versa)', () => {
    const { gateway, socket } = buildConnectedGateway()
    const nowSpy = jest.spyOn(Date, 'now')

    // Consumes the shared floor via `video:command`, not `video:request` —
    // proving the two share state, not just that each independently
    // rate-limits itself.
    nowSpy.mockReturnValue(500_000)
    gateway.handleVideoCommand(asClientSocket(socket), { kind: 'play' })

    nowSpy.mockReturnValue(500_000 + VIDEO_COMMAND_MIN_INTERVAL_MS - 1)
    gateway.handleVideoRequest(asClientSocket(socket))
    expect(
      socket.emit.mock.calls.filter(([event]) => event === 'video:state'),
    ).toHaveLength(0)

    nowSpy.mockReturnValue(500_000 + VIDEO_COMMAND_MIN_INTERVAL_MS)
    gateway.handleVideoRequest(asClientSocket(socket))
    expect(
      socket.emit.mock.calls.filter(([event]) => event === 'video:state'),
    ).toHaveLength(1)
  })
})

describe('PresenceGateway — playback anchor / playhead reporting', () => {
  it("a playing room's reported playhead advances across two broadcasts separated by elapsed time", () => {
    const { gateway, authService, server } = buildGateway()
    const clientA = connectClient(gateway, authService, {
      id: CLIENT_A_ID,
      username: CLIENT_A_USERNAME,
      characterId: CHARACTER_ID_A,
    })
    const nowSpy = jest.spyOn(Date, 'now')

    nowSpy.mockReturnValue(100_000)
    gateway.handleVideoCommand(asClientSocket(clientA), { kind: 'play' })

    const firstCall = server.toEmit.mock.calls.find(
      ([event]) => event === 'video:state',
    )
    const firstPlayhead = (firstCall?.[1] as { playhead: number } | undefined)
      ?.playhead

    nowSpy.mockReturnValue(100_000 + 2_500)
    const clientB = connectClient(gateway, authService, {
      id: CLIENT_B_ID,
      username: CLIENT_B_USERNAME,
      characterId: CHARACTER_ID_B,
    })
    gateway.handleVideoRequest(asClientSocket(clientB))
    const secondCall = clientB.emit.mock.calls.find(
      ([event]) => event === 'video:state',
    )
    const secondPlayhead = (secondCall?.[1] as { playhead: number } | undefined)
      ?.playhead

    expect(firstPlayhead).toBe(0)
    expect(secondPlayhead).toBeGreaterThan(firstPlayhead ?? 0)
    expect(secondPlayhead).toBeCloseTo(2.5, 5)
  })

  it("a paused room's reported playhead does not advance across the same kind of elapsed time", () => {
    const { gateway, authService, server } = buildGateway()
    const clientA = connectClient(gateway, authService, {
      id: CLIENT_A_ID,
      username: CLIENT_A_USERNAME,
      characterId: CHARACTER_ID_A,
    })
    const nowSpy = jest.spyOn(Date, 'now')

    nowSpy.mockReturnValue(200_000)
    gateway.handleVideoCommand(asClientSocket(clientA), { kind: 'play' })

    nowSpy.mockReturnValue(200_000 + 1_000)
    gateway.handleVideoCommand(asClientSocket(clientA), { kind: 'pause' })

    const pauseCall = server.toEmit.mock.calls
      .filter(([event]) => event === 'video:state')
      .pop()
    const pausedPlayhead = (pauseCall?.[1] as { playhead: number } | undefined)
      ?.playhead
    expect(pausedPlayhead).toBeCloseTo(1, 5)

    nowSpy.mockReturnValue(200_000 + 1_000 + 5_000)
    const clientB = connectClient(gateway, authService, {
      id: CLIENT_B_ID,
      username: CLIENT_B_USERNAME,
      characterId: CHARACTER_ID_B,
    })
    gateway.handleVideoRequest(asClientSocket(clientB))
    const videoStateCall = clientB.emit.mock.calls.find(
      ([event]) => event === 'video:state',
    )

    expect(
      (videoStateCall?.[1] as { playing: boolean } | undefined)?.playing,
    ).toBe(false)
    expect(
      (videoStateCall?.[1] as { playhead: number } | undefined)?.playhead,
    ).toBeCloseTo(pausedPlayhead ?? -1, 5)
  })
})
