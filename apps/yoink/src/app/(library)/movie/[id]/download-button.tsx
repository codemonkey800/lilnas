'use client'

import DownloadIcon from '@mui/icons-material/Download'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'

import { useMovieReleases } from './use-movie-releases'

interface DownloadButtonProps {
  movieId: number
  isSearching: boolean
  isPending: boolean
  onDownload: () => void
}

export function DownloadButton({
  movieId,
  isSearching,
  isPending,
  onDownload,
}: DownloadButtonProps) {
  const { releases } = useMovieReleases(movieId)

  const hasReleases = releases !== null && releases.length > 0

  if (!hasReleases) return null

  return (
    <Button
      variant="contained"
      color="primary"
      size="small"
      className="w-full sm:w-auto"
      startIcon={
        isSearching ? (
          <CircularProgress size={16} color="inherit" />
        ) : (
          <DownloadIcon />
        )
      }
      disabled={isSearching || isPending}
      onClick={onDownload}
    >
      {isSearching ? 'Searching...' : 'Download'}
    </Button>
  )
}
