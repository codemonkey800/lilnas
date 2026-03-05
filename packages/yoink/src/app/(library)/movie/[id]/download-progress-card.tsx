'use client'

import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'

import { formatBytes, type MovieDownloadInfo } from 'src/media'

interface DownloadProgressCardProps {
  liveDownload: MovieDownloadInfo | null
  isSearchingDownload: boolean
  isDownloadInitiated: boolean
  isImportState: boolean
  chipLabel: string
  chipColor: 'info' | 'warning' | 'success'
  progressBarColor: string
  downloadPercent: number
}

export function DownloadProgressCard({
  liveDownload,
  isSearchingDownload,
  isDownloadInitiated,
  isImportState,
  chipLabel,
  chipColor,
  progressBarColor,
  downloadPercent,
}: DownloadProgressCardProps) {
  if (!liveDownload && !isSearchingDownload && !isDownloadInitiated) return null

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="line-clamp-1 font-mono text-sm text-carbon-100">
          {liveDownload?.title ?? 'Searching indexers...'}
        </span>
        <Chip
          label={chipLabel}
          size="small"
          variant="outlined"
          color={chipColor}
          sx={{ height: 20, fontSize: '0.625rem' }}
        />
      </div>
      <LinearProgress
        variant={
          !liveDownload || isImportState ? 'indeterminate' : 'determinate'
        }
        value={!liveDownload || isImportState ? undefined : downloadPercent}
        sx={{
          height: 6,
          borderRadius: 3,
          bgcolor: 'var(--color-carbon-700)',
          '& .MuiLinearProgress-bar': {
            bgcolor: progressBarColor,
            borderRadius: 3,
          },
        }}
      />
      {liveDownload && (
        <div className="flex justify-between font-mono text-xs tabular-nums text-carbon-400">
          {isImportState ? (
            <span className="text-carbon-300">Importing to library...</span>
          ) : (
            <>
              <span>{downloadPercent}%</span>
              <span>
                {formatBytes(liveDownload.size - liveDownload.sizeleft)} /{' '}
                {formatBytes(liveDownload.size)}
              </span>
            </>
          )}
        </div>
      )}
    </Card>
  )
}
