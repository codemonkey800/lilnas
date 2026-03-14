'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState, useTransition } from 'react'

const EMPTY_ID_SET = new Set<number>()

import { ConfirmDialog } from 'src/components/confirm-dialog'
import type { ShowDownloadStatusResponse } from 'src/download/download.types'
import { useConfirmDialog } from 'src/hooks/use-confirm-dialog'
import { useToast } from 'src/hooks/use-toast'
import { type ShowDetail } from 'src/media'
import { api } from 'src/media/api.client'

import {
  addShowToLibrary,
  cancelAllShowDownloads,
  deleteEpisodeFile,
  deleteSeasonFiles,
  removeShowFromLibrary,
} from './actions'
import { SeasonAccordion } from './season-accordion'
import { ShowExternalLinks } from './show-external-links'
import { ShowHero } from './show-hero'
import { ShowMetadata } from './show-metadata'
import { ShowScreenshotGallery } from './show-screenshot-gallery'
import { useShowDownload } from './use-show-download'

interface ShowDetailContentProps {
  show: ShowDetail
  initialDownloadStatus?: ShowDownloadStatusResponse
}

export function ShowDetailContent({
  show,
  initialDownloadStatus,
}: ShowDetailContentProps) {
  const router = useRouter()
  const { showToast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false)
  const [deletedEpisodeFileIds, setDeletedEpisodeFileIds] = useState<
    Set<number>
  >(new Set())

  const { dialogState, openDialog, closeDialog } = useConfirmDialog()

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

  const {
    downloadMap,
    hasActiveDownloads,
    hasActiveSearches,
    searchingEpisodeIds,
  } = useShowDownload(
    show.tvdbId ?? null,
    show.id,
    initialDownloads,
    initialDownloadStatus,
  )

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

  const allMissingCovered = useMemo(() => {
    const now = new Date()
    const missingEpisodes = show.seasons.flatMap(s =>
      s.episodes.filter(
        ep => !ep.hasFile && ep.airDate && new Date(ep.airDate) <= now,
      ),
    )
    if (missingEpisodes.length === 0) return false
    return missingEpisodes.every(
      ep => searchingEpisodeIds.has(ep.id) || downloadMap.has(ep.id),
    )
  }, [show.seasons, searchingEpisodeIds, downloadMap])

  const defaultOpenSeason = useMemo(() => {
    for (const season of show.seasons) {
      if (season.downloadedCount < season.episodeCount) {
        return season.seasonNumber
      }
    }
    return show.seasons.at(-1)?.seasonNumber ?? null
  }, [show.seasons])

  const handleAddToLibrary = useCallback(async () => {
    if (!show.tvdbId) return
    setIsAddingToLibrary(true)
    try {
      await addShowToLibrary(show.tvdbId!)
      router.refresh()
    } catch (err: unknown) {
      console.error(err)
      showToast('Failed to add show to library', 'error')
    } finally {
      setIsAddingToLibrary(false)
    }
  }, [show.tvdbId, router, showToast])

  const handleRemoveFromLibrary = useCallback(() => {
    openDialog({
      title: 'Remove from library',
      description: `Remove "${show.title}" from the library? This will delete all downloaded files and cannot be undone.`,
      onConfirm: () => {
        closeDialog()
        startTransition(async () => {
          await removeShowFromLibrary({
            seriesId: show.id,
            tvdbId: show.tvdbId!,
          })
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
          await cancelAllShowDownloads({
            seriesId: show.id,
            tvdbId: show.tvdbId!,
          })
          router.refresh()
        })
      },
    })
  }, [show.id, show.tvdbId, show.title, router, openDialog, closeDialog])

  const handleDownloadEpisode = useCallback(
    async (episodeId: number) => {
      try {
        await api.requestShowDownload(show.tvdbId!, 'episode', { episodeId })
      } catch (err: unknown) {
        console.error(err)
        showToast('Failed to trigger download', 'error')
      }
    },
    [show.tvdbId, showToast],
  )

  const handleDownloadSeason = useCallback(
    async (seasonNumber: number): Promise<void> => {
      try {
        await api.requestShowDownload(show.tvdbId!, 'season', { seasonNumber })
      } catch (err: unknown) {
        console.error(err)
        showToast('Failed to trigger season download', 'error')
      }
    },
    [show.tvdbId, showToast],
  )

  const handleDownloadSeries = useCallback(async () => {
    try {
      await api.requestShowDownload(show.tvdbId!, 'series')
    } catch (err: unknown) {
      console.error(err)
      showToast('Failed to trigger series download', 'error')
    }
  }, [show.tvdbId, showToast])

  const handleDeleteEpisodeFile = useCallback(
    (episodeFileId: number, episodeTitle: string | null) => {
      openDialog({
        title: 'Delete episode file',
        description: `Permanently delete "${episodeTitle ?? 'this episode'}"? This cannot be undone.`,
        onConfirm: async () => {
          closeDialog()
          setDeletedEpisodeFileIds(prev => new Set(prev).add(episodeFileId))
          try {
            await deleteEpisodeFile({ episodeFileId, tvdbId: show.tvdbId! })
            router.refresh()
          } catch {
            setDeletedEpisodeFileIds(prev => {
              const next = new Set(prev)
              next.delete(episodeFileId)
              return next
            })
            showToast('Failed to delete episode file', 'error')
          }
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
        onConfirm: async () => {
          closeDialog()
          const season = show.seasons.find(s => s.seasonNumber === seasonNumber)
          const fileIds =
            season?.episodes
              .filter(ep => ep.hasFile && ep.episodeFileId)
              .map(ep => ep.episodeFileId!) ?? []

          setDeletedEpisodeFileIds(prev => new Set([...prev, ...fileIds]))

          try {
            await deleteSeasonFiles({
              seriesId: show.id,
              seasonNumber,
              tvdbId: show.tvdbId!,
            })
            router.refresh()
          } catch {
            setDeletedEpisodeFileIds(prev => {
              const next = new Set(prev)
              fileIds.forEach(id => next.delete(id))
              return next
            })
            showToast('Failed to delete season files', 'error')
          }
        },
      })
    },
    [
      show.id,
      show.tvdbId,
      show.title,
      show.seasons,
      router,
      openDialog,
      closeDialog,
      showToast,
    ],
  )

  return (
    <div className="space-y-8">
      <ShowHero
        show={show}
        isAddingToLibrary={isAddingToLibrary}
        hasActiveDownload={hasActiveDownloads}
        hasActiveSearches={hasActiveSearches}
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
                searchingEpisodeIds={searchingEpisodeIds}
                timedOutEpisodeIds={EMPTY_ID_SET}
                isPending={isPending}
                isSearchingSeason={season.episodes.some(ep =>
                  searchingEpisodeIds.has(ep.id),
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
