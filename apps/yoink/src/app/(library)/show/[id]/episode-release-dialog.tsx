'use client'

import { cns } from '@lilnas/utils/cns'
import CloseIcon from '@mui/icons-material/Close'
import SearchIcon from '@mui/icons-material/Search'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import { useMemo } from 'react'

import {
  getQualityTier,
  qualityTierOrder,
} from 'src/components/releases/release-pills'
import {
  type ReleaseGroup,
  ReleaseSection,
} from 'src/components/releases/release-sections'
import type { ShowRelease } from 'src/media'

import {
  useEpisodeReleases,
  useGrabEpisodeRelease,
} from './use-episode-releases'

const PAGE_SIZE = 8

interface EpisodeReleaseDialogProps {
  open: boolean
  episodeId: number
  episodeTitle: string | null
  tvdbId: number
  onClose: () => void
}

function ReleaseList({
  episodeId,
  tvdbId,
  open,
}: {
  episodeId: number
  tvdbId: number
  open: boolean
}) {
  const { releases, isLoading, refresh } = useEpisodeReleases(episodeId, open)
  const grabMutation = useGrabEpisodeRelease(episodeId, tvdbId)

  const groups = useMemo(() => {
    if (!releases) return []

    const sorted = [...releases].sort((a, b) => a.age - b.age)

    const groupMap = new Map<string, ShowRelease[]>()
    for (const r of sorted) {
      const key = r.quality ?? 'Unknown'
      const existing = groupMap.get(key)
      if (existing) {
        existing.push(r)
      } else {
        groupMap.set(key, [r])
      }
    }

    const builtGroups: ReleaseGroup[] = Array.from(groupMap.entries()).map(
      ([quality, groupReleases]) => ({
        quality,
        tier: getQualityTier(quality),
        releases: groupReleases,
      }),
    )

    builtGroups.sort((a, b) => {
      const tierDiff = qualityTierOrder(a.tier) - qualityTierOrder(b.tier)
      if (tierDiff !== 0) return tierDiff
      return a.quality.localeCompare(b.quality)
    })

    return builtGroups
  }, [releases])

  const grabbingGuid = grabMutation.isPending
    ? (grabMutation.variables?.guid ?? null)
    : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm text-carbon-400">
          Available Releases
        </span>
        <Button
          variant="outlined"
          size="small"
          startIcon={
            isLoading ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <SearchIcon sx={{ fontSize: 16 }} />
            )
          }
          disabled={isLoading}
          onClick={refresh}
        >
          Refresh
        </Button>
      </div>

      {isLoading && (
        <Card className="flex items-center justify-center py-8">
          <div className="flex flex-col items-center gap-2">
            <CircularProgress size={24} />
            <span className="font-mono text-xs text-carbon-400">
              Searching indexers...
            </span>
          </div>
        </Card>
      )}

      {releases !== null && !isLoading && releases.length === 0 && (
        <Card className="py-6 text-center">
          <span className="font-mono text-sm text-carbon-400">
            No releases found.
          </span>
        </Card>
      )}

      {releases !== null && !isLoading && releases.length > 0 && (
        <Card sx={{ overflow: 'hidden' }}>
          {groups.map(group => (
            <ReleaseSection
              key={group.quality}
              group={group}
              defaultExpanded={false}
              onGrab={(guid, indexerId) =>
                grabMutation.mutate({ guid, indexerId })
              }
              grabbingGuid={grabbingGuid}
              grabDisabled={grabMutation.isPending}
              pageSize={PAGE_SIZE}
            />
          ))}
        </Card>
      )}
    </div>
  )
}

export function EpisodeReleaseDialog({
  open,
  episodeId,
  episodeTitle,
  tvdbId,
  onClose,
}: EpisodeReleaseDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'var(--color-carbon-900)',
          backgroundImage: 'none',
          borderColor: 'var(--color-carbon-600)',
          border: 1,
          maxHeight: '85vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.9rem',
          borderBottom: '1px solid var(--color-carbon-700)',
          pb: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pr: 1,
        }}
      >
        <span className={cns('truncate text-carbon-100')}>
          {episodeTitle ?? 'Episode Releases'}
        </span>
        <IconButton
          size="small"
          onClick={onClose}
          sx={{ color: 'var(--color-carbon-400)', flexShrink: 0 }}
        >
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 2, pb: 2 }}>
        <ReleaseList episodeId={episodeId} tvdbId={tvdbId} open={open} />
      </DialogContent>
    </Dialog>
  )
}
