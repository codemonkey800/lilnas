'use client'

import AddIcon from '@mui/icons-material/Add'
import CancelIcon from '@mui/icons-material/Cancel'
import MovieIcon from '@mui/icons-material/Movie'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'

import { MediaHero } from 'src/components/media-hero'
import {
  formatBytes,
  formatRuntime,
  type MovieDetail,
  type MovieDownloadInfo,
} from 'src/media'

import { DownloadButton } from './download-button'
import { getQualityTier, QualityBadge } from './release-pills'

interface MovieHeroProps {
  movie: MovieDetail
  optimisticSizeOnDisk: number
  isAddingToLibrary: boolean
  showReleases: boolean
  isSearchingDownload: boolean
  isDownloadInitiated: boolean
  liveDownload: MovieDownloadInfo | null
  isPending: boolean
  onAddToLibrary: () => void
  onCancelDownload: () => void
  onDownload: () => void
  onRemoveFromLibrary: () => void
}

export function MovieHero({
  movie,
  optimisticSizeOnDisk,
  isAddingToLibrary,
  showReleases,
  isSearchingDownload,
  isDownloadInitiated,
  liveDownload,
  isPending,
  onAddToLibrary,
  onCancelDownload,
  onDownload,
  onRemoveFromLibrary,
}: MovieHeroProps) {
  const contextParts: string[] = []
  if (movie.year) contextParts.push(String(movie.year))
  if (movie.runtime) contextParts.push(formatRuntime(movie.runtime))
  if (movie.certification) contextParts.push(movie.certification)

  const ratings: { label: string; value: string }[] = []
  if (movie.ratings.tmdb)
    ratings.push({ label: 'TMDB', value: movie.ratings.tmdb.toFixed(1) })
  if (movie.ratings.imdb)
    ratings.push({ label: 'IMDb', value: movie.ratings.imdb.toFixed(1) })

  return (
    <MediaHero
      title={movie.title}
      posterUrl={movie.posterUrl}
      fanartUrl={movie.fanartUrl}
      posterFallback={
        <MovieIcon className="text-carbon-500" sx={{ fontSize: 64 }} />
      }
    >
      <h1 className="font-mono text-3xl font-bold text-carbon-50 drop-shadow-lg">
        {movie.title}
      </h1>

      {(contextParts.length > 0 || ratings.length > 0) && (
        <p className="flex flex-wrap items-baseline gap-x-1 font-mono text-sm tabular-nums text-carbon-50">
          {contextParts.map((part, i) => (
            <span key={part} className="flex items-baseline gap-x-1">
              {i > 0 && <span className="text-carbon-300">·</span>}
              <span>{part}</span>
            </span>
          ))}
          {ratings.map((r, i) => (
            <span key={r.label} className="flex items-baseline gap-x-1">
              {(contextParts.length > 0 || i > 0) && (
                <span className="text-carbon-300">·</span>
              )}
              <span className="font-semibold">{r.value}</span>
              <span>{r.label}</span>
            </span>
          ))}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {movie.quality && (
          <QualityBadge
            quality={movie.quality}
            tier={getQualityTier(movie.quality)}
          />
        )}
        {movie.genres.map(genre => (
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

      {movie.overview && (
        <p className="max-w-prose leading-relaxed text-carbon-50 drop-shadow">
          {movie.overview}
        </p>
      )}

      {optimisticSizeOnDisk > 0 && (
        <p className="font-mono text-xs text-carbon-400">
          {formatBytes(optimisticSizeOnDisk)} on disk
        </p>
      )}

      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap">
        {!movie.isInLibrary && (
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

        {movie.isInLibrary && liveDownload && (
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
            onClick={onCancelDownload}
          >
            {isPending ? 'Cancelling...' : 'Cancel Download'}
          </Button>
        )}

        {showReleases && (
          <DownloadButton
            movieId={movie.id}
            isSearching={isSearchingDownload}
            isPending={isPending}
            onDownload={onDownload}
          />
        )}

        {movie.isInLibrary &&
          !liveDownload &&
          !isSearchingDownload &&
          !isDownloadInitiated && (
            <Button
              variant="contained"
              color="error"
              size="small"
              className="w-full sm:w-auto"
              startIcon={<RemoveCircleOutlineIcon />}
              disabled={isPending}
              onClick={onRemoveFromLibrary}
            >
              Remove from Library
            </Button>
          )}
      </div>
    </MediaHero>
  )
}
