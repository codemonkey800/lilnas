'use client'

import DownloadIcon from '@mui/icons-material/Download'
import Chip from '@mui/material/Chip'
import { useCallback } from 'react'

import { ConfirmDialog } from 'src/components/confirm-dialog'
import { EmptyState } from 'src/components/empty-state'
import type { AllDownloadsResponse } from 'src/download/download.types'
import { useAllDownloadsState } from 'src/hooks/use-all-downloads-state'
import { useConfirmDialog } from 'src/hooks/use-confirm-dialog'
import { useToast } from 'src/hooks/use-toast'
import { api } from 'src/media/api.client'

import { MovieDownloadCard } from './movie-download-card'
import { ShowDownloadGroup } from './show-download-group'

interface DownloadsContentProps {
  initialData: AllDownloadsResponse
}

export function DownloadsContent({ initialData }: DownloadsContentProps) {
  const { movies, shows, hasAnyDownloads, totalCount } =
    useAllDownloadsState(initialData)
  const { dialogState, openDialog, closeDialog } = useConfirmDialog()
  const { showToast } = useToast()

  const handleCancelMovie = useCallback(
    (tmdbId: number) => {
      const movie = movies.find(m => m.tmdbId === tmdbId)
      openDialog({
        title: 'Cancel download',
        description: `Cancel the download for "${movie?.title ?? 'this movie'}"? This will remove it from the download queue.`,
        onConfirm: async () => {
          closeDialog()
          try {
            await api.cancelMovieDownload(tmdbId)
            showToast('Download cancelled', 'info')
          } catch {
            showToast('Failed to cancel download', 'error')
          }
        },
      })
    },
    [movies, openDialog, closeDialog, showToast],
  )

  const handleCancelAllShow = useCallback(
    (tvdbId: number, seriesId: number) => {
      const show = shows.find(s => s.tvdbId === tvdbId)
      openDialog({
        title: 'Cancel show downloads',
        description: `Cancel all downloads for "${show?.title ?? 'this show'}"? All episodes will be removed from the queue.`,
        onConfirm: async () => {
          closeDialog()
          try {
            await api.cancelAllShowDownloads({ tvdbId, seriesId })
            showToast('Show downloads cancelled', 'info')
          } catch {
            showToast('Failed to cancel downloads', 'error')
          }
        },
      })
    },
    [shows, openDialog, closeDialog, showToast],
  )

  const handleCancelSeason = useCallback(
    (tvdbId: number, seriesId: number, seasonNumber: number) => {
      const show = shows.find(s => s.tvdbId === tvdbId)
      openDialog({
        title: `Cancel Season ${seasonNumber}`,
        description: `Cancel all downloads for Season ${seasonNumber} of "${show?.title ?? 'this show'}"?`,
        onConfirm: async () => {
          closeDialog()
          try {
            await api.cancelSeasonDownloads(tvdbId, seriesId, seasonNumber)
            showToast(`Season ${seasonNumber} downloads cancelled`, 'info')
          } catch {
            showToast('Failed to cancel downloads', 'error')
          }
        },
      })
    },
    [shows, openDialog, closeDialog, showToast],
  )

  const handleCancelEpisode = useCallback(
    (episodeId: number) => {
      openDialog({
        title: 'Cancel episode download',
        description:
          'Cancel this episode download? It will be removed from the queue.',
        onConfirm: async () => {
          closeDialog()
          try {
            await api.cancelEpisodeDownload(episodeId)
            showToast('Episode download cancelled', 'info')
          } catch {
            showToast('Failed to cancel download', 'error')
          }
        },
      })
    },
    [openDialog, closeDialog, showToast],
  )

  return (
    <>
      {/* Page header */}
      <div className="mb-6 flex items-center gap-3">
        <h1 className="font-mono text-2xl font-bold text-carbon-50">
          Downloads
        </h1>
        {hasAnyDownloads && (
          <Chip
            label={totalCount}
            size="small"
            color="info"
            variant="outlined"
            sx={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}
          />
        )}
      </div>

      {/* Content */}
      {!hasAnyDownloads ? (
        <EmptyState
          icon={<DownloadIcon />}
          title="No active downloads"
          description="Downloads will appear here as they start. Search for movies and shows to get started."
        />
      ) : (
        <div className="space-y-6">
          {/* Movies section */}
          {movies.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-carbon-400">
                  Movies
                </h2>
                <Chip
                  label={movies.length}
                  size="small"
                  color="secondary"
                  variant="outlined"
                  sx={{
                    fontSize: '0.65rem',
                    height: 18,
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-1 lg:grid-cols-2">
                {movies.map((movie, i) => (
                  <MovieDownloadCard
                    key={movie.tmdbId}
                    movie={movie}
                    style={{ animationDelay: `${i * 60}ms` }}
                    onCancel={handleCancelMovie}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Shows section */}
          {shows.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-2">
                <h2 className="font-mono text-xs font-semibold uppercase tracking-widest text-carbon-400">
                  Shows
                </h2>
                <Chip
                  label={shows.length}
                  size="small"
                  color="secondary"
                  variant="outlined"
                  sx={{
                    fontSize: '0.65rem',
                    height: 18,
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              </div>
              <div className="space-y-4">
                {shows.map((show, i) => (
                  <ShowDownloadGroup
                    key={show.tvdbId}
                    show={show}
                    style={{ animationDelay: `${(movies.length + i) * 60}ms` }}
                    onCancelAll={handleCancelAllShow}
                    onCancelSeason={handleCancelSeason}
                    onCancelEpisode={handleCancelEpisode}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog
        open={dialogState.open}
        title={dialogState.title}
        description={dialogState.description}
        onConfirm={dialogState.onConfirm}
        onClose={closeDialog}
      />
    </>
  )
}
