'use client'

import { cns } from '@lilnas/utils/cns'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import { useState } from 'react'

import { type MovieDownloadInfo, type SeasonInfo } from 'src/media'

import { EpisodeItem } from './episode-item'

interface SeasonAccordionProps {
  season: SeasonInfo
  tvdbId: number
  isInLibrary: boolean
  downloadMap: Map<number, MovieDownloadInfo>
  searchingEpisodeIds: Set<number>
  timedOutEpisodeIds: Set<number>
  isPending: boolean
  isSearchingSeason: boolean
  defaultOpen?: boolean
  deletedEpisodeFileIds: Set<number>
  onDownloadEpisode: (episodeId: number) => void
  onDeleteEpisodeFile: (episodeFileId: number, title: string | null) => void
  onDownloadSeason: (seasonNumber: number) => Promise<void>
  onDeleteSeason: (seasonNumber: number) => void
}

export function SeasonAccordion({
  season,
  tvdbId,
  isInLibrary,
  downloadMap,
  searchingEpisodeIds,
  timedOutEpisodeIds,
  isPending,
  isSearchingSeason,
  defaultOpen = false,
  deletedEpisodeFileIds,
  onDownloadEpisode,
  onDeleteEpisodeFile,
  onDownloadSeason,
  onDeleteSeason,
}: SeasonAccordionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [isPendingDownload, setIsPendingDownload] = useState(false)

  const isSearchingOrPending = isSearchingSeason || isPendingDownload

  const optimisticDeletedInSeason = season.episodes.filter(
    ep => ep.episodeFileId && deletedEpisodeFileIds.has(ep.episodeFileId),
  ).length

  const optimisticDownloadedCount =
    season.downloadedCount - optimisticDeletedInSeason

  const downloadedRatio =
    season.episodeCount > 0
      ? (optimisticDownloadedCount / season.episodeCount) * 100
      : 0

  const allDownloaded =
    optimisticDownloadedCount === season.episodeCount && season.episodeCount > 0

  const hasMissing = optimisticDownloadedCount < season.episodeCount
  const hasDownloaded = optimisticDownloadedCount > 0

  // Count episodes in this season with a persisted "not found" record
  const notFoundCount = season.episodes.filter(
    ep =>
      !ep.hasFile &&
      ep.lastSearchedAt != null &&
      !(ep.episodeFileId && deletedEpisodeFileIds.has(ep.episodeFileId)),
  ).length

  return (
    <Card sx={{ overflow: 'hidden' }}>
      {/* Season header (clickable) */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(prev => !prev)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen(prev => !prev)
          }
        }}
        className={cns(
          'flex w-full items-center gap-4 px-4 py-3',
          'cursor-pointer transition-colors hover:bg-carbon-700/40',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-terminal/50',
        )}
      >
        {/* Season label */}
        <span className="font-mono text-sm font-medium text-carbon-100">
          Season {season.seasonNumber}
        </span>

        {/* Download ratio */}
        <span
          className={cns(
            'font-mono text-xs tabular-nums',
            allDownloaded ? 'text-terminal' : 'text-carbon-400',
          )}
        >
          {optimisticDownloadedCount}/{season.episodeCount}
        </span>

        {/* Not-found count indicator */}
        {notFoundCount > 0 && (
          <span
            className="font-mono text-xs tabular-nums"
            style={{ color: 'var(--color-warning)' }}
            title={`${notFoundCount} episode${notFoundCount > 1 ? 's' : ''} had no releases found last search`}
          >
            · {notFoundCount} not found
          </span>
        )}

        {/* Mini progress bar */}
        <LinearProgress
          variant="determinate"
          value={downloadedRatio}
          className="flex-1"
          sx={{
            height: 4,
            borderRadius: 2,
            bgcolor: 'var(--color-carbon-700)',
            '& .MuiLinearProgress-bar': {
              bgcolor: allDownloaded
                ? 'var(--color-terminal)'
                : 'var(--color-phosphor-600)',
              borderRadius: 2,
            },
          }}
        />

        {/* Season action buttons */}
        <span className="flex shrink-0 items-center gap-0.5">
          {/* Download season button */}
          {hasMissing && (
            <Tooltip
              title={isSearchingOrPending ? 'Searching...' : 'Download season'}
              placement="top"
              arrow
            >
              <span
                onClick={e => {
                  e.stopPropagation()
                }}
              >
                {isSearchingOrPending ? (
                  <span className="flex size-8 items-center justify-center">
                    <CircularProgress
                      size={14}
                      sx={{ color: 'var(--color-info)' }}
                    />
                  </span>
                ) : (
                  <IconButton
                    size="small"
                    disabled={isPending}
                    onClick={e => {
                      e.stopPropagation()
                      setIsPendingDownload(true)
                      onDownloadSeason(season.seasonNumber).finally(() => {
                        setIsPendingDownload(false)
                      })
                    }}
                    sx={{
                      color: 'var(--color-phosphor-500)',
                      bgcolor: 'rgba(57, 255, 20, 0.05)',
                      '&:hover': {
                        color: 'var(--color-terminal)',
                        bgcolor: 'rgba(57, 255, 20, 0.12)',
                      },
                      '&.Mui-disabled': { opacity: 0.2 },
                    }}
                  >
                    <DownloadIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                )}
              </span>
            </Tooltip>
          )}

          {/* Delete season button */}
          {hasDownloaded && (
            <Tooltip title="Delete season files" placement="top" arrow>
              <span
                onClick={e => {
                  e.stopPropagation()
                }}
              >
                <IconButton
                  size="small"
                  disabled={isPending}
                  onClick={e => {
                    e.stopPropagation()
                    onDeleteSeason(season.seasonNumber)
                  }}
                  sx={{
                    color: 'var(--color-carbon-500)',
                    '&:hover': {
                      color: 'var(--color-error)',
                      bgcolor: 'rgba(239, 68, 68, 0.08)',
                    },
                    '&.Mui-disabled': { opacity: 0.2 },
                  }}
                >
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </span>

        {/* Chevron */}
        <ExpandMoreIcon
          sx={{
            fontSize: 18,
            color: 'var(--color-carbon-400)',
            flexShrink: 0,
            transition: 'transform 200ms',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </div>

      {/* Episode list */}
      <Collapse in={open} timeout={200}>
        <div className="divide-y divide-carbon-700/60">
          {season.episodes.map(episode => (
            <EpisodeItem
              key={episode.id}
              episode={episode}
              tvdbId={tvdbId}
              isInLibrary={isInLibrary}
              liveDownload={downloadMap.get(episode.id) ?? null}
              isSearching={searchingEpisodeIds.has(episode.id)}
              isTimedOut={timedOutEpisodeIds.has(episode.id)}
              isPending={isPending}
              isDeleting={
                !!episode.episodeFileId &&
                deletedEpisodeFileIds.has(episode.episodeFileId)
              }
              onDownload={onDownloadEpisode}
              onDelete={onDeleteEpisodeFile}
            />
          ))}
          {season.episodes.length === 0 && (
            <p className="px-4 py-6 text-center font-mono text-sm text-carbon-500">
              No episodes available
            </p>
          )}
        </div>
      </Collapse>
    </Card>
  )
}
