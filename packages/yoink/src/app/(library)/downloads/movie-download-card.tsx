'use client'

import { cns } from '@lilnas/utils/cns'
import CancelIcon from '@mui/icons-material/Cancel'
import MovieIcon from '@mui/icons-material/Movie'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import Image from 'next/image'
import Link from 'next/link'

import type { MovieDownloadItem } from 'src/download/download.types'
import { formatBytes, formatEta } from 'src/media/format'

interface MovieDownloadCardProps {
  movie: MovieDownloadItem
  style?: React.CSSProperties
  onCancel: (tmdbId: number) => void
}

export function MovieDownloadCard({
  movie,
  style,
  onCancel,
}: MovieDownloadCardProps) {
  const isSearching = movie.state === 'searching'
  const isImporting = movie.state === 'importing'
  const sizeDownloaded = movie.size - movie.sizeleft

  return (
    <div
      className={cns(
        'animate-fade-in group relative overflow-hidden rounded-lg border bg-carbon-800 transition-all duration-300',
        isSearching
          ? 'border-carbon-500 animate-glow-pulse'
          : isImporting
            ? 'border-terminal/30'
            : 'border-info/30',
      )}
      style={style}
    >
      <div className="flex gap-4 p-4">
        {/* Poster */}
        <Link
          href={`/movie/${movie.tmdbId}`}
          className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terminal/50 rounded"
        >
          <div className="relative h-20 w-[54px] overflow-hidden rounded border border-carbon-600">
            {movie.posterUrl ? (
              <Image
                src={movie.posterUrl}
                alt={movie.title}
                fill
                className="object-cover"
                sizes="54px"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-carbon-700">
                <MovieIcon
                  sx={{ fontSize: 22, color: 'var(--color-carbon-500)' }}
                />
              </div>
            )}
          </div>
        </Link>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href={`/movie/${movie.tmdbId}`}
                className={cns(
                  'block font-mono text-sm font-semibold text-carbon-100',
                  'hover:text-terminal transition-colors truncate',
                )}
              >
                {movie.title}
              </Link>
              <span className="font-mono tabular-nums text-xs text-carbon-500">
                {movie.year}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {/* State chip */}
              {isSearching ? (
                <span className="flex items-center gap-1.5 font-mono text-xs text-carbon-400">
                  <CircularProgress
                    size={12}
                    sx={{ color: 'var(--color-info)' }}
                  />
                  Searching...
                </span>
              ) : (
                <Chip
                  label={isImporting ? 'Importing' : 'Downloading'}
                  color={isImporting ? 'success' : 'info'}
                  size="small"
                  variant="outlined"
                />
              )}

              {/* Cancel */}
              <Tooltip title="Cancel download" placement="top" arrow>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => onCancel(movie.tmdbId)}
                    sx={{
                      color: 'var(--color-carbon-500)',
                      '&:hover': {
                        color: 'var(--color-error)',
                        bgcolor: 'rgba(255, 68, 68, 0.08)',
                      },
                    }}
                  >
                    <CancelIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </span>
              </Tooltip>
            </div>
          </div>

          {/* Release title */}
          {movie.releaseTitle && (
            <p className="mt-1 truncate font-mono text-xs text-carbon-500">
              {movie.releaseTitle}
            </p>
          )}

          {/* Progress section */}
          {!isSearching && movie.size > 0 && (
            <div className="mt-3 space-y-1.5">
              <LinearProgress
                variant="determinate"
                value={movie.progress}
                sx={{
                  height: 5,
                  borderRadius: 3,
                  bgcolor: 'var(--color-carbon-700)',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: isImporting
                      ? 'var(--color-terminal)'
                      : 'var(--color-info)',
                    borderRadius: 3,
                    transition: 'transform 500ms ease-out',
                    ...(isImporting && {
                      boxShadow: '0 0 8px rgba(57, 255, 20, 0.4)',
                    }),
                  },
                }}
              />
              <div className="flex items-center justify-between">
                <span className="font-mono tabular-nums text-xs text-carbon-400">
                  {movie.progress}%{' · '}
                  {formatBytes(sizeDownloaded)} / {formatBytes(movie.size)}
                </span>
                {movie.eta && !isImporting && (
                  <span className="font-mono tabular-nums text-xs text-carbon-500">
                    {formatEta(movie.eta)} remaining
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Searching indicator bar */}
      {isSearching && (
        <LinearProgress
          sx={{
            height: 2,
            bgcolor: 'transparent',
            '& .MuiLinearProgress-bar': { bgcolor: 'var(--color-info)' },
          }}
        />
      )}
    </div>
  )
}
