'use client'

import { cns } from '@lilnas/utils/cns'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useState } from 'react'

dayjs.extend(relativeTime)

import {
  getQualityTier,
  QualityBadge,
} from 'src/components/releases/release-pills'
import {
  type EpisodeInfo,
  formatBytes,
  type MovieDownloadInfo,
} from 'src/media'

import { EpisodeReleaseDialog } from './episode-release-dialog'

function formatAirDate(airDate: string | null): string | null {
  if (!airDate) return null
  const date = new Date(airDate)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

interface EpisodeItemProps {
  episode: EpisodeInfo
  tvdbId: number
  isInLibrary: boolean
  liveDownload: MovieDownloadInfo | null
  isSearching: boolean
  isTimedOut: boolean
  isPending: boolean
  isDeleting: boolean
  onDownload: (episodeId: number) => void
  onDelete: (episodeFileId: number, episodeTitle: string | null) => void
}

function isNotYetAired(airDate: string | null): boolean {
  if (!airDate) return true
  return new Date(airDate) > new Date()
}

export function EpisodeItem({
  episode,
  tvdbId,
  isInLibrary,
  liveDownload,
  isSearching,
  isTimedOut,
  isPending,
  isDeleting,
  onDownload,
  onDelete,
}: EpisodeItemProps) {
  const [releasesOpen, setReleasesOpen] = useState(false)

  const airDate = formatAirDate(episode.airDate)
  const qualityTier = getQualityTier(episode.quality)

  const downloadPercent =
    liveDownload && liveDownload.size > 0
      ? Math.round(
          ((liveDownload.size - liveDownload.sizeleft) / liveDownload.size) *
            100,
        )
      : 0

  const IMPORT_STATES = ['importPending', 'importing', 'importBlocked']
  const isImportState =
    liveDownload?.trackedDownloadState != null &&
    IMPORT_STATES.includes(liveDownload.trackedDownloadState)

  const isActivelyDownloading =
    liveDownload != null || (isSearching && !episode.hasFile)

  const notAired = !episode.hasFile && isNotYetAired(episode.airDate)

  // Transient: server timed out the search without a download appearing
  const transientNotFound =
    isTimedOut && !episode.hasFile && liveDownload == null && !notAired

  // Persisted: DB row exists from a previous search
  const persistedNotFound =
    !episode.hasFile &&
    episode.lastSearchedAt != null &&
    !isActivelyDownloading &&
    !notAired

  const notFound = transientNotFound || persistedNotFound

  // Relative timestamp for persistent record (transient has no timestamp yet)
  const notFoundSearchedAt = episode.lastSearchedAt
    ? dayjs(episode.lastSearchedAt)
    : null
  const notFoundRelativeLabel = notFoundSearchedAt?.fromNow() ?? null
  const notFoundAbsoluteLabel = notFoundSearchedAt
    ? notFoundSearchedAt.format('MMM D, YYYY [at] h:mm A')
    : null

  return (
    <>
      <div className="group">
        <div
          className={cns(
            'flex items-center gap-3 px-4 py-3 transition-colors',
            'hover:bg-carbon-700/40',
          )}
        >
          {/* Episode number */}
          <span className="w-8 shrink-0 font-mono text-xs tabular-nums text-carbon-500">
            {String(episode.episodeNumber).padStart(2, '0')}
          </span>

          {/* Title + meta */}
          <div className="min-w-0 flex-1 space-y-1">
            <p
              className={cns(
                'truncate text-sm',
                episode.hasFile && !isDeleting
                  ? 'text-carbon-100'
                  : 'text-carbon-300',
              )}
            >
              {episode.title ?? `Episode ${episode.episodeNumber}`}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {episode.quality && episode.hasFile && !isDeleting && (
                <QualityBadge quality={episode.quality} tier={qualityTier} />
              )}
              {episode.fileSize && episode.hasFile && !isDeleting && (
                <span className="font-mono text-xs tabular-nums text-carbon-500">
                  {formatBytes(episode.fileSize)}
                </span>
              )}
              {airDate && (
                <span className="font-mono text-xs text-carbon-600">
                  {airDate}
                </span>
              )}
              {isDeleting && (
                <Chip
                  label="deleting..."
                  size="small"
                  variant="outlined"
                  color="warning"
                  sx={{ height: 18, fontSize: '0.6rem' }}
                />
              )}
              {isSearching && !episode.hasFile && !liveDownload && (
                <Chip
                  label="searching..."
                  size="small"
                  variant="outlined"
                  color="info"
                  sx={{ height: 18, fontSize: '0.6rem' }}
                />
              )}
              {liveDownload && !isImportState && (
                <Chip
                  label={`${downloadPercent}% · ${liveDownload.status}`}
                  size="small"
                  variant="outlined"
                  color="info"
                  sx={{ height: 18, fontSize: '0.6rem' }}
                />
              )}
              {liveDownload && isImportState && (
                <Chip
                  label="importing"
                  size="small"
                  variant="outlined"
                  color="success"
                  sx={{ height: 18, fontSize: '0.6rem' }}
                />
              )}
              {notAired && (
                <Chip
                  label="not aired"
                  size="small"
                  variant="outlined"
                  color="warning"
                  sx={{ height: 18, fontSize: '0.6rem' }}
                />
              )}
              {notFound && (
                <Tooltip
                  title={
                    notFoundAbsoluteLabel
                      ? `Last searched ${notFoundAbsoluteLabel}`
                      : 'No releases found for this episode'
                  }
                  placement="top"
                  arrow
                >
                  <Chip
                    label={
                      notFoundRelativeLabel
                        ? `not found · ${notFoundRelativeLabel}`
                        : 'not found'
                    }
                    size="small"
                    variant="outlined"
                    sx={{
                      height: 18,
                      fontSize: '0.6rem',
                      borderColor: 'var(--color-warning)',
                      color: 'var(--color-warning)',
                      bgcolor: 'rgba(255, 170, 34, 0.08)',
                    }}
                  />
                </Tooltip>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 items-center gap-0.5">
            {/* Releases button — only shown when episode has no file */}
            {isInLibrary && (!episode.hasFile || isDeleting) && (
              <Tooltip title="Browse releases" placement="top" arrow>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => setReleasesOpen(true)}
                    disabled={isPending}
                    sx={{
                      color: 'var(--color-carbon-500)',
                      '&:hover': {
                        color: 'var(--color-phosphor-400)',
                        bgcolor: 'rgba(57, 255, 20, 0.08)',
                      },
                      '&.Mui-disabled': { opacity: 0.2 },
                    }}
                  >
                    <FormatListBulletedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </span>
              </Tooltip>
            )}

            {/* Download action */}
            {!isActivelyDownloading && !episode.hasFile && (
              <Tooltip title="Download episode" placement="top" arrow>
                <span>
                  <IconButton
                    size="small"
                    disabled={isPending}
                    onClick={() => onDownload(episode.id)}
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
                </span>
              </Tooltip>
            )}

            {/* Delete button for downloaded episodes */}
            {episode.hasFile &&
              episode.episodeFileId &&
              !isActivelyDownloading &&
              !isDeleting && (
                <Tooltip title="Delete file" placement="top" arrow>
                  <span>
                    <IconButton
                      size="small"
                      disabled={isPending}
                      onClick={() =>
                        onDelete(episode.episodeFileId!, episode.title)
                      }
                      sx={{
                        color: 'var(--color-carbon-500)',
                        opacity: 0,
                        transition: 'opacity 150ms',
                        '.group:hover &, &:focus-visible': { opacity: 1 },
                        '&:hover': {
                          color: 'var(--color-error)',
                          bgcolor: 'rgba(239, 68, 68, 0.08)',
                          opacity: 1,
                        },
                        '&.Mui-disabled': { opacity: 0.2 },
                      }}
                    >
                      <DeleteIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}

            {/* Spinner while downloading/searching */}
            {isActivelyDownloading && (
              <span className="flex size-8 items-center justify-center">
                <CircularProgress
                  size={14}
                  sx={{ color: 'var(--color-info)' }}
                />
              </span>
            )}
          </div>
        </div>

        {/* Inline download progress bar */}
        {liveDownload && !isImportState && (
          <LinearProgress
            variant="determinate"
            value={downloadPercent}
            sx={{
              height: 2,
              bgcolor: 'var(--color-carbon-700)',
              '& .MuiLinearProgress-bar': {
                bgcolor: 'var(--color-info)',
              },
            }}
          />
        )}
        {((isSearching && !episode.hasFile && !liveDownload) ||
          isImportState) && (
          <LinearProgress
            variant="indeterminate"
            sx={{
              height: 2,
              bgcolor: 'var(--color-carbon-700)',
              '& .MuiLinearProgress-bar': {
                bgcolor: isImportState
                  ? 'var(--color-success)'
                  : 'var(--color-info)',
              },
            }}
          />
        )}
      </div>

      <EpisodeReleaseDialog
        open={releasesOpen}
        episodeId={episode.id}
        episodeTitle={episode.title}
        tvdbId={tvdbId}
        onClose={() => setReleasesOpen(false)}
      />
    </>
  )
}
