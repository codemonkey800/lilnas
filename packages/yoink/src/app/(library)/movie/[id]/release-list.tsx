'use client'

import SearchIcon from '@mui/icons-material/Search'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CircularProgress from '@mui/material/CircularProgress'
import { useMemo } from 'react'

import type { MovieRelease } from 'src/lib/media'

import { getQualityTier, qualityTierOrder } from './release-pills'
import { type ReleaseGroup, ReleaseSection } from './release-sections'
import { useGrabRelease, useMovieReleases } from './use-movie-releases'

interface ReleaseListProps {
  movieId: number
  tmdbId: number
}

const PAGE_SIZE = 10

export function ReleaseList({ movieId, tmdbId }: ReleaseListProps) {
  const { releases, isLoading, refresh } = useMovieReleases(movieId)
  const grabMutation = useGrabRelease(movieId, tmdbId)

  const groups = useMemo(() => {
    if (!releases) return []

    const sorted = [...releases].sort((a, b) => a.age - b.age)

    const groupMap = new Map<string, MovieRelease[]>()
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
        <h2 className="font-mono text-lg text-carbon-100">
          Available Releases
        </h2>
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
