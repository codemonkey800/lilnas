'use client'

import AddIcon from '@mui/icons-material/Add'
import CancelIcon from '@mui/icons-material/Cancel'
import DownloadIcon from '@mui/icons-material/Download'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline'
import TvIcon from '@mui/icons-material/Tv'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'

import { MediaHero } from 'src/components/media-hero'
import { type ShowDetail } from 'src/media'

interface ShowHeroProps {
  show: ShowDetail
  isAddingToLibrary: boolean
  hasActiveDownload: boolean
  hasActiveSearches: boolean
  isPending: boolean
  missingEpisodeCount: number
  isDownloadingSeries: boolean
  onAddToLibrary: () => void
  onRemoveFromLibrary: () => void
  onCancelDownloads: () => void
  onDownloadSeries: () => void
}

export function ShowHero({
  show,
  isAddingToLibrary,
  hasActiveDownload,
  hasActiveSearches,
  isPending,
  missingEpisodeCount,
  isDownloadingSeries,
  onAddToLibrary,
  onRemoveFromLibrary,
  onCancelDownloads,
  onDownloadSeries,
}: ShowHeroProps) {
  const contextParts: string[] = []
  if (show.year) contextParts.push(String(show.year))
  if (show.seasons.length > 0) {
    const count = show.seasons.length
    contextParts.push(`${count} ${count === 1 ? 'Season' : 'Seasons'}`)
  }
  if (show.network) contextParts.push(show.network)
  if (show.certification) contextParts.push(show.certification)

  const statusLabel = show.status
    ? show.status.charAt(0).toUpperCase() + show.status.slice(1)
    : null

  return (
    <MediaHero
      title={show.title}
      posterUrl={show.posterUrl}
      fanartUrl={show.fanartUrl}
      posterFallback={
        <TvIcon className="text-carbon-500" sx={{ fontSize: 64 }} />
      }
    >
      <h1 className="font-mono text-3xl font-bold text-carbon-50 drop-shadow-lg">
        {show.title}
      </h1>

      {contextParts.length > 0 && (
        <p className="flex flex-wrap items-baseline gap-x-1 font-mono text-sm tabular-nums text-carbon-50">
          {contextParts.map((part, i) => (
            <span key={part} className="flex items-baseline gap-x-1">
              {i > 0 && <span className="text-carbon-300">·</span>}
              <span>{part}</span>
            </span>
          ))}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {statusLabel && (
          <Chip
            label={statusLabel}
            size="small"
            variant="outlined"
            color={show.status === 'ended' ? 'secondary' : 'success'}
            sx={{ height: 22, fontSize: '0.7rem' }}
          />
        )}
        {show.genres.map(genre => (
          <Chip
            key={genre}
            label={genre}
            size="small"
            variant="outlined"
            color="secondary"
            sx={{ height: 22, fontSize: '0.7rem' }}
          />
        ))}
      </div>

      {show.overview && (
        <p className="max-w-prose leading-relaxed text-carbon-50 drop-shadow">
          {show.overview}
        </p>
      )}

      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
        {!show.isInLibrary && (
          <Button
            variant="contained"
            color="primary"
            size="small"
            className="w-full sm:w-auto"
            startIcon={
              isAddingToLibrary ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <AddIcon />
              )
            }
            disabled={isAddingToLibrary}
            onClick={onAddToLibrary}
          >
            {isAddingToLibrary ? 'Adding...' : 'Add to Library'}
          </Button>
        )}

        {show.isInLibrary && missingEpisodeCount > 0 && (
          <Button
            variant="contained"
            color="primary"
            size="small"
            className="w-full sm:w-auto"
            startIcon={
              isDownloadingSeries ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <DownloadIcon />
              )
            }
            disabled={isDownloadingSeries || isPending}
            onClick={onDownloadSeries}
          >
            {isDownloadingSeries
              ? 'Downloading'
              : `Download Series (${missingEpisodeCount} missing)`}
          </Button>
        )}

        {show.isInLibrary && (hasActiveDownload || hasActiveSearches) && (
          <Button
            variant="contained"
            color="error"
            size="small"
            className="w-full sm:w-auto"
            startIcon={
              isPending ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <CancelIcon />
              )
            }
            disabled={isPending}
            onClick={onCancelDownloads}
          >
            {isPending ? 'Cancelling...' : 'Cancel Download'}
          </Button>
        )}

        {show.isInLibrary && !hasActiveDownload && !hasActiveSearches && (
          <Button
            variant="contained"
            color="error"
            size="small"
            className="w-full sm:w-auto"
            startIcon={
              isPending ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <RemoveCircleOutlineIcon />
              )
            }
            disabled={isPending}
            onClick={onRemoveFromLibrary}
          >
            {isPending ? 'Removing...' : 'Remove from Library'}
          </Button>
        )}
      </div>
    </MediaHero>
  )
}
