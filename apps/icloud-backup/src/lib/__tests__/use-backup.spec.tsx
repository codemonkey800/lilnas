import { act, renderHook } from '@testing-library/react'

import { ApiError } from 'src/lib/api'
import { useBackup } from 'src/lib/use-backup'

import { makeView } from './helpers/view'

class FakeSocket {
  static instances: FakeSocket[] = []

  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  close = jest.fn()

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  open(): void {
    this.onopen?.()
  }

  frame(data: unknown): void {
    this.onmessage?.({
      data: typeof data === 'string' ? data : JSON.stringify(data),
    })
  }

  drop(): void {
    this.onclose?.()
  }
}

const fetchMock = jest.fn()

/**
 * A stand-in for `Response`: a real body is read through timers that fake
 * timers freeze.
 */
function respond(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: () => Promise.resolve(body),
  } as Response
}

const last = (): FakeSocket => FakeSocket.instances.at(-1) as FakeSocket

/** Lets a resolved fetch and its `.then` chain settle under fake timers. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
  await settle()
}

const initial = makeView('queued_download')

beforeEach(() => {
  jest.useFakeTimers()
  FakeSocket.instances = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => Promise.resolve(respond(initial)))
  global.fetch = fetchMock
  // @ts-expect-error a minimal stand-in for the browser WebSocket
  global.WebSocket = FakeSocket
})

afterEach(() => {
  jest.useRealTimers()
  // @ts-expect-error remove the stubs again
  delete global.fetch
  // @ts-expect-error remove the stubs again
  delete global.WebSocket
})

describe('useBackup', () => {
  it('loads the view, then opens the socket on the page host', async () => {
    const { result } = renderHook(() => useBackup())
    expect(result.current.view).toBeNull()
    expect(FakeSocket.instances).toHaveLength(0)

    await settle()

    expect(result.current.view).toEqual(initial)
    expect(FakeSocket.instances).toHaveLength(1)
    expect(last().url).toBe(`ws://${window.location.host}/ws`)
  })

  it('is live only while the socket is open', async () => {
    const { result } = renderHook(() => useBackup())
    await settle()
    expect(result.current.live).toBe(false)

    act(() => last().open())
    expect(result.current.live).toBe(true)

    act(() => last().drop())
    expect(result.current.live).toBe(false)
  })

  it('replaces the view on a backup frame', async () => {
    const { result } = renderHook(() => useBackup())
    await settle()
    act(() => last().open())

    const next = makeView('downloading')
    act(() => last().frame({ type: 'backup', data: next }))

    expect(result.current.view).toEqual(next)
  })

  it('ignores a malformed frame', async () => {
    const { result } = renderHook(() => useBackup())
    await settle()
    act(() => last().open())

    act(() => last().frame('not json{'))
    act(() => last().frame({ type: 'other', data: makeView('done') }))
    act(() => last().frame({ type: 'backup', data: { nope: true } }))

    expect(result.current.view).toEqual(initial)
  })

  it('reconnects on the 1, 2, 5, 10, 30, 30 s ladder', async () => {
    renderHook(() => useBackup())
    await settle()
    expect(FakeSocket.instances).toHaveLength(1)

    // Each socket closes without ever opening, so the ladder keeps climbing.
    const ladder = [1000, 2000, 5000, 10_000, 30_000, 30_000]
    let expected = 1
    for (const delay of ladder) {
      act(() => last().drop())
      await advance(delay - 1)
      expect(FakeSocket.instances).toHaveLength(expected)
      await advance(1)
      expected++
      expect(FakeSocket.instances).toHaveLength(expected)
    }
  })

  it('starts the ladder over once a socket has opened', async () => {
    renderHook(() => useBackup())
    await settle()

    act(() => last().drop())
    await advance(1000)
    act(() => last().drop())
    await advance(2000)
    expect(FakeSocket.instances).toHaveLength(3)

    act(() => last().open())
    act(() => last().drop())
    await advance(1000)
    expect(FakeSocket.instances).toHaveLength(4)
  })

  it('refetches the view after each reconnect', async () => {
    const { result } = renderHook(() => useBackup())
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const fresh = makeView('done')
    fetchMock.mockImplementation(() => Promise.resolve(respond(fresh)))

    act(() => last().open())
    act(() => last().drop())
    await advance(1000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.view).toEqual(fresh)
  })

  it('keeps the last view when a refetch fails', async () => {
    const { result } = renderHook(() => useBackup())
    await settle()

    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')))
    act(() => last().drop())
    await advance(1000)

    expect(result.current.view).toEqual(initial)
    expect(result.current.error).toBeNull()
  })

  it('closes the socket and stops reconnecting on unmount', async () => {
    const { unmount } = renderHook(() => useBackup())
    await settle()
    const socket = last()
    act(() => socket.open())

    unmount()
    expect(socket.close).toHaveBeenCalled()

    // A close event after unmount must not schedule anything.
    socket.drop()
    await advance(60_000)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('cancels a pending reconnect on unmount', async () => {
    const { unmount } = renderHook(() => useBackup())
    await settle()
    act(() => last().drop())

    unmount()
    await advance(60_000)

    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('reports a failed first load and retries with reload', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(respond({ message: 'boom' }, 500)),
    )
    const { result } = renderHook(() => useBackup())
    await settle()

    expect(result.current.view).toBeNull()
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.status).toBe(500)
    expect(FakeSocket.instances).toHaveLength(0)

    act(() => result.current.actions.reload())
    await settle()

    expect(result.current.error).toBeNull()
    expect(result.current.view).toEqual(initial)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('sets the view returned by an action at once', async () => {
    const { result } = renderHook(() => useBackup())
    await settle()

    const next = makeView('need_code')
    fetchMock.mockImplementation(() => Promise.resolve(respond(next)))
    await act(async () => {
      await result.current.actions.submitPassword('pw')
    })

    expect(result.current.view).toEqual(next)
    const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
    expect(url).toBe('/api/backup/password')
    expect(JSON.parse(init.body as string)).toEqual({ password: 'pw' })
  })

  it('lets an action failure reach the caller and keeps the view', async () => {
    const { result } = renderHook(() => useBackup())
    await settle()

    fetchMock.mockImplementation(() =>
      Promise.resolve(respond({ message: 'busy' }, 409)),
    )
    await act(async () => {
      await expect(result.current.actions.sync()).rejects.toMatchObject({
        status: 409,
        message: 'busy',
      })
    })

    expect(result.current.view).toEqual(initial)
  })

  it('resetImmichPassword returns the password without touching the view', async () => {
    const { result } = renderHook(() => useBackup())
    await settle()

    fetchMock.mockImplementation(() =>
      Promise.resolve(respond({ password: 'a b c' })),
    )
    let password = ''
    await act(async () => {
      password = await result.current.actions.resetImmichPassword()
    })

    expect(password).toBe('a b c')
    expect(result.current.view).toEqual(initial)
  })
})
