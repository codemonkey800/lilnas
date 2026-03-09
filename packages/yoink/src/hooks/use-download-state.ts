'use client'

import { useEffect, useMemo, useReducer } from 'react'

import { useSocket } from 'src/components/socket-provider'
import {
  IMPORT_STATUSES,
  type MovieDownloadStatusResponse,
} from 'src/download/download.types'

export type DownloadState =
  | 'idle'
  | 'searching'
  | 'downloading'
  | 'importing'
  | 'completed'

export interface DownloadStateData {
  state: DownloadState
  title: string | null
  size: number
  sizeleft: number
  progress: number
  eta: string | null
  error: string | null
}

type Action =
  | { type: 'initiated' }
  | { type: 'grabbing'; title: string | null; size: number }
  | {
      type: 'progress'
      progress: number
      size: number
      sizeleft: number
      eta: string | null
      status: string
    }
  | { type: 'failed'; error: string }
  | { type: 'completed' }
  | { type: 'reset' }

function reducer(state: DownloadStateData, action: Action): DownloadStateData {
  switch (action.type) {
    case 'initiated':
      return { ...INITIAL_STATE, state: 'searching' }
    case 'grabbing':
      return {
        ...state,
        state: 'downloading',
        title: action.title,
        size: action.size,
        sizeleft: action.size,
        progress: 0,
        error: null,
      }
    case 'progress': {
      const isImporting =
        action.progress >= 100 || IMPORT_STATUSES.has(action.status)
      return {
        ...state,
        state: isImporting ? 'importing' : 'downloading',
        progress: action.progress,
        size: action.size,
        sizeleft: action.sizeleft,
        eta: action.eta,
      }
    }
    case 'failed':
      return { ...INITIAL_STATE, error: action.error }
    case 'completed':
      return { ...state, state: 'completed', progress: 100 }
    case 'reset':
      return INITIAL_STATE
    default:
      return state
  }
}

const INITIAL_STATE: DownloadStateData = {
  state: 'idle',
  title: null,
  size: 0,
  sizeleft: 0,
  progress: 0,
  eta: null,
  error: null,
}

function toInitialState(
  initial: MovieDownloadStatusResponse | null | undefined,
): DownloadStateData {
  if (!initial) return INITIAL_STATE
  return {
    state: initial.state,
    title: initial.title,
    size: initial.size,
    sizeleft: initial.sizeleft,
    progress: initial.progress,
    eta: initial.eta,
    error: null,
  }
}

/**
 * Subscribes to Socket.IO download events for a specific movie (by tmdbId).
 * Returns a state machine that reflects the current download lifecycle.
 * Optionally accepts an initial state snapshot from the server to avoid
 * showing a blank state before the first WebSocket event arrives.
 */
export function useDownloadState(
  tmdbId: number | null,
  initialStatus?: MovieDownloadStatusResponse | null,
): DownloadStateData {
  const socket = useSocket()
  const initialState = useMemo(
    () => toInitialState(initialStatus),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [downloadState, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    if (!socket || tmdbId == null) return

    function onInitiated(payload: { tmdbId?: number }) {
      if (payload.tmdbId !== tmdbId) return
      dispatch({ type: 'initiated' })
    }

    function onGrabbing(payload: {
      tmdbId?: number
      title: string | null
      size: number
    }) {
      if (payload.tmdbId !== tmdbId) return
      dispatch({ type: 'grabbing', title: payload.title, size: payload.size })
    }

    function onProgress(payload: {
      tmdbId?: number
      progress: number
      size: number
      sizeleft: number
      eta: string | null
      status: string
    }) {
      if (payload.tmdbId !== tmdbId) return
      dispatch({
        type: 'progress',
        progress: payload.progress,
        size: payload.size,
        sizeleft: payload.sizeleft,
        eta: payload.eta,
        status: payload.status,
      })
    }

    function onFailed(payload: { tmdbId?: number; error: string }) {
      if (payload.tmdbId !== tmdbId) return
      dispatch({ type: 'failed', error: payload.error })
    }

    function onCancelled(payload: { tmdbId?: number }) {
      if (payload.tmdbId !== tmdbId) return
      dispatch({ type: 'reset' })
    }

    function onCompleted(payload: { tmdbId?: number }) {
      if (payload.tmdbId !== tmdbId) return
      dispatch({ type: 'completed' })
    }

    socket.on('download:initiated', onInitiated)
    socket.on('download:grabbing', onGrabbing)
    socket.on('download:progress', onProgress)
    socket.on('download:failed', onFailed)
    socket.on('download:cancelled', onCancelled)
    socket.on('download:completed', onCompleted)

    return () => {
      socket.off('download:initiated', onInitiated)
      socket.off('download:grabbing', onGrabbing)
      socket.off('download:progress', onProgress)
      socket.off('download:failed', onFailed)
      socket.off('download:cancelled', onCancelled)
      socket.off('download:completed', onCompleted)
    }
  }, [socket, tmdbId])

  return downloadState
}
