import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createElement } from 'react'

import {
  LidarrSocketProvider,
  useLidarrEvent,
  useLidarrSocket,
} from 'src/react'
import { LidarrDownloadSocket } from 'src/socket'
import type { DownloadProgressPayload } from 'src/types'

// ---------------------------------------------------------------------------
// Mock LidarrDownloadSocket
// ---------------------------------------------------------------------------

jest.mock('src/socket')

const MockLidarrDownloadSocket = LidarrDownloadSocket as jest.MockedClass<
  typeof LidarrDownloadSocket
>

interface MockSocketInstance {
  onConnect: jest.Mock
  onDisconnect: jest.Mock
  onError: jest.Mock
  disconnect: jest.Mock
  on: jest.Mock
  off: jest.Mock
  connected: boolean
}

function makeMockSocket(): MockSocketInstance {
  return {
    onConnect: jest.fn(),
    onDisconnect: jest.fn(),
    onError: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn().mockReturnThis(),
    off: jest.fn().mockReturnThis(),
    connected: false,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = 'https://lidarr.test'
const TOKEN = 'test-token'

function makeWrapper(
  baseUrl = BASE_URL,
  token = TOKEN,
): ({ children }: { children: ReactNode }) => ReactNode {
  return ({ children }: { children: ReactNode }) =>
    createElement(LidarrSocketProvider, { baseUrl, token, children })
}

/** Grabs the callback registered via mockSocket.onConnect / onDisconnect / onError */
function getCb(mock: jest.Mock): () => void {
  const call = mock.mock.calls[0] as [() => void] | undefined
  if (!call) throw new Error('Callback not registered')
  return call[0]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LidarrSocketProvider', () => {
  let mockSocket: MockSocketInstance

  beforeEach(() => {
    mockSocket = makeMockSocket()
    MockLidarrDownloadSocket.mockImplementation(
      () => mockSocket as unknown as LidarrDownloadSocket,
    )
  })

  it('creates a LidarrDownloadSocket with the provided options', () => {
    renderHook(() => useLidarrSocket(), { wrapper: makeWrapper() })

    expect(MockLidarrDownloadSocket).toHaveBeenCalledWith({
      baseUrl: BASE_URL,
      token: TOKEN,
    })
  })

  it('disconnects the socket when unmounted', () => {
    const { unmount } = renderHook(() => useLidarrSocket(), {
      wrapper: makeWrapper(),
    })

    unmount()

    expect(mockSocket.disconnect).toHaveBeenCalledTimes(1)
  })

  it('recreates the socket when baseUrl changes', () => {
    const firstSocket = makeMockSocket()
    const secondSocket = makeMockSocket()
    MockLidarrDownloadSocket.mockImplementationOnce(
      () => firstSocket as unknown as LidarrDownloadSocket,
    ).mockImplementationOnce(
      () => secondSocket as unknown as LidarrDownloadSocket,
    )

    const { rerender } = renderHook(() => useLidarrSocket(), {
      wrapper: makeWrapper(),
    })

    expect(MockLidarrDownloadSocket).toHaveBeenCalledTimes(1)

    rerender()

    expect(MockLidarrDownloadSocket).toHaveBeenCalledTimes(1)

    // Switch to a different component instance with new baseUrl
    const { unmount } = renderHook(() => useLidarrSocket(), {
      wrapper: makeWrapper('https://other.test', TOKEN),
    })

    expect(MockLidarrDownloadSocket).toHaveBeenCalledTimes(2)
    expect(MockLidarrDownloadSocket).toHaveBeenLastCalledWith({
      baseUrl: 'https://other.test',
      token: TOKEN,
    })

    unmount()
    expect(secondSocket.disconnect).toHaveBeenCalledTimes(1)
  })

  it('sets connected to true when onConnect fires', () => {
    const { result } = renderHook(() => useLidarrSocket(), {
      wrapper: makeWrapper(),
    })

    expect(result.current.connected).toBe(false)

    act(() => {
      getCb(mockSocket.onConnect)()
    })

    expect(result.current.connected).toBe(true)
  })

  it('sets connected to false when onDisconnect fires', () => {
    const { result } = renderHook(() => useLidarrSocket(), {
      wrapper: makeWrapper(),
    })

    act(() => {
      getCb(mockSocket.onConnect)()
    })
    expect(result.current.connected).toBe(true)

    act(() => {
      getCb(mockSocket.onDisconnect)()
    })
    expect(result.current.connected).toBe(false)
  })

  it('sets connected to false when onError fires', () => {
    const { result } = renderHook(() => useLidarrSocket(), {
      wrapper: makeWrapper(),
    })

    act(() => {
      getCb(mockSocket.onConnect)()
    })
    expect(result.current.connected).toBe(true)

    act(() => {
      getCb(mockSocket.onError)()
    })
    expect(result.current.connected).toBe(false)
  })
})

describe('useLidarrSocket', () => {
  it('throws when called outside a LidarrSocketProvider', () => {
    const { result } = renderHook(() => {
      try {
        return useLidarrSocket()
      } catch (e) {
        return e as Error
      }
    })

    expect(result.current).toBeInstanceOf(Error)
    expect((result.current as Error).message).toMatch(/LidarrSocketProvider/)
  })

  it('returns socket and connected from the provider context', () => {
    const mockSocket: MockSocketInstance = makeMockSocket()
    MockLidarrDownloadSocket.mockImplementation(
      () => mockSocket as unknown as LidarrDownloadSocket,
    )

    const { result } = renderHook(() => useLidarrSocket(), {
      wrapper: makeWrapper(),
    })

    expect(result.current.connected).toBe(false)
    expect(result.current.socket).toBeDefined()
  })
})

describe('useLidarrEvent', () => {
  let mockSocket: MockSocketInstance

  beforeEach(() => {
    mockSocket = makeMockSocket()
    MockLidarrDownloadSocket.mockImplementation(
      () => mockSocket as unknown as LidarrDownloadSocket,
    )
  })

  it('subscribes to the event on mount', () => {
    const cb = jest.fn()
    renderHook(() => useLidarrEvent('download:progress', cb), {
      wrapper: makeWrapper(),
    })

    expect(mockSocket.on).toHaveBeenCalledWith(
      'download:progress',
      expect.any(Function),
    )
  })

  it('unsubscribes from the event on unmount', () => {
    const cb = jest.fn()
    const { unmount } = renderHook(
      () => useLidarrEvent('download:progress', cb),
      { wrapper: makeWrapper() },
    )

    const [, handler] = mockSocket.on.mock.calls[0] as [
      string,
      (p: unknown) => void,
    ]

    unmount()

    expect(mockSocket.off).toHaveBeenCalledWith('download:progress', handler)
  })

  it('calls the callback with the typed payload when the event fires', () => {
    const cb = jest.fn()
    renderHook(() => useLidarrEvent('download:progress', cb), {
      wrapper: makeWrapper(),
    })

    const [, handler] = mockSocket.on.mock.calls[0] as [
      string,
      (p: DownloadProgressPayload) => void,
    ]

    const payload: DownloadProgressPayload = {
      event: 'download:progress',
      mediaType: 'movie',
      tmdbId: 42,
      progress: 75,
      size: 1000,
      sizeleft: 250,
      eta: null,
      status: 'downloading',
    }

    act(() => {
      handler(payload)
    })

    expect(cb).toHaveBeenCalledWith(payload)
  })

  it('always calls the latest callback without re-subscribing', () => {
    const cb1 = jest.fn()
    const cb2 = jest.fn()

    const { rerender } = renderHook(
      ({ callback }: { callback: jest.Mock }) =>
        useLidarrEvent('download:progress', callback),
      {
        wrapper: makeWrapper(),
        initialProps: { callback: cb1 },
      },
    )

    // Rerender with a new callback identity
    rerender({ callback: cb2 })

    // socket.on should only have been called once (no re-subscribe)
    expect(mockSocket.on).toHaveBeenCalledTimes(1)

    // Trigger the event -- the latest callback (cb2) should be called
    const [, handler] = mockSocket.on.mock.calls[0] as [
      string,
      (p: DownloadProgressPayload) => void,
    ]

    const payload: DownloadProgressPayload = {
      event: 'download:progress',
      mediaType: 'movie',
      progress: 50,
      size: 1000,
      sizeleft: 500,
      eta: null,
      status: 'downloading',
    }

    act(() => {
      handler(payload)
    })

    expect(cb1).not.toHaveBeenCalled()
    expect(cb2).toHaveBeenCalledWith(payload)
  })

  it('re-subscribes when the event name changes', () => {
    const cb = jest.fn()

    type EventProps = { event: 'download:progress' | 'download:completed' }
    const { rerender } = renderHook(
      ({ event }: EventProps) => useLidarrEvent(event, cb),
      {
        wrapper: makeWrapper(),
        initialProps: { event: 'download:progress' } as EventProps,
      },
    )

    expect(mockSocket.on).toHaveBeenCalledTimes(1)
    expect(mockSocket.on).toHaveBeenCalledWith(
      'download:progress',
      expect.any(Function),
    )

    rerender({ event: 'download:completed' })

    expect(mockSocket.off).toHaveBeenCalledTimes(1)
    expect(mockSocket.on).toHaveBeenCalledTimes(2)
    expect(mockSocket.on).toHaveBeenLastCalledWith(
      'download:completed',
      expect.any(Function),
    )
  })
})
