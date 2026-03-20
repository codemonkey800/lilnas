import type { ReactNode } from 'react'
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

import { LidarrDownloadSocket } from './socket'
import type {
  DownloadEventMap,
  DownloadEventName,
  LidarrClientOptions,
} from './types'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface LidarrSocketContextValue {
  socket: LidarrDownloadSocket | null
  connected: boolean
}

const LidarrSocketContext = createContext<LidarrSocketContextValue | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface LidarrSocketProviderProps {
  baseUrl: string
  token: string
  children: ReactNode
}

/**
 * Creates and owns a `LidarrDownloadSocket` for the duration of its mount.
 * Exposes the socket and connection status to all descendants via context.
 *
 * Usage:
 * ```tsx
 * <LidarrSocketProvider baseUrl="https://lidarr.lilnas.io" token="my-token">
 *   <DownloadMonitor />
 * </LidarrSocketProvider>
 * ```
 */
export function LidarrSocketProvider({
  baseUrl,
  token,
  children,
}: LidarrSocketProviderProps): ReactNode {
  const [socket, setSocket] = useState<LidarrDownloadSocket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const options: LidarrClientOptions = { baseUrl, token }
    const newSocket = new LidarrDownloadSocket(options)
    setSocket(newSocket)

    newSocket.onConnect(() => setConnected(true))
    newSocket.onDisconnect(() => setConnected(false))
    newSocket.onError(() => setConnected(false))

    return () => {
      newSocket.disconnect()
      setSocket(null)
      setConnected(false)
    }
  }, [baseUrl, token])

  return createElement(
    LidarrSocketContext.Provider,
    { value: { socket, connected } },
    children,
  )
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Returns `{ socket, connected }` from the nearest `LidarrSocketProvider`.
 * Throws if called outside a provider.
 */
export function useLidarrSocket(): LidarrSocketContextValue {
  const ctx = useContext(LidarrSocketContext)
  if (!ctx) {
    throw new Error(
      'useLidarrSocket must be used within a LidarrSocketProvider',
    )
  }
  return ctx
}

/**
 * Subscribes to a typed download event from the nearest `LidarrSocketProvider`.
 * The callback ref is kept stable so the subscription is not torn down and
 * re-established on every render when an inline function is passed.
 *
 * Usage:
 * ```tsx
 * useLidarrEvent('download:progress', (payload) => {
 *   console.log(payload.progress) // typed as DownloadProgressPayload
 * })
 * ```
 */
export function useLidarrEvent<E extends DownloadEventName>(
  event: E,
  callback: (payload: DownloadEventMap[E]) => void,
): void {
  const { socket } = useLidarrSocket()
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    if (!socket) return

    const handler = (payload: DownloadEventMap[E]) => {
      callbackRef.current(payload)
    }

    socket.on(event, handler)
    return () => {
      socket.off(event, handler)
    }
  }, [socket, event])
}
