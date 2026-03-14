'use client'

import { cns } from '@lilnas/utils/cns'
import CancelIcon from '@mui/icons-material/Cancel'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import TvIcon from '@mui/icons-material/Tv'
import Chip from '@mui/material/Chip'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

import type { ShowDownloadItem } from 'src/download/download.types'

import { SeasonDownloadGroup } from './season-download-group'

interface ShowDownloadGroupProps {
  show: ShowDownloadItem
  style?: React.CSSProperties
  onCancelAll: (tvdbId: number, seriesId: number) => void
  onCancelSeason: (
    tvdbId: number,
    seriesId: number,
    seasonNumber: number,
  ) => void
  onCancelEpisode: (episodeId: number) => void
}

export function ShowDownloadGroup({
  show,
  style,
  onCancelAll,
  onCancelSeason,
  onCancelEpisode,
}: ShowDownloadGroupProps) {
  const [expanded, setExpanded] = useState(true)

  const totalEpisodes = show.seasons.reduce(
    (acc, s) => acc + s.episodes.length,
    0,
  )
  const activeEpisodes = show.seasons.flatMap(s =>
    s.episodes.filter(
      ep => ep.state === 'downloading' || ep.state === 'importing',
    ),
  )
  const searchingCount = show.seasons.flatMap(s =>
    s.episodes.filter(ep => ep.state === 'searching'),
  ).length

  const totalSize = activeEpisodes.reduce((acc, ep) => acc + ep.size, 0)
  const totalSizeLeft = activeEpisodes.reduce((acc, ep) => acc + ep.sizeleft, 0)
  const overallProgress =
    totalSize > 0
      ? Math.round(((totalSize - totalSizeLeft) / totalSize) * 100)
      : 0

  const hasProgress = totalSize > 0

  return (
    <div
      className="animate-fade-in overflow-hidden rounded-lg border border-carbon-500 bg-carbon-800"
      style={style}
    >
      {/* Show header */}
      <div className="flex items-center gap-4 p-4">
        {/* Poster */}
        <Link
          href={`/show/${show.tvdbId}`}
          className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terminal/50 rounded"
          onClick={e => e.stopPropagation()}
        >
          <div className="relative h-16 w-11 overflow-hidden rounded border border-carbon-600">
            {show.posterUrl ? (
              <Image
                src={show.posterUrl}
                alt={show.title}
                fill
                className="object-cover"
                sizes="44px"
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-carbon-700">
                <TvIcon
                  sx={{ fontSize: 20, color: 'var(--color-carbon-500)' }}
                />
              </div>
            )}
          </div>
        </Link>

        {/* Show info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <Link
                href={`/show/${show.tvdbId}`}
                className={cns(
                  'block truncate font-mono text-sm font-semibold text-carbon-100',
                  'hover:text-terminal transition-colors',
                )}
              >
                {show.title}
              </Link>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="font-mono tabular-nums text-xs text-carbon-500">
                  {show.year}
                </span>
                <span className="font-mono tabular-nums text-xs text-carbon-500">
                  ·
                </span>
                <span className="font-mono tabular-nums text-xs text-carbon-400">
                  {totalEpisodes} ep
                </span>
                {searchingCount > 0 && (
                  <>
                    <span className="font-mono tabular-nums text-xs text-carbon-500">
                      ·
                    </span>
                    <span className="font-mono tabular-nums text-xs text-info">
                      {searchingCount} searching
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Season count chip */}
            <Chip
              label={`${show.seasons.length} season${show.seasons.length !== 1 ? 's' : ''}`}
              size="small"
              color="secondary"
              variant="outlined"
              sx={{ fontSize: '0.7rem', height: 20, flexShrink: 0 }}
            />
          </div>

          {/* Overall progress bar */}
          {hasProgress && (
            <div className="mt-2 flex items-center gap-2">
              <LinearProgress
                variant="determinate"
                value={overallProgress}
                className="flex-1"
                sx={{
                  height: 4,
                  borderRadius: 2,
                  bgcolor: 'var(--color-carbon-700)',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: 'var(--color-info)',
                    borderRadius: 2,
                    transition: 'transform 500ms ease-out',
                  },
                }}
              />
              <span className="w-9 text-right font-mono tabular-nums text-xs text-carbon-500">
                {overallProgress}%
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip title="Cancel all show downloads" placement="top" arrow>
            <span>
              <IconButton
                size="small"
                onClick={() => onCancelAll(show.tvdbId, show.seriesId)}
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

          <Tooltip
            title={expanded ? 'Collapse seasons' : 'Expand seasons'}
            placement="top"
            arrow
          >
            <IconButton
              size="small"
              onClick={() => setExpanded(prev => !prev)}
              sx={{ color: 'var(--color-carbon-400)' }}
            >
              <ExpandMoreIcon
                sx={{
                  fontSize: 18,
                  transition: 'transform 200ms',
                  transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      {/* Season groups */}
      <Collapse in={expanded} timeout={200}>
        <div className="space-y-2 border-t border-carbon-700/60 p-4 pt-3">
          {show.seasons.map(season => (
            <SeasonDownloadGroup
              key={season.seasonNumber}
              season={season}
              defaultOpen={show.seasons.length === 1}
              onCancelEpisode={onCancelEpisode}
              onCancelSeason={() =>
                onCancelSeason(show.tvdbId, show.seriesId, season.seasonNumber)
              }
            />
          ))}
        </div>
      </Collapse>
    </div>
  )
}
