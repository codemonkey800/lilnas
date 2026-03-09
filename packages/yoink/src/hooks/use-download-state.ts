'use client'

import { useCallback, useReducer, useRef } from 'react'

import {
  isImportStatus,
  type DownloadCancelledPayload,
  type DownloadCompletedPayload,
  type DownloadFailedPayload,
  type DownloadGrabbingPayload,
  type DownloadInitiatedPayload,
  type DownloadProgressPayload,
  type MovieDownloadStatusResponse,
} from 'src/download/download.types'

import { useDownloadSocket } from './use-download-socket'

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

const INITIAL_STATE: DownloadStateData = {
  state: 'idle',
  title: null,
  size: 0,
  sizeleft: 0,
  progress: 0,
  eta: null,
  error: null,
}

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
    case 'progress':
      return {
        ...state,
        state: isImportStatus(action.progress, action.status)
          ? 'importing'
          : 'downloading',
        progress: action.progress,
        size: action.size,
        sizeleft: action.sizeleft,
        eta: action.eta,
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
  const initialRef = useRef(initialStatus)
  const [downloadState, dispatch] = useReducer(
    reducer,
    initialRef.current,
    toInitialState,
  )

  const onInitiated = useCallback(
    (payload: DownloadInitiatedPayload) => {
      if (payload.tmdbId !== tmdbId) return
      dispatch({ type: 'initiated' })
    },
    [tmdbId],
  )

  const onGrabbing = useCallback(
    (payload: DownloadGrabbingPayload) => {
      if (payload.tmdbId !== tmdbId) return
      dispatch({ type: 'grabbing', title: payload.title, size: payload.size })
    },
    [tmdbId],
  )

  const onProgress = useCallback(
    (payload: DownloadProgressPayload) => {
      if (payload.tmdbId !== tmdbId) return
      dispatch({
        type: 'progress',
        progress: payload.progress,
        size: payload.size,
        sizeleft: payload.sizeleft,
        eta: payload.eta,
        status: payload.status,
      })
    },
    [tmdbId],
  )

  const onFailed = useCallback(
    (payload: DownloadFailedPayload) => {
      if (payload.tmdbId !== tmdbId) return
      dispatch({ type: 'failed', error: payload.error })
    },
    [tmdbId],
  )

  const onCancelled = useCallback(
    (payload: DownloadCancelledPayload) => {
      if (payload.tmdbId !== tmdbId) return
      dispatch({ type: 'reset' })
    },
    [tmdbId],
  )

  const onCompleted = useCallback(
    (payload: DownloadCompletedPayload) => {
      if (payload.tmdbId !== tmdbId) return
      dispatch({ type: 'completed' })
    },
    [tmdbId],
  )

  useDownloadSocket({
    onInitiated: tmdbId != null ? onInitiated : undefined,
    onGrabbing: tmdbId != null ? onGrabbing : undefined,
    onProgress: tmdbId != null ? onProgress : undefined,
    onFailed: tmdbId != null ? onFailed : undefined,
    onCancelled: tmdbId != null ? onCancelled : undefined,
    onCompleted: tmdbId != null ? onCompleted : undefined,
  })

  return downloadState
}
