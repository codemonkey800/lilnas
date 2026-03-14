'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useState, useTransition } from 'react'

import { ConfirmDialog } from 'src/components/confirm-dialog'
import type { MovieDownloadStatusResponse } from 'src/download/download.types'
import { useConfirmDialog } from 'src/hooks/use-confirm-dialog'
import { useToast } from 'src/hooks/use-toast'
import { type MovieDetail } from 'src/media'
import { api } from 'src/media/api.client'

import {
  addMovieToLibrary,
  cancelDownload,
  deleteMovieFile,
  removeMovieFromLibrary,
} from './actions'
import { DownloadProgressCard } from './download-progress-card'
import { FileList } from './file-list'
import { MovieHero } from './movie-hero'
import { NotFoundCard } from './not-found-card'
import { ReleaseList } from './release-list'
import { useMovieDownload } from './use-movie-download'

interface MovieDetailContentProps {
  movie: MovieDetail
  initialDownloadStatus?: MovieDownloadStatusResponse | null
}

export function MovieDetailContent({
  movie,
  initialDownloadStatus,
}: MovieDetailContentProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false)
  const [deletedFileIds, setDeletedFileIds] = useState<Set<number>>(new Set())

  const { dialogState, openDialog, closeDialog } = useConfirmDialog()
  const {
    downloadState,
    liveDownload,
    isSearchingDownload,
    isDownloadInitiated,
    downloadPercent,
    isImportState,
    chipLabel,
    chipColor,
    progressBarColor,
  } = useMovieDownload(movie, initialDownloadStatus)

  const handleDownload = useCallback(async () => {
    if (!movie.tmdbId) return
    try {
      await api.requestMovieDownload(movie.tmdbId)
    } catch (err) {
      console.error(err)
      showToast('Failed to start download', 'error')
    }
  }, [movie.tmdbId, showToast])

  const handleAddToLibrary = useCallback(async () => {
    if (!movie.tmdbId) return
    setIsAddingToLibrary(true)
    try {
      await addMovieToLibrary(movie.tmdbId)
      router.refresh()
    } catch (err: unknown) {
      console.error(err)
      showToast('Failed to add movie to library', 'error')
    } finally {
      setIsAddingToLibrary(false)
    }
  }, [movie.tmdbId, router, showToast])

  const handleCancelDownload = useCallback(() => {
    if (!liveDownload || !movie.tmdbId) return
    const { tmdbId } = movie
    openDialog({
      title: 'Cancel download',
      description: `Cancel the active download for "${movie.title}"?`,
      onConfirm: () => {
        closeDialog()
        startTransition(async () => {
          await cancelDownload(tmdbId)
          queryClient.setQueryData(['download-status', movie.id], null)
          router.refresh()
        })
      },
    })
  }, [liveDownload, movie, openDialog, closeDialog, queryClient, router])

  const handleDeleteFile = useCallback(
    (fileId: number, fileName: string | null) => {
      if (!movie.tmdbId) return
      const { tmdbId } = movie
      openDialog({
        title: 'Delete file',
        description: `Permanently delete "${fileName ?? 'this file'}"? This cannot be undone.`,
        onConfirm: async () => {
          closeDialog()
          setDeletedFileIds(prev => new Set(prev).add(fileId))
          try {
            await deleteMovieFile({ movieFileId: fileId, tmdbId })
            router.refresh()
          } catch {
            setDeletedFileIds(prev => {
              const next = new Set(prev)
              next.delete(fileId)
              return next
            })
            showToast('Failed to delete file', 'error')
          }
        },
      })
    },
    [movie, router, openDialog, closeDialog, showToast],
  )

  const handleRemoveFromLibrary = useCallback(() => {
    openDialog({
      title: 'Remove from library',
      description: `Remove "${movie.title}" from the library? This will delete all downloaded files and cannot be undone.`,
      onConfirm: () => {
        closeDialog()
        startTransition(async () => {
          await removeMovieFromLibrary({
            movieId: movie.id,
            tmdbId: movie.tmdbId,
          })
          router.refresh()
        })
      },
    })
  }, [movie.id, movie.tmdbId, movie.title, router, openDialog, closeDialog])

  const optimisticFiles = movie.files.filter(f => !deletedFileIds.has(f.id))
  const deletedFilesSize = movie.files
    .filter(f => deletedFileIds.has(f.id))
    .reduce((sum, f) => sum + f.size, 0)
  const optimisticSizeOnDisk = Math.max(
    0,
    (movie.sizeOnDisk ?? 0) - deletedFilesSize,
  )

  const hasFiles = optimisticFiles.length > 0
  const optimisticIsDownloaded = hasFiles && movie.status === 'downloaded'
  const isActive =
    downloadState.state !== 'idle' && downloadState.state !== 'completed'

  const showReleases =
    movie.isInLibrary &&
    movie.tmdbId != null &&
    !optimisticIsDownloaded &&
    !isActive

  const showNotFound =
    movie.lastSearchedAt != null && !optimisticIsDownloaded && !isActive

  return (
    <div className="space-y-8">
      <MovieHero
        movie={movie}
        optimisticSizeOnDisk={optimisticSizeOnDisk}
        isAddingToLibrary={isAddingToLibrary}
        showReleases={showReleases}
        isSearchingDownload={isSearchingDownload}
        isDownloadInitiated={isDownloadInitiated}
        liveDownload={liveDownload}
        isPending={isPending}
        onAddToLibrary={handleAddToLibrary}
        onCancelDownload={handleCancelDownload}
        onDownload={handleDownload}
        onRemoveFromLibrary={handleRemoveFromLibrary}
      />

      {showNotFound && <NotFoundCard lastSearchedAt={movie.lastSearchedAt!} />}

      <DownloadProgressCard
        downloadState={downloadState.state}
        liveDownload={liveDownload}
        isImportState={isImportState}
        chipLabel={chipLabel}
        chipColor={chipColor}
        progressBarColor={progressBarColor}
        downloadPercent={downloadPercent}
      />

      <FileList
        files={optimisticFiles}
        isPending={isPending}
        onDelete={handleDeleteFile}
      />

      {showReleases && movie.tmdbId != null && (
        <ReleaseList movieId={movie.id} tmdbId={movie.tmdbId} />
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
