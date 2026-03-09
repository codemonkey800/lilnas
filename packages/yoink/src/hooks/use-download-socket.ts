'use client'

import { useEffect } from 'react'

import { useSocket } from 'src/components/socket-provider'
import {
  DownloadEvents,
  type DownloadCancelledPayload,
  type DownloadCompletedPayload,
  type DownloadFailedPayload,
  type DownloadGrabbingPayload,
  type DownloadInitiatedPayload,
  type DownloadProgressPayload,
} from 'src/download/download.types'

export interface DownloadSocketHandlers {
  onInitiated?: (payload: DownloadInitiatedPayload) => void
  onGrabbing?: (payload: DownloadGrabbingPayload) => void
  onProgress?: (payload: DownloadProgressPayload) => void
  onFailed?: (payload: DownloadFailedPayload) => void
  onCancelled?: (payload: DownloadCancelledPayload) => void
  onCompleted?: (payload: DownloadCompletedPayload) => void
}

/**
 * Subscribes to all Socket.IO download lifecycle events and calls the
 * provided handlers. Automatically unsubscribes on unmount. Handlers that
 * are undefined are ignored.
 */
export function useDownloadSocket(handlers: DownloadSocketHandlers): void {
  const socket = useSocket()

  useEffect(() => {
    if (!socket) return

    const { onInitiated, onGrabbing, onProgress, onFailed, onCancelled, onCompleted } =
      handlers

    if (onInitiated) socket.on(DownloadEvents.INITIATED, onInitiated)
    if (onGrabbing) socket.on(DownloadEvents.GRABBING, onGrabbing)
    if (onProgress) socket.on(DownloadEvents.PROGRESS, onProgress)
    if (onFailed) socket.on(DownloadEvents.FAILED, onFailed)
    if (onCancelled) socket.on(DownloadEvents.CANCELLED, onCancelled)
    if (onCompleted) socket.on(DownloadEvents.COMPLETED, onCompleted)

    return () => {
      if (onInitiated) socket.off(DownloadEvents.INITIATED, onInitiated)
      if (onGrabbing) socket.off(DownloadEvents.GRABBING, onGrabbing)
      if (onProgress) socket.off(DownloadEvents.PROGRESS, onProgress)
      if (onFailed) socket.off(DownloadEvents.FAILED, onFailed)
      if (onCancelled) socket.off(DownloadEvents.CANCELLED, onCancelled)
      if (onCompleted) socket.off(DownloadEvents.COMPLETED, onCompleted)
    }
  // Handlers object changes every render; this is intentional -- callers must
  // memoize their handler functions if they care about stability.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, handlers.onInitiated, handlers.onGrabbing, handlers.onProgress, handlers.onFailed, handlers.onCancelled, handlers.onCompleted])
}
