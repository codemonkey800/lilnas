'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import type { MovieDownloadStatusResponse } from 'src/download/download.types'
import {
  type DownloadState,
  useDownloadState,
} from 'src/hooks/use-download-state'
import { useToast } from 'src/hooks/use-toast'
import type { MovieDetail } from 'src/media'

const IMPORT_STATES: DownloadState[] = ['importing']

export function useMovieDownload(
  movie: Pick<MovieDetail, 'id' | 'tmdbId' | 'download'>,
  initialDownloadStatus?: MovieDownloadStatusResponse | null,
) {
  const router = useRouter()
  const { showToast } = useToast()
  const downloadState = useDownloadState(movie.tmdbId, initialDownloadStatus)
  const { state, title, size, sizeleft, progress, error } = downloadState

  useEffect(() => {
    if (error) {
      showToast(error || 'Download failed', 'error')
    }
  }, [error, showToast])

  useEffect(() => {
    if (state === 'completed') {
      router.refresh()
    }
  }, [state, router])

  const isImportState = IMPORT_STATES.includes(state)
  const isImportBlocked = false

  const downloadPercent =
    state === 'downloading' || state === 'importing' ? progress : 0

  const chipLabel =
    state === 'importing'
      ? 'importing'
      : state === 'searching'
        ? 'searching'
        : state === 'downloading'
          ? 'downloading'
          : state === 'completed'
            ? 'completed'
            : 'pending'

  const chipColor: 'info' | 'warning' | 'success' =
    state === 'importing'
      ? 'success'
      : state === 'downloading'
        ? 'info'
        : 'warning'

  const progressBarColor =
    state === 'importing'
      ? 'var(--color-success, #44cc88)'
      : state === 'downloading'
        ? 'var(--color-info, #44aaff)'
        : 'var(--color-info, #44aaff)'

  const liveDownload =
    state === 'downloading' || state === 'importing'
      ? {
          id: 0,
          title,
          size,
          sizeleft,
          status: state === 'importing' ? 'importing' : 'downloading',
          trackedDownloadState: state === 'importing' ? 'importing' : null,
          estimatedCompletionTime: null,
        }
      : movie.download

  return {
    downloadState,
    liveDownload,
    isSearchingDownload: state === 'searching',
    isDownloadInitiated: state === 'searching',
    downloadPercent,
    isImportState,
    isImportBlocked,
    chipLabel,
    chipColor,
    progressBarColor,
  }
}
