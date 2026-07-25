import type { AuthService } from 'src/auth/auth.service'
import {
  PRESENCE_MIN_INTERVAL_MS,
  RTC_ICE_MIN_INTERVAL_MS,
  TABLET_STATE_MIN_INTERVAL_MS,
  THEATER_ROOM,
  VALID_CHARACTER_ID_LIST,
} from 'src/presence/presence.constants'
import {
  type PeerSnapshot,
  PresenceGateway,
} from 'src/presence/presence.gateway'
import type { TabletState } from 'src/presence/tablet.schema'

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
}

const DEFAULT_SNAPSHOT_B: PeerSnapshot = {
  id: CLIENT_B_ID,
  username: CLIENT_B_USERNAME,
  characterId: CHARACTER_ID_B,
  p: [0, 0, 0],
  y: 0,
  a: 'idle',
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

  it('drops a malformed body (view outside the 3 valid values), without throwing or mutating the roster', () => {
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
