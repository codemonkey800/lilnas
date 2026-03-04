'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useToast } from 'src/hooks/use-toast'
import type { MovieDetail, MovieDownloadInfo } from 'src/lib/media'

import { setMovieMonitored } from './actions'

const DOWNLOAD_POLL_INTERVAL_MS = 2000
const SEARCH_POLL_INTERVAL_MS = 3000
const SEARCH_TIMEOUT_MS = 30_000

async function fetchDownloadStatus(
  movieId: number,
): Promise<MovieDownloadInfo | null> {
  const res = await fetch(`/api/movies/download-status?movieId=${movieId}`)
  return res.json()
}

export function useDownloadInitiated(movieId: number) {
  const queryClient = useQueryClient()
  const { data: isDownloadInitiated = false } = useQuery<boolean>({
    queryKey: ['download-initiated', movieId],
    queryFn: () => false,
    enabled: false,
    initialData: false,
  })
  const clearDownloadInitiated = useCallback(() => {
    queryClient.setQueryData(['download-initiated', movieId], false)
  }, [queryClient, movieId])
  return { isDownloadInitiated, clearDownloadInitiated }
}

export function useMovieDownload(
  movie: Pick<MovieDetail, 'id' | 'tmdbId' | 'download'>,
) {
  const router = useRouter()
  const { showToast } = useToast()
  const [isSearchingDownload, setIsSearchingDownload] = useState(false)
  const { isDownloadInitiated, clearDownloadInitiated } = useDownloadInitiated(
    movie.id,
  )

  const { data: liveDownload } = useQuery({
    queryKey: ['download-status', movie.id],
    queryFn: () => fetchDownloadStatus(movie.id),
    initialData: movie.download,
    enabled: movie.id > 0,
    refetchInterval: query => {
      if (query.state.data != null) return DOWNLOAD_POLL_INTERVAL_MS
      if (isSearchingDownload || isDownloadInitiated)
        return SEARCH_POLL_INTERVAL_MS
      return false
    },
  })

  useEffect(() => {
    if (!isSearchingDownload) return

    let handle: ReturnType<typeof setTimeout>
    let mounted = true

    if (liveDownload != null) {
      handle = setTimeout(() => {
        setIsSearchingDownload(false)
        router.refresh()
      }, 0)
    } else {
      handle = setTimeout(async () => {
        if (!mounted) return
        setIsSearchingDownload(false)
        if (movie.tmdbId != null) {
          await setMovieMonitored(movie.id, false, movie.tmdbId)
        }
        if (!mounted) return
        showToast('No files were found for this movie', 'warning')
        router.refresh()
      }, SEARCH_TIMEOUT_MS)
    }

    return () => {
      mounted = false
      clearTimeout(handle)
    }
  }, [
    isSearchingDownload,
    liveDownload,
    movie.id,
    movie.tmdbId,
    router,
    showToast,
  ])

  useEffect(() => {
    if (!isDownloadInitiated) return
    if (liveDownload != null) {
      clearDownloadInitiated()
      return
    }
    let mounted = true
    const handle = setTimeout(() => {
      if (!mounted) return
      clearDownloadInitiated()
      showToast('Download did not start in time', 'warning')
      router.refresh()
    }, SEARCH_TIMEOUT_MS)
    return () => {
      mounted = false
      clearTimeout(handle)
    }
  }, [
    isDownloadInitiated,
    liveDownload,
    clearDownloadInitiated,
    router,
    showToast,
  ])

  const prevDownloadRef = useRef(liveDownload)
  useEffect(() => {
    if (prevDownloadRef.current != null && liveDownload == null) {
      router.refresh()
    }
    prevDownloadRef.current = liveDownload
  }, [liveDownload, router])

  const downloadPercent =
    liveDownload && liveDownload.size > 0
      ? Math.round(
          ((liveDownload.size - liveDownload.sizeleft) / liveDownload.size) *
            100,
        )
      : 0

  const IMPORT_STATES = ['importPending', 'importing', 'importBlocked']
  const isImportState =
    (liveDownload?.trackedDownloadState != null &&
      IMPORT_STATES.includes(liveDownload.trackedDownloadState)) ||
    downloadPercent === 100
  const isImportBlocked = liveDownload?.trackedDownloadState === 'importBlocked'

  const chipLabel = isImportState
    ? isImportBlocked
      ? 'import blocked'
      : 'importing'
    : (liveDownload?.status ?? 'pending')

  const chipColor: 'info' | 'warning' | 'success' = isImportState
    ? isImportBlocked
      ? 'warning'
      : 'success'
    : liveDownload?.status === 'downloading'
      ? 'info'
      : 'warning'

  const progressBarColor = isImportState
    ? isImportBlocked
      ? 'var(--color-warning, #ffaa22)'
      : 'var(--color-success, #44cc88)'
    : liveDownload
      ? liveDownload.status === 'downloading'
        ? 'var(--color-info, #44aaff)'
        : 'var(--color-warning, #ffaa22)'
      : 'var(--color-info, #44aaff)'

  return {
    liveDownload,
    isSearchingDownload,
    setIsSearchingDownload,
    isDownloadInitiated,
    downloadPercent,
    isImportState,
    isImportBlocked,
    chipLabel,
    chipColor,
    progressBarColor,
  }
}
