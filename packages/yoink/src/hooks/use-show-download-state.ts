'use client'

import { useCallback, useMemo, useReducer } from 'react'

import {
  type DownloadCancelledPayload,
  type DownloadCompletedPayload,
  type DownloadFailedPayload,
  type DownloadGrabbingPayload,
  type DownloadInitiatedPayload,
  type DownloadProgressPayload,
  isImportStatus,
  type ShowDownloadStatusResponse,
} from 'src/download/download.types'

import { useDownloadSocket } from './use-download-socket'

export interface EpisodeDownloadStateData {
  state: 'searching' | 'downloading' | 'importing' | 'completed' | 'failed'
  title: string | null
  size: number
  sizeleft: number
  progress: number
  eta: string | null
  error: string | null
}

type EpisodeAction =
  | { type: 'initiated'; episodeId: number }
  | {
      type: 'grabbing'
      episodeId: number
      title: string | null
      size: number
    }
  | {
      type: 'progress'
      episodeId: number
      progress: number
      size: number
      sizeleft: number
      eta: string | null
      status: string
    }
  | { type: 'failed'; episodeId: number; error: string }
  | { type: 'completed'; episodeId: number }
  | { type: 'remove'; episodeId: number }

function episodeReducer(
  state: Map<number, EpisodeDownloadStateData>,
  action: EpisodeAction,
): Map<number, EpisodeDownloadStateData> {
  const next = new Map(state)

  function setEpisode(
    episodeId: number,
    data: Partial<EpisodeDownloadStateData> & {
      state: EpisodeDownloadStateData['state']
    },
  ) {
    const prev = next.get(episodeId) ?? {
      state: 'searching' as const,
      title: null,
      size: 0,
      sizeleft: 0,
      progress: 0,
      eta: null,
      error: null,
    }
    next.set(episodeId, { ...prev, ...data })
  }

  switch (action.type) {
    case 'initiated':
      setEpisode(action.episodeId, { state: 'searching' })
      break
    case 'grabbing':
      setEpisode(action.episodeId, {
        state: 'downloading',
        title: action.title,
        size: action.size,
        sizeleft: action.size,
        progress: 0,
        error: null,
      })
      break
    case 'progress':
      setEpisode(action.episodeId, {
        state: isImportStatus(action.progress, action.status)
          ? 'importing'
          : 'downloading',
        progress: action.progress,
        size: action.size,
        sizeleft: action.sizeleft,
        eta: action.eta,
      })
      break
    case 'failed':
      setEpisode(action.episodeId, {
        state: 'failed',
        error: action.error,
      })
      break
    case 'completed':
      setEpisode(action.episodeId, { state: 'completed', progress: 100 })
      break
    case 'remove':
      next.delete(action.episodeId)
      return next
  }

  return next
}

function toInitialEpisodeMap(
  items: ShowDownloadStatusResponse | undefined,
): Map<number, EpisodeDownloadStateData> {
  if (!items || items.length === 0) return new Map()
  const map = new Map<number, EpisodeDownloadStateData>()
  for (const item of items) {
    map.set(item.episodeId, {
      state: item.state,
      title: item.title,
      size: item.size,
      sizeleft: item.sizeleft,
      progress: item.progress,
      eta: item.eta,
      error: null,
    })
  }
  return map
}

export function useShowDownloadState(
  tvdbId: number | null,
  initialStatus?: ShowDownloadStatusResponse,
): {
  episodeStates: Map<number, EpisodeDownloadStateData>
  searchingEpisodeIds: Set<number>
  downloadingEpisodeIds: Set<number>
  hasActiveDownloads: boolean
  hasActiveSearches: boolean
} {
  const [episodeStates, dispatch] = useReducer(
    episodeReducer,
    initialStatus,
    toInitialEpisodeMap,
  )

  const onInitiated = useCallback(
    (payload: DownloadInitiatedPayload) => {
      if (payload.tvdbId !== tvdbId || payload.mediaType !== 'episode') return
      if (payload.episodeId != null) {
        dispatch({ type: 'initiated', episodeId: payload.episodeId })
      }
    },
    [tvdbId],
  )

  const onGrabbing = useCallback(
    (payload: DownloadGrabbingPayload) => {
      if (payload.tvdbId !== tvdbId || payload.mediaType !== 'episode') return
      if (payload.episodeId != null) {
        dispatch({
          type: 'grabbing',
          episodeId: payload.episodeId,
          title: payload.title,
          size: payload.size,
        })
      }
    },
    [tvdbId],
  )

  const onProgress = useCallback(
    (payload: DownloadProgressPayload) => {
      if (payload.tvdbId !== tvdbId || payload.mediaType !== 'episode') return
      if (payload.episodeId != null) {
        dispatch({
          type: 'progress',
          episodeId: payload.episodeId,
          progress: payload.progress,
          size: payload.size,
          sizeleft: payload.sizeleft,
          eta: payload.eta,
          status: payload.status,
        })
      }
    },
    [tvdbId],
  )

  const onFailed = useCallback(
    (payload: DownloadFailedPayload) => {
      if (payload.tvdbId !== tvdbId || payload.mediaType !== 'episode') return
      if (payload.episodeId != null) {
        dispatch({
          type: 'failed',
          episodeId: payload.episodeId,
          error: payload.error,
        })
      }
    },
    [tvdbId],
  )

  const onCancelled = useCallback(
    (payload: DownloadCancelledPayload) => {
      if (payload.tvdbId !== tvdbId || payload.mediaType !== 'episode') return
      if (payload.episodeId != null) {
        dispatch({ type: 'remove', episodeId: payload.episodeId })
      }
    },
    [tvdbId],
  )

  const onCompleted = useCallback(
    (payload: DownloadCompletedPayload) => {
      if (payload.tvdbId !== tvdbId || payload.mediaType !== 'episode') return
      if (payload.episodeId != null) {
        dispatch({ type: 'remove', episodeId: payload.episodeId })
      }
    },
    [tvdbId],
  )

  useDownloadSocket({
    onInitiated: tvdbId != null ? onInitiated : undefined,
    onGrabbing: tvdbId != null ? onGrabbing : undefined,
    onProgress: tvdbId != null ? onProgress : undefined,
    onFailed: tvdbId != null ? onFailed : undefined,
    onCancelled: tvdbId != null ? onCancelled : undefined,
    onCompleted: tvdbId != null ? onCompleted : undefined,
  })

  const {
    searchingEpisodeIds,
    downloadingEpisodeIds,
    hasActiveDownloads,
    hasActiveSearches,
  } = useMemo(() => {
    const searching = new Set<number>()
    const downloading = new Set<number>()
    for (const [episodeId, data] of episodeStates) {
      if (data.state === 'searching') searching.add(episodeId)
      if (data.state === 'downloading' || data.state === 'importing') {
        downloading.add(episodeId)
      }
    }
    return {
      searchingEpisodeIds: searching,
      downloadingEpisodeIds: downloading,
      hasActiveDownloads: downloading.size > 0,
      hasActiveSearches: searching.size > 0,
    }
  }, [episodeStates])

  return {
    episodeStates,
    searchingEpisodeIds,
    downloadingEpisodeIds,
    hasActiveDownloads,
    hasActiveSearches,
  }
}
