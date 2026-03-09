'use client'

import { cns } from '@lilnas/utils/cns'
import CancelIcon from '@mui/icons-material/Cancel'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'

import type { EpisodeDownloadItem } from 'src/download/download.types'
import { formatBytes, formatEta } from 'src/media/format'

interface EpisodeDownloadRowProps {
  episode: EpisodeDownloadItem
  onCancel: (episodeId: number) => void
}

export function EpisodeDownloadRow({
  episode,
  onCancel,
}: EpisodeDownloadRowProps) {
  const isSearching = episode.state === 'searching'
  const isImporting = episode.state === 'importing'
  const sizeDownloaded = episode.size - episode.sizeleft

  return (
    <div className="group flex flex-col gap-1.5 px-4 py-3 hover:bg-carbon-700/30 transition-colors">
      <div className="flex items-center gap-3">
        {/* Episode number */}
        <span className="w-10 shrink-0 font-mono tabular-nums text-xs text-carbon-500">
          E{String(episode.episodeNumber).padStart(2, '0')}
        </span>

        {/* Episode title / searching indicator */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isSearching ? (
            <span className="flex items-center gap-1.5 font-mono text-xs text-carbon-400">
              <CircularProgress size={10} sx={{ color: 'var(--color-info)' }} />
              Searching...
            </span>
          ) : (
            <span className="truncate font-mono text-xs text-carbon-200">
              {episode.releaseTitle ?? `Episode ${episode.episodeNumber}`}
            </span>
          )}
        </div>

        {/* State chip */}
        {!isSearching && (
          <Chip
            label={isImporting ? 'Importing' : 'Downloading'}
            color={isImporting ? 'success' : 'info'}
            size="small"
            variant="outlined"
            sx={{
              fontSize: '0.65rem',
              height: 18,
              '& .MuiChip-label': { px: 0.75 },
            }}
          />
        )}

        {/* Stats */}
        {!isSearching && episode.size > 0 && (
          <span className="hidden shrink-0 font-mono tabular-nums text-xs text-carbon-500 sm:block">
            {formatBytes(sizeDownloaded)}&nbsp;/&nbsp;
            {formatBytes(episode.size)}
          </span>
        )}

        {/* ETA */}
        {episode.eta && !isImporting && (
          <span className="hidden shrink-0 font-mono tabular-nums text-xs text-carbon-500 md:block">
            {formatEta(episode.eta)}
          </span>
        )}

        {/* Cancel button */}
        <Tooltip title="Cancel episode download" placement="top" arrow>
          <span>
            <IconButton
              size="small"
              onClick={() => onCancel(episode.episodeId)}
              sx={{
                color: 'var(--color-carbon-500)',
                opacity: 0,
                transition: 'opacity 150ms, color 150ms',
                '.group:hover &': { opacity: 1 },
                '&:hover': {
                  color: 'var(--color-error)',
                  bgcolor: 'rgba(255, 68, 68, 0.08)',
                },
              }}
            >
              <CancelIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </span>
        </Tooltip>
      </div>

      {/* Progress bar */}
      {!isSearching && episode.size > 0 && (
        <div className="flex items-center gap-2 pl-[52px]">
          <LinearProgress
            variant="determinate"
            value={episode.progress}
            className={cns('flex-1', isImporting && 'animate-glow-pulse')}
            sx={{
              height: 3,
              borderRadius: 2,
              bgcolor: 'var(--color-carbon-700)',
              '& .MuiLinearProgress-bar': {
                bgcolor: isImporting
                  ? 'var(--color-terminal)'
                  : 'var(--color-info)',
                borderRadius: 2,
                transition: 'transform 500ms ease-out',
              },
            }}
          />
          <span className="shrink-0 font-mono tabular-nums text-xs text-carbon-500 w-9 text-right">
            {episode.progress}%
          </span>
        </div>
      )}
    </div>
  )
}
