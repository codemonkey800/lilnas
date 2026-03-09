'use client'

import { useCallback, useEffect, useMemo, useReducer } from 'react'

import { useSocket } from 'src/components/socket-provider'
import {
  type AllDownloadsResponse,
  IMPORT_STATUSES,
  type MovieDownloadItem,
  type SeasonDownloadGroup,
  type ShowDownloadItem,
} from 'src/download/download.types'
import { api } from 'src/media/api.client'

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface AllDownloadsState {
  movies: MovieDownloadItem[]
  shows: ShowDownloadItem[]
}

// ---------------------------------------------------------------------------
// Reducer actions
// ---------------------------------------------------------------------------

type Action =
  | { type: 'reset'; data: AllDownloadsResponse }
  | { type: 'refetch'; data: AllDownloadsResponse }
  | {
      type: 'movie:progress'
      tmdbId: number
      progress: number
      size: number
      sizeleft: number
      eta: string | null
      status: string
    }
  | {
      type: 'movie:grabbing'
      tmdbId: number
      title: string | null
      size: number
    }
  | { type: 'movie:remove'; tmdbId: number }
  | {
      type: 'episode:progress'
      episodeId: number
      progress: number
      size: number
      sizeleft: number
      eta: string | null
      status: string
    }
  | {
      type: 'episode:grabbing'
      episodeId: number
      title: string | null
      size: number
    }
  | { type: 'episode:remove'; episodeId: number }

// ---------------------------------------------------------------------------
// Helper: build state from server response
// ---------------------------------------------------------------------------

function fromResponse(data: AllDownloadsResponse): AllDownloadsState {
  return { movies: data.movies, shows: data.shows }
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: AllDownloadsState, action: Action): AllDownloadsState {
  switch (action.type) {
    case 'reset':
    case 'refetch':
      return fromResponse(action.data)

    case 'movie:grabbing': {
      const movies = state.movies.map(m =>
        m.tmdbId === action.tmdbId
          ? {
              ...m,
              state: 'downloading' as const,
              releaseTitle: action.title,
              size: action.size,
              sizeleft: action.size,
              progress: 0,
            }
          : m,
      )
      return { ...state, movies }
    }

    case 'movie:progress': {
      const isImporting =
        action.progress >= 100 || IMPORT_STATUSES.has(action.status)
      const movies = state.movies.map(m =>
        m.tmdbId === action.tmdbId
          ? {
              ...m,
              state: isImporting
                ? ('importing' as const)
                : ('downloading' as const),
              progress: action.progress,
              size: action.size,
              sizeleft: action.sizeleft,
              eta: action.eta,
              status: action.status,
            }
          : m,
      )
      return { ...state, movies }
    }

    case 'movie:remove': {
      const movies = state.movies.filter(m => m.tmdbId !== action.tmdbId)
      return { ...state, movies }
    }

    case 'episode:grabbing': {
      const shows = state.shows.map(show => ({
        ...show,
        seasons: show.seasons.map(season => ({
          ...season,
          episodes: season.episodes.map(ep =>
            ep.episodeId === action.episodeId
              ? {
                  ...ep,
                  state: 'downloading' as const,
                  releaseTitle: action.title,
                  size: action.size,
                  sizeleft: action.size,
                  progress: 0,
                }
              : ep,
          ),
        })),
      }))
      return { ...state, shows }
    }

    case 'episode:progress': {
      const isImporting =
        action.progress >= 100 || IMPORT_STATUSES.has(action.status)
      const shows = state.shows.map(show => ({
        ...show,
        seasons: show.seasons.map(season => ({
          ...season,
          episodes: season.episodes.map(ep =>
            ep.episodeId === action.episodeId
              ? {
                  ...ep,
                  state: isImporting
                    ? ('importing' as const)
                    : ('downloading' as const),
                  progress: action.progress,
                  size: action.size,
                  sizeleft: action.sizeleft,
                  eta: action.eta,
                  status: action.status,
                }
              : ep,
          ),
        })),
      }))
      return { ...state, shows }
    }

    case 'episode:remove': {
      const shows = state.shows
        .map(show => {
          const seasons: SeasonDownloadGroup[] = show.seasons
            .map(season => ({
              ...season,
              episodes: season.episodes.filter(
                ep => ep.episodeId !== action.episodeId,
              ),
            }))
            .filter(s => s.episodes.length > 0)
          return { ...show, seasons }
        })
        .filter(show => show.seasons.length > 0)
      return { ...state, shows }
    }

    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAllDownloadsState(initialData: AllDownloadsResponse): {
  movies: MovieDownloadItem[]
  shows: ShowDownloadItem[]
  hasAnyDownloads: boolean
  totalCount: number
} {
  const socket = useSocket()
  const [state, dispatch] = useReducer(reducer, initialData, fromResponse)

  const refetch = useCallback(async () => {
    const data = await api.getAllDownloads()
    dispatch({ type: 'refetch', data })
  }, [])

  useEffect(() => {
    if (!socket) return

    function onInitiated() {
      // On any new download initiated, refetch to get rich metadata
      void refetch()
    }

    function onGrabbing(payload: {
      mediaType?: string
      tmdbId?: number
      tvdbId?: number
      episodeId?: number
      title: string | null
      size: number
    }) {
      if (payload.mediaType === 'movie' && payload.tmdbId != null) {
        dispatch({
          type: 'movie:grabbing',
          tmdbId: payload.tmdbId,
          title: payload.title,
          size: payload.size,
        })
      } else if (payload.mediaType === 'episode' && payload.episodeId != null) {
        dispatch({
          type: 'episode:grabbing',
          episodeId: payload.episodeId,
          title: payload.title,
          size: payload.size,
        })
      }
    }

    function onProgress(payload: {
      mediaType?: string
      tmdbId?: number
      tvdbId?: number
      episodeId?: number
      progress: number
      size: number
      sizeleft: number
      eta: string | null
      status: string
    }) {
      if (payload.mediaType === 'movie' && payload.tmdbId != null) {
        dispatch({
          type: 'movie:progress',
          tmdbId: payload.tmdbId,
          progress: payload.progress,
          size: payload.size,
          sizeleft: payload.sizeleft,
          eta: payload.eta,
          status: payload.status,
        })
      } else if (payload.mediaType === 'episode' && payload.episodeId != null) {
        dispatch({
          type: 'episode:progress',
          episodeId: payload.episodeId,
          progress: payload.progress,
          size: payload.size,
          sizeleft: payload.sizeleft,
          eta: payload.eta,
          status: payload.status,
        })
      }
    }

    function onRemove(payload: {
      mediaType?: string
      tmdbId?: number
      tvdbId?: number
      episodeId?: number
    }) {
      if (payload.mediaType === 'movie' && payload.tmdbId != null) {
        dispatch({ type: 'movie:remove', tmdbId: payload.tmdbId })
      } else if (payload.mediaType === 'episode' && payload.episodeId != null) {
        dispatch({ type: 'episode:remove', episodeId: payload.episodeId })
      }
    }

    socket.on('download:initiated', onInitiated)
    socket.on('download:grabbing', onGrabbing)
    socket.on('download:progress', onProgress)
    socket.on('download:failed', onRemove)
    socket.on('download:cancelled', onRemove)
    socket.on('download:completed', onRemove)

    return () => {
      socket.off('download:initiated', onInitiated)
      socket.off('download:grabbing', onGrabbing)
      socket.off('download:progress', onProgress)
      socket.off('download:failed', onRemove)
      socket.off('download:cancelled', onRemove)
      socket.off('download:completed', onRemove)
    }
  }, [socket, refetch])

  const { hasAnyDownloads, totalCount } = useMemo(() => {
    const movieCount = state.movies.length
    const episodeCount = state.shows.reduce(
      (acc, show) =>
        acc + show.seasons.reduce((s, season) => s + season.episodes.length, 0),
      0,
    )
    const total = movieCount + episodeCount
    return { hasAnyDownloads: total > 0, totalCount: total }
  }, [state.movies, state.shows])

  return {
    movies: state.movies,
    shows: state.shows,
    hasAnyDownloads,
    totalCount,
  }
}
