'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ApiError,
  cancelBackup,
  getBackup,
  resetImmichPassword,
  startBackup,
  submitCode,
  submitPassword,
  syncBackup,
} from 'src/lib/api'
import { type BackupView, ServerMessageSchema } from 'src/shared/contract'

/** Wait before each reconnect attempt; the last entry repeats. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000] as const

/** The page's own host: `wss:` on https, `ws:` otherwise. */
export function backupSocketUrl(
  location: Pick<Location, 'host' | 'protocol'>,
): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}/ws`
}

/** Every call throws `ApiError` on failure and sets the view on success. */
export interface BackupActions {
  start: (appleId: string) => Promise<BackupView>
  sync: () => Promise<BackupView>
  submitPassword: (password: string) => Promise<BackupView>
  submitCode: (code: string) => Promise<BackupView>
  cancel: () => Promise<BackupView>
  /** Resets the Immich password and returns the new one. Not stored. */
  resetImmichPassword: () => Promise<string>
  /** Loads the view again; what "Try again" on a failed first load calls. */
  reload: () => void
}

export interface UseBackup {
  view: BackupView | null
  /** True only while the websocket is open. */
  live: boolean
  /** Set when the first load failed; later failures keep the last view. */
  error: ApiError | null
  actions: BackupActions
}

function toApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(0, 'Something went wrong. Try again.')
}

/**
 * The person's backup view: loaded once, then replaced by every websocket
 * frame. A closed socket reconnects on `RECONNECT_DELAYS_MS` and the view is
 * fetched again each time, to cover what was missed.
 */
export function useBackup(): UseBackup {
  const [view, setView] = useState<BackupView | null>(null)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const reloadRef = useRef<() => void>(() => undefined)
  const adoptRef = useRef<(next: BackupView) => void>(() => undefined)

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let failures = 0
    // Bumped by every view we adopt, so a slow fetch can't overwrite a newer
    // frame that arrived while it was in flight.
    let revision = 0

    const adopt = (next: BackupView): void => {
      revision++
      setView(next)
      setError(null)
    }

    adoptRef.current = adopt

    const refetch = (onFail: (error: unknown) => void): Promise<void> => {
      const started = revision
      return getBackup().then(next => {
        if (!disposed && revision === started) adopt(next)
      }, onFail)
    }

    const scheduleReconnect = (): void => {
      const delay =
        RECONNECT_DELAYS_MS[Math.min(failures, RECONNECT_DELAYS_MS.length - 1)]
      failures++
      timer = setTimeout(() => {
        timer = null
        void refetch(() => undefined)
        connect()
      }, delay)
    }

    const connect = (): void => {
      if (disposed) return

      const ws = new WebSocket(backupSocketUrl(window.location))
      socket = ws

      ws.onopen = () => {
        failures = 0
        setLive(true)
      }

      ws.onmessage = event => {
        try {
          const parsed = ServerMessageSchema.safeParse(
            JSON.parse(String(event.data)),
          )
          if (parsed.success) adopt(parsed.data.data)
        } catch {
          // A malformed frame is dropped; the next one replaces the view.
        }
      }

      ws.onclose = () => {
        if (socket !== ws) return
        socket = null
        setLive(false)
        if (!disposed) scheduleReconnect()
      }
    }

    const load = (): void => {
      setError(null)
      void refetch(cause => {
        if (!disposed) setError(toApiError(cause))
      }).then(() => {
        if (!disposed && !socket && !timer && revision > 0) connect()
      })
    }

    reloadRef.current = load
    load()

    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      if (socket) {
        const closing = socket
        socket = null
        closing.onopen = null
        closing.onmessage = null
        closing.onclose = null
        closing.close()
      }
    }
  }, [])

  const reload = useCallback(() => reloadRef.current(), [])

  const actions = useMemo<BackupActions>(() => {
    const apply = async (call: Promise<BackupView>): Promise<BackupView> => {
      const next = await call
      adoptRef.current(next)
      return next
    }

    return {
      start: appleId => apply(startBackup({ appleId })),
      sync: () => apply(syncBackup()),
      submitPassword: password => apply(submitPassword({ password })),
      submitCode: code => apply(submitCode({ code })),
      cancel: () => apply(cancelBackup()),
      resetImmichPassword: async () => (await resetImmichPassword()).password,
      reload,
    }
  }, [reload])

  return { view, live, error, actions }
}
