import { io } from 'socket.io-client'

import type {
  DownloadEventMap,
  DownloadEventName,
  LidarrClientOptions,
} from './types'

interface RawEmitter {
  on(event: string, listener: (...args: unknown[]) => void): unknown
  off(event: string, listener?: (...args: unknown[]) => void): unknown
  get connected(): boolean
  disconnect(): void
}

/**
 * Typed Socket.IO client for the Lidarr `/downloads` WebSocket namespace.
 *
 * Authenticates via the `x-token-value` header on connection. The server
 * will disconnect any client that provides a missing or invalid token.
 *
 * Usage:
 * ```ts
 * const socket = new LidarrDownloadSocket({ baseUrl: '...', token: '...' })
 * socket.on('download:progress', payload => console.log(payload.progress))
 * socket.onDisconnect(reason => console.log('disconnected:', reason))
 * socket.disconnect()
 * ```
 */
export class LidarrDownloadSocket {
  private readonly socket: RawEmitter

  constructor(options: LidarrClientOptions) {
    const baseUrl = options.baseUrl.replace(/\/$/, '')
    this.socket = io(`${baseUrl}/downloads`, {
      extraHeaders: {
        'x-token-value': options.token,
      },
      transports: ['websocket'],
      autoConnect: true,
    }) as unknown as RawEmitter
  }

  /**
   * Registers a typed listener for a download event. The payload type is
   * inferred from the event name via `DownloadEventMap`.
   */
  on<E extends DownloadEventName>(
    event: E,
    listener: (payload: DownloadEventMap[E]) => void,
  ): this {
    this.socket.on(event, listener as (...args: unknown[]) => void)
    return this
  }

  /**
   * Removes a previously registered listener for a download event.
   * If no listener is provided, all listeners for that event are removed.
   */
  off<E extends DownloadEventName>(
    event: E,
    listener?: (payload: DownloadEventMap[E]) => void,
  ): this {
    this.socket.off(
      event,
      listener as ((...args: unknown[]) => void) | undefined,
    )
    return this
  }

  /** Returns true when the socket is currently connected. */
  get connected(): boolean {
    return this.socket.connected
  }

  /** Disconnects the socket from the server. */
  disconnect(): void {
    this.socket.disconnect()
  }

  /** Registers a listener for the socket `connect` lifecycle event. */
  onConnect(listener: () => void): this {
    this.socket.on('connect', listener as (...args: unknown[]) => void)
    return this
  }

  /** Registers a listener for the socket `disconnect` lifecycle event. */
  onDisconnect(listener: (reason: string) => void): this {
    this.socket.on('disconnect', listener as (...args: unknown[]) => void)
    return this
  }

  /** Registers a listener for the socket `connect_error` lifecycle event. */
  onError(listener: (err: Error) => void): this {
    this.socket.on('connect_error', listener as (...args: unknown[]) => void)
    return this
  }
}
