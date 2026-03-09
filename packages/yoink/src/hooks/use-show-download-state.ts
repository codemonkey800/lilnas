'use client'

import { useEffect, useMemo, useReducer } from 'react'

import { useSocket } from 'src/components/socket-provider'
import {
  IMPORT_STATUSES,
  type ShowDownloadStatusResponse,
} from 'src/download/download.types'

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
      state: 'searching',
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
    case 'progress': {
      const isImporting =
        action.progress >= 100 || IMPORT_STATUSES.has(action.status)
      setEpisode(action.episodeId, {
        state: isImporting ? 'importing' : 'downloading',
        progress: action.progress,
        size: action.size,
        sizeleft: action.sizeleft,
        eta: action.eta,
      })
      break
    }
    case 'failed':
      setEpisode(action.episodeId, {
        state: 'failed',
        error: action.error,
      })
      break
    case 'completed':
      setEpisode(action.episodeId, { state: 'completed', progress: 100 })
      break
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
  const socket = useSocket()
  const initialMap = useMemo(
    () => toInitialEpisodeMap(initialStatus),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [episodeStates, dispatch] = useReducer(episodeReducer, initialMap)

  useEffect(() => {
    if (!socket || tvdbId == null) return

    function onInitiated(payload: {
      tvdbId?: number
      mediaType?: string
      episodeId?: number
    }) {
      if (payload.tvdbId !== tvdbId || payload.mediaType !== 'episode') return
      if (payload.episodeId != null) {
        dispatch({ type: 'initiated', episodeId: payload.episodeId })
      }
    }

    function onGrabbing(payload: {
      tvdbId?: number
      mediaType?: string
      episodeId?: number
      title: string | null
      size: number
    }) {
      if (payload.tvdbId !== tvdbId || payload.mediaType !== 'episode') return
      if (payload.episodeId != null) {
        dispatch({
          type: 'grabbing',
          episodeId: payload.episodeId,
          title: payload.title,
          size: payload.size,
        })
      }
    }

    function onProgress(payload: {
      tvdbId?: number
      mediaType?: string
      episodeId?: number
      progress: number
      size: number
      sizeleft: number
      eta: string | null
      status: string
    }) {
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
    }

    function onFailed(payload: {
      tvdbId?: number
      mediaType?: string
      episodeId?: number
      error: string
    }) {
      if (payload.tvdbId !== tvdbId || payload.mediaType !== 'episode') return
      if (payload.episodeId != null) {
        dispatch({
          type: 'failed',
          episodeId: payload.episodeId,
          error: payload.error,
        })
      }
    }

    function onCompleted(payload: {
      tvdbId?: number
      mediaType?: string
      episodeId?: number
    }) {
      if (payload.tvdbId !== tvdbId || payload.mediaType !== 'episode') return
      if (payload.episodeId != null) {
        dispatch({ type: 'completed', episodeId: payload.episodeId })
      }
    }

    socket.on('download:initiated', onInitiated)
    socket.on('download:grabbing', onGrabbing)
    socket.on('download:progress', onProgress)
    socket.on('download:failed', onFailed)
    socket.on('download:completed', onCompleted)

    return () => {
      socket.off('download:initiated', onInitiated)
      socket.off('download:grabbing', onGrabbing)
      socket.off('download:progress', onProgress)
      socket.off('download:failed', onFailed)
      socket.off('download:completed', onCompleted)
    }
  }, [socket, tvdbId])

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
