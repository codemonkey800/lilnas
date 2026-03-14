'use client'

import { cns } from '@lilnas/utils/cns'
import CancelIcon from '@mui/icons-material/Cancel'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import { useState } from 'react'

import type { SeasonDownloadGroup } from 'src/download/download.types'

import { EpisodeDownloadRow } from './episode-download-row'

interface SeasonDownloadGroupProps {
  season: SeasonDownloadGroup
  defaultOpen?: boolean
  onCancelEpisode: (episodeId: number) => void
  onCancelSeason: () => void
}

export function SeasonDownloadGroup({
  season,
  defaultOpen = true,
  onCancelEpisode,
  onCancelSeason,
}: SeasonDownloadGroupProps) {
  const [open, setOpen] = useState(defaultOpen)

  const activeEpisodes = season.episodes.filter(
    ep => ep.state === 'downloading' || ep.state === 'importing',
  )
  const searchingCount = season.episodes.filter(
    ep => ep.state === 'searching',
  ).length

  // Compute overall season progress from active episodes
  const totalSize = activeEpisodes.reduce((acc, ep) => acc + ep.size, 0)
  const totalSizeLeft = activeEpisodes.reduce((acc, ep) => acc + ep.sizeleft, 0)
  const overallProgress =
    totalSize > 0
      ? Math.round(((totalSize - totalSizeLeft) / totalSize) * 100)
      : 0

  const hasProgress = totalSize > 0

  return (
    <div className="rounded-md border border-carbon-600/60 overflow-hidden">
      {/* Season header */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-controls={`season-dl-${season.seasonNumber}-content`}
        onClick={() => setOpen(prev => !prev)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(prev => !prev)
          }
        }}
        className={cns(
          'flex w-full items-center gap-3 bg-carbon-700/40 px-4 py-2.5',
          'cursor-pointer select-none transition-colors hover:bg-carbon-700/60',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-terminal/50',
        )}
      >
        {/* Season label */}
        <span className="font-mono text-xs font-semibold uppercase tracking-widest text-carbon-300">
          Season {season.seasonNumber}
        </span>

        {/* Episode count */}
        <Chip
          label={`${season.episodes.length} ep`}
          size="small"
          color="secondary"
          variant="outlined"
          sx={{
            fontSize: '0.65rem',
            height: 18,
            '& .MuiChip-label': { px: 0.75 },
          }}
        />

        {/* Searching count */}
        {searchingCount > 0 && (
          <span className="font-mono text-xs text-info">
            {searchingCount} searching
          </span>
        )}

        {/* Mini progress bar */}
        {hasProgress && (
          <LinearProgress
            variant="determinate"
            value={overallProgress}
            className="flex-1"
            sx={{
              height: 3,
              borderRadius: 2,
              bgcolor: 'var(--color-carbon-700)',
              '& .MuiLinearProgress-bar': {
                bgcolor: 'var(--color-info)',
                borderRadius: 2,
                transition: 'transform 500ms ease-out',
              },
            }}
          />
        )}
        {!hasProgress && <span className="flex-1" />}

        {/* Cancel season button */}
        <Tooltip title="Cancel season downloads" placement="top" arrow>
          <span>
            <IconButton
              size="small"
              onClick={e => {
                e.stopPropagation()
                onCancelSeason()
              }}
              sx={{
                color: 'var(--color-carbon-500)',
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

        {/* Chevron */}
        <ExpandMoreIcon
          sx={{
            fontSize: 16,
            color: 'var(--color-carbon-500)',
            flexShrink: 0,
            transition: 'transform 200ms',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </div>

      {/* Episode rows */}
      <Collapse in={open} timeout={200}>
        <div
          id={`season-dl-${season.seasonNumber}-content`}
          className="divide-y divide-carbon-700/50 bg-carbon-800/50"
        >
          {season.episodes.map(episode => (
            <EpisodeDownloadRow
              key={episode.episodeId}
              episode={episode}
              onCancel={onCancelEpisode}
            />
          ))}
        </div>
      </Collapse>
    </div>
  )
}
