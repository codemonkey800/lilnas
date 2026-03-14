'use client'

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react'
import { io, type Socket } from 'socket.io-client'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL

const SocketContext = createContext<Socket | null>(null)

const SOCKET_OPTS = {
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket] = useState<Socket>(() =>
    // When NEXT_PUBLIC_WS_URL is set (dev), connect to explicit backend URL.
    // When unset (production), connect to same origin via reverse proxy.
    WS_URL
      ? io(`${WS_URL}/downloads`, SOCKET_OPTS)
      : io('/downloads', SOCKET_OPTS),
  )

  useEffect(() => {
    return () => {
      socket.disconnect()
    }
  }, [socket])

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  )
}

export function useSocket(): Socket | null {
  return useContext(SocketContext)
}
