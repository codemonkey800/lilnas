'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

import type { EpisodeDownloadStatus } from 'src/app/api/shows/download-status/route'
import type { MovieDownloadInfo } from 'src/media'

const DOWNLOAD_POLL_INTERVAL_MS = 2000
const SEARCH_POLL_INTERVAL_MS = 3000

async function fetchShowDownloadStatus(
  seriesId: number,
): Promise<EpisodeDownloadStatus[]> {
  const res = await fetch(`/api/shows/download-status?seriesId=${seriesId}`)
  return res.json()
}

export function useShowDownload(
  seriesId: number,
  initialDownloads: { episodeId: number; download: MovieDownloadInfo }[],
  hasActiveSearches = false,
) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: activeDownloads = [] } = useQuery({
    queryKey: ['show-download-status', seriesId],
    queryFn: () => fetchShowDownloadStatus(seriesId),
    initialData: initialDownloads,
    enabled: seriesId > 0,
    refetchInterval: query => {
      if ((query.state.data?.length ?? 0) > 0) return DOWNLOAD_POLL_INTERVAL_MS
      if (hasActiveSearches) return SEARCH_POLL_INTERVAL_MS
      return false
    },
  })

  // Map of episodeId -> download info for fast lookup
  const downloadMap = new Map<number, MovieDownloadInfo>()
  for (const item of activeDownloads) {
    downloadMap.set(item.episodeId, item.download)
  }

  // Refresh page whenever any episode leaves the download queue
  const prevEpisodeIdsRef = useRef(
    new Set(initialDownloads.map(d => d.episodeId)),
  )
  useEffect(() => {
    const currentIds = new Set(activeDownloads.map(d => d.episodeId))
    const prevIds = prevEpisodeIdsRef.current
    const anyRemoved = [...prevIds].some(id => !currentIds.has(id))

    if (anyRemoved) {
      router.refresh()
    }

    prevEpisodeIdsRef.current = currentIds
  }, [activeDownloads, router])

  const setEpisodeDownloadInitiated = useCallback(
    (episodeId: number, initiated: boolean) => {
      queryClient.setQueryData(
        ['episode-download-initiated', episodeId],
        initiated,
      )
    },
    [queryClient],
  )

  return {
    downloadMap,
    hasActiveDownloads: activeDownloads.length > 0,
    setEpisodeDownloadInitiated,
  }
}

export function useEpisodeDownloadInitiated(episodeId: number) {
  const queryClient = useQueryClient()
  const { data: isInitiated = false } = useQuery<boolean>({
    queryKey: ['episode-download-initiated', episodeId],
    queryFn: () => false,
    enabled: false,
    initialData: false,
  })
  const clear = useCallback(() => {
    queryClient.setQueryData(['episode-download-initiated', episodeId], false)
  }, [queryClient, episodeId])
  return { isInitiated, clear }
}
