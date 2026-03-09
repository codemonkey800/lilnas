'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo } from 'react'

import type { ShowDownloadStatusResponse } from 'src/download/download.types'
import { useShowDownloadState } from 'src/hooks/use-show-download-state'
import type { MovieDownloadInfo } from 'src/media'

export function useShowDownload(
  tvdbId: number | null,
  _seriesId: number,
  initialDownloads: { episodeId: number; download: MovieDownloadInfo }[],
  initialDownloadStatus?: ShowDownloadStatusResponse,
) {
  const router = useRouter()
  const {
    episodeStates,
    searchingEpisodeIds,
    hasActiveDownloads,
    hasActiveSearches,
  } = useShowDownloadState(tvdbId, initialDownloadStatus)

  const downloadMap = useMemo(() => {
    const map = new Map<number, MovieDownloadInfo>()
    for (const item of initialDownloads) {
      map.set(item.episodeId, item.download)
    }
    for (const [episodeId, state] of episodeStates) {
      if (state.state === 'downloading' || state.state === 'importing') {
        map.set(episodeId, {
          id: 0,
          title: state.title,
          size: state.size,
          sizeleft: state.sizeleft,
          status: state.state === 'importing' ? 'importing' : 'downloading',
          trackedDownloadState:
            state.state === 'importing' ? 'importing' : null,
          estimatedCompletionTime: state.eta,
        })
      }
    }
    return map
  }, [initialDownloads, episodeStates])

  useEffect(() => {
    for (const [, state] of episodeStates) {
      if (state.state === 'completed') {
        router.refresh()
        break
      }
    }
  }, [episodeStates, router])

  return {
    downloadMap,
    hasActiveDownloads,
    hasActiveSearches,
    searchingEpisodeIds,
  }
}
