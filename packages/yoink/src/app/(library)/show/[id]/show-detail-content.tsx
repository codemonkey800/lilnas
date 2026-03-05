'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'

import type { SearchStateResponse } from 'src/app/api/shows/search-state/route'
import { ConfirmDialog } from 'src/components/confirm-dialog'
import { useConfirmDialog } from 'src/hooks/use-confirm-dialog'
import { useToast } from 'src/hooks/use-toast'
import { type ShowDetail } from 'src/media'

import {
  addShowToLibrary,
  cancelAllShowDownloads,
  clearShowSearches,
  deleteEpisodeFile,
  deleteSeasonFiles,
  removeShowFromLibrary,
  triggerEpisodeDownload,
  triggerSeasonDownload,
  triggerSeriesDownload,
} from './actions'
import { SeasonAccordion } from './season-accordion'
import { ShowExternalLinks } from './show-external-links'
import { ShowHero } from './show-hero'
import { ShowMetadata } from './show-metadata'
import { ShowScreenshotGallery } from './show-screenshot-gallery'
import { useSearchState } from './use-search-commands'
import { useShowDownload } from './use-show-download'

interface ShowDetailContentProps {
  show: ShowDetail
  initialSearchState: SearchStateResponse
}

export function ShowDetailContent({
  show,
  initialSearchState,
}: ShowDetailContentProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false)
  const [deletedEpisodeFileIds, setDeletedEpisodeFileIds] = useState<Set<number>>(new Set())
  const [clientSearchingIds, setClientSearchingIds] = useState<Set<number>>(new Set())
  const searchTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const { searchingEpisodeIds, timedOutEpisodeIds, hasActiveSearches } =
    useSearchState(show.id, initialSearchState)

  const effectiveSearchingIds = useMemo(() => {
    if (clientSearchingIds.size === 0) return searchingEpisodeIds
    const merged = new Set(searchingEpisodeIds)
    clientSearchingIds.forEach(id => merged.add(id))
    return merged
  }, [searchingEpisodeIds, clientSearchingIds])

  const effectiveHasActiveSearches = hasActiveSearches || clientSearchingIds.size > 0

  const { dialogState, openDialog, closeDialog } = useConfirmDialog()

  // Build initial downloads from server-rendered data
  const initialDownloads = useMemo(() => {
    const result: {
      episodeId: number
      download: (typeof show.seasons)[number]['episodes'][number]['download']
    }[] = []
    for (const season of show.seasons) {
      for (const ep of season.episodes) {
        if (ep.download) {
          result.push({ episodeId: ep.id, download: ep.download })
        }
      }
    }
    return result.filter(
      (
        item,
      ): item is {
        episodeId: number
        download: NonNullable<typeof item.download>
      } => item.download !== null,
    )
  }, [show])

  const { downloadMap, hasActiveDownloads } = useShowDownload(
    show.id,
    initialDownloads,
    effectiveHasActiveSearches,
  )

  useEffect(() => {
    if (clientSearchingIds.size === 0) return
    let changed = false
    const next = new Set(clientSearchingIds)
    for (const id of clientSearchingIds) {
      if (downloadMap.has(id)) {
        next.delete(id)
        changed = true
        const timer = searchTimersRef.current.get(id)
        if (timer) {
          clearTimeout(timer)
          searchTimersRef.current.delete(id)
        }
      }
    }
    if (changed) setClientSearchingIds(next)
  }, [downloadMap, clientSearchingIds])

  useEffect(() => {
    const timers = searchTimersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

  // Compute missing episode count (aired, no file) for the hero button label
  const missingEpisodeCount = useMemo(() => {
    const now = new Date()
    return show.seasons.reduce((total, season) => {
      return (
        total +
        season.episodes.filter(ep => {
          if (ep.hasFile) return false
          if (!ep.airDate) return false
          return new Date(ep.airDate) <= now
        }).length
      )
    }, 0)
  }, [show.seasons])

  const addSearchingEpisodes = useCallback((ids: number[]) => {
    if (ids.length === 0) return
    setClientSearchingIds(prev => {
      const next = new Set(prev)
      ids.forEach(id => next.add(id))
      return next
    })
    for (const id of ids) {
      const existing = searchTimersRef.current.get(id)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        setClientSearchingIds(prev => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        searchTimersRef.current.delete(id)
        router.refresh()
      }, 35_000)
      searchTimersRef.current.set(id, timer)
    }
  }, [router])

  // True when every missing episode is being searched or actively downloading
  const allMissingCovered = useMemo(() => {
    const now = new Date()
    const missingEpisodes = show.seasons.flatMap(s =>
      s.episodes.filter(
        ep => !ep.hasFile && ep.airDate && new Date(ep.airDate) <= now,
      ),
    )
    if (missingEpisodes.length === 0) return false
    return missingEpisodes.every(
      ep => effectiveSearchingIds.has(ep.id) || downloadMap.has(ep.id),
    )
  }, [show.seasons, effectiveSearchingIds, downloadMap])

  // Find the first season with missing episodes to default-expand
  const defaultOpenSeason = useMemo(() => {
    for (const season of show.seasons) {
      if (season.downloadedCount < season.episodeCount) {
        return season.seasonNumber
      }
    }
    // All downloaded — open last season
    return show.seasons.at(-1)?.seasonNumber ?? null
  }, [show.seasons])

  const invalidateSearchState = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: ['show-search-state', show.id],
    })
  }, [queryClient, show.id])

  const handleAddToLibrary = useCallback(() => {
    if (!show.tvdbId) return
    setIsAddingToLibrary(true)
    addShowToLibrary(show.tvdbId!)
      .then(() => {
        router.refresh()
      })
      .catch((err: unknown) => {
        console.error(err)
        showToast('Failed to add show to library', 'error')
      })
      .finally(() => setIsAddingToLibrary(false))
  }, [show.tvdbId, router, showToast])

  const handleRemoveFromLibrary = useCallback(() => {
    openDialog({
      title: 'Remove from library',
      description: `Remove "${show.title}" from the library? This will delete all downloaded files and cannot be undone.`,
      onConfirm: () => {
        closeDialog()
        startTransition(async () => {
          await removeShowFromLibrary(show.id, show.tvdbId!)
          router.refresh()
        })
      },
    })
  }, [show.id, show.tvdbId, show.title, router, openDialog, closeDialog])

  const handleCancelDownloads = useCallback(() => {
    openDialog({
      title: 'Cancel downloads',
      description: `Cancel all active downloads for "${show.title}"? Episodes will be unmonitored.`,
      onConfirm: () => {
        closeDialog()
        startTransition(async () => {
          await Promise.all([
            cancelAllShowDownloads(show.id, show.tvdbId!),
            clearShowSearches(show.id),
          ])
          queryClient.setQueryData(['show-download-status', show.id], [])
          setClientSearchingIds(new Set())
          for (const timer of searchTimersRef.current.values()) clearTimeout(timer)
          searchTimersRef.current.clear()
          invalidateSearchState()
          router.refresh()
        })
      },
    })
  }, [
    show.id,
    show.tvdbId,
    show.title,
    router,
    queryClient,
    openDialog,
    closeDialog,
    invalidateSearchState,
  ])

  const handleDownloadEpisode = useCallback(
    (episodeId: number) => {
      addSearchingEpisodes([episodeId])
      triggerEpisodeDownload(episodeId, show.tvdbId!)
        .catch((err: unknown) => {
          console.error(err)
          showToast('Failed to trigger download', 'error')
          setClientSearchingIds(prev => {
            const next = new Set(prev)
            next.delete(episodeId)
            return next
          })
        })
    },
    [show.tvdbId, showToast, addSearchingEpisodes],
  )

  const handleDownloadSeason = useCallback(
    (seasonNumber: number): Promise<void> => {
      return triggerSeasonDownload(show.id, seasonNumber, show.tvdbId!)
        .then(result => {
          addSearchingEpisodes(result.registeredEpisodeIds)
        })
        .catch((err: unknown) => {
          console.error(err)
          showToast('Failed to trigger season download', 'error')
        })
    },
    [show.id, show.tvdbId, showToast, addSearchingEpisodes],
  )

  const handleDownloadSeries = useCallback(() => {
    triggerSeriesDownload(show.id, show.tvdbId!)
      .then(result => {
        addSearchingEpisodes(result.registeredEpisodeIds)
      })
      .catch((err: unknown) => {
        console.error(err)
        showToast('Failed to trigger series download', 'error')
      })
  }, [show.id, show.tvdbId, showToast, addSearchingEpisodes])

  const handleDeleteEpisodeFile = useCallback(
    (episodeFileId: number, episodeTitle: string | null) => {
      openDialog({
        title: 'Delete episode file',
        description: `Permanently delete "${episodeTitle ?? 'this episode'}"? This cannot be undone.`,
        onConfirm: () => {
          closeDialog()
          setDeletedEpisodeFileIds(prev => new Set(prev).add(episodeFileId))
          deleteEpisodeFile(episodeFileId, show.tvdbId!)
            .then(() => router.refresh())
            .catch(() => {
              setDeletedEpisodeFileIds(prev => {
                const next = new Set(prev)
                next.delete(episodeFileId)
                return next
              })
              showToast('Failed to delete episode file', 'error')
            })
        },
      })
    },
    [show.tvdbId, router, openDialog, closeDialog, showToast],
  )

  const handleDeleteSeason = useCallback(
    (seasonNumber: number) => {
      openDialog({
        title: `Delete Season ${seasonNumber}`,
        description: `Permanently delete all downloaded files for Season ${seasonNumber} of "${show.title}"? This cannot be undone.`,
        onConfirm: () => {
          closeDialog()
          const season = show.seasons.find(s => s.seasonNumber === seasonNumber)
          const fileIds =
            season?.episodes
              .filter(ep => ep.hasFile && ep.episodeFileId)
              .map(ep => ep.episodeFileId!) ?? []

          setDeletedEpisodeFileIds(prev => new Set([...prev, ...fileIds]))

          deleteSeasonFiles(show.id, seasonNumber, show.tvdbId!)
            .then(() => router.refresh())
            .catch(() => {
              setDeletedEpisodeFileIds(prev => {
                const next = new Set(prev)
                fileIds.forEach(id => next.delete(id))
                return next
              })

              showToast('Failed to delete season files', 'error')
            })
        },
      })
    },
    [show.id, show.tvdbId, show.title, show.seasons, router, openDialog, closeDialog, showToast],
  )

  return (
    <div className="space-y-8">
      <ShowHero
        show={show}
        isAddingToLibrary={isAddingToLibrary}
        hasActiveDownload={hasActiveDownloads}
        hasActiveSearches={effectiveHasActiveSearches}
        isPending={isPending}
        missingEpisodeCount={missingEpisodeCount}
        isDownloadingSeries={allMissingCovered}
        onAddToLibrary={handleAddToLibrary}
        onRemoveFromLibrary={handleRemoveFromLibrary}
        onCancelDownloads={handleCancelDownloads}
        onDownloadSeries={handleDownloadSeries}
      />

      <ShowMetadata show={show} />

      <ShowExternalLinks show={show} />

      <ShowScreenshotGallery
        screenshots={show.screenshots}
        title={show.title}
      />

      {show.isInLibrary && show.seasons.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-mono text-lg text-carbon-100">Episodes</h2>
          <div className="space-y-2">
            {show.seasons.map(season => (
              <SeasonAccordion
                key={season.seasonNumber}
                season={season}
                tvdbId={show.tvdbId!}
                isInLibrary={show.isInLibrary}
                downloadMap={downloadMap}
                searchingEpisodeIds={effectiveSearchingIds}
                timedOutEpisodeIds={timedOutEpisodeIds}
                isPending={isPending}
                isSearchingSeason={season.episodes.some(ep =>
                  effectiveSearchingIds.has(ep.id),
                )}
                defaultOpen={season.seasonNumber === defaultOpenSeason}
                deletedEpisodeFileIds={deletedEpisodeFileIds}
                onDownloadEpisode={handleDownloadEpisode}
                onDeleteEpisodeFile={handleDeleteEpisodeFile}
                onDownloadSeason={handleDownloadSeason}
                onDeleteSeason={handleDeleteSeason}
              />
            ))}
          </div>
        </div>
      )}

      {show.isInLibrary && show.seasons.length === 0 && (
        <p className="py-8 text-center font-mono text-sm text-carbon-500">
          No season data available yet. Check back after Sonarr has scanned the
          series.
        </p>
      )}

      <ConfirmDialog
        open={dialogState.open}
        title={dialogState.title}
        description={dialogState.description}
        onConfirm={dialogState.onConfirm}
        onClose={closeDialog}
      />
    </div>
  )
}
