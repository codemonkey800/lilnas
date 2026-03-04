'use client'

import { cns } from '@lilnas/utils/cns'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CancelIcon from '@mui/icons-material/Cancel'
import MovieIcon from '@mui/icons-material/Movie'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

import {
  formatBytes,
  formatRuntime,
  type MovieDetail,
  type MovieDownloadInfo,
} from 'src/lib/media'

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
  const router = useRouter()

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
    <div
      className={cns(
        'relative overflow-hidden',
        '-mt-4 md:-mt-6',
        'w-screen md:w-[calc(100vw-14rem)]',
        'ml-[calc((100%_-_100vw)_/_2)]',
        'md:ml-[calc((100%_-_(100vw_-_14rem))_/_2)]',
        !movie.fanartUrl && 'bg-carbon-800',
      )}
    >
      {movie.fanartUrl && (
        <Image
          src={movie.fanartUrl}
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-center opacity-60"
          priority
          aria-hidden
        />
      )}
      {/* Bottom fade: blends hero into page background */}
      <div className="absolute inset-0 bg-gradient-to-t from-carbon-900 via-carbon-900/40 to-transparent" />
      {/* Left vignette: keeps poster + text legible */}
      <div className="absolute inset-0 bg-gradient-to-r from-carbon-900/70 to-transparent" />

      <div className="relative z-10 px-4 pb-10 pt-4 md:px-6">
        <button
          type="button"
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push('/library')
          }
          className={cns(
            'mb-6 flex items-center gap-1 font-mono text-sm text-carbon-100',
            'transition-colors hover:text-white',
          )}
        >
          <ArrowBackIcon sx={{ fontSize: 16 }} />
          Back
        </button>

        <div className="flex flex-col gap-6 sm:flex-row">
          <div
            className={cns(
              'w-full shrink-0 self-start overflow-hidden rounded-lg sm:w-48',
              'border border-carbon-500 bg-carbon-700',
              'shadow-2xl shadow-black/60',
            )}
          >
            <div className="relative aspect-[2/3]">
              {movie.posterUrl ? (
                <Image
                  src={movie.posterUrl}
                  alt={movie.title}
                  fill
                  sizes="(max-width: 639px) 100vw, 192px"
                  className="object-cover"
                  priority
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <MovieIcon
                    className="text-carbon-500"
                    sx={{ fontSize: 64 }}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-3">
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
          </div>
        </div>
      </div>
    </div>
  )
}
