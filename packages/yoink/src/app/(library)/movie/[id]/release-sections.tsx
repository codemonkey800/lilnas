'use client'

import { cns } from '@lilnas/utils/cns'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import Collapse from '@mui/material/Collapse'
import { useMemo, useState } from 'react'

import { Pagination } from 'src/components/pagination'
import type { MovieRelease } from 'src/lib/media'

import { ReleaseCard } from './release-card'
import { QualityBadge, type QualityTier } from './release-pills'

export interface ReleaseGroup {
  quality: string
  tier: QualityTier
  releases: MovieRelease[]
}

// ── Group header ──────────────────────────────────────────────────────────────

interface GroupHeaderProps {
  quality: string
  tier: QualityTier
  count: number
  expanded: boolean
  onToggle: () => void
}

function GroupHeader({
  quality,
  tier,
  count,
  expanded,
  onToggle,
}: GroupHeaderProps) {
  const accentColor =
    tier === '4k'
      ? 'var(--color-phosphor-500)'
      : tier === '1080p'
        ? 'var(--color-info)'
        : 'var(--color-carbon-500)'

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cns(
        'flex w-full items-center gap-3 px-4 py-2.5',
        'border-l-2 transition-colors',
        'hover:bg-carbon-700/30',
        'focus-visible:outline-none',
      )}
      style={{ borderLeftColor: accentColor }}
    >
      <QualityBadge quality={quality} tier={tier} />

      <span className="font-mono text-xs text-carbon-500">
        {count} {count === 1 ? 'release' : 'releases'}
      </span>

      <span className="ml-auto">
        <ChevronRightIcon
          sx={{
            fontSize: 16,
            color: 'var(--color-carbon-500)',
            transition: 'transform 200ms',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        />
      </span>
    </button>
  )
}

// ── Collapsible group section ─────────────────────────────────────────────────

interface ReleaseSectionProps {
  group: ReleaseGroup
  defaultExpanded?: boolean
  onGrab: (guid: string, indexerId: number) => void
  grabbingGuid: string | null
  grabDisabled: boolean
  pageSize: number
}

export function ReleaseSection({
  group,
  defaultExpanded = false,
  onGrab,
  grabbingGuid,
  grabDisabled,
  pageSize,
}: ReleaseSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [page, setPage] = useState(0)

  const visibleReleases = useMemo(
    () => group.releases.slice(page * pageSize, (page + 1) * pageSize),
    [group.releases, page, pageSize],
  )

  return (
    <div className="border-b border-carbon-600/40 last:border-b-0">
      <GroupHeader
        quality={group.quality}
        tier={group.tier}
        count={group.releases.length}
        expanded={expanded}
        onToggle={() => setExpanded(p => !p)}
      />
      <Collapse in={expanded} timeout={180}>
        <div className="divide-y divide-carbon-600/30">
          {visibleReleases.map((release, index) => (
            <ReleaseCard
              key={release.guid}
              release={release}
              index={index}
              onGrab={onGrab}
              isGrabbing={grabbingGuid === release.guid}
              disabled={grabDisabled}
            />
          ))}
        </div>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={group.releases.length}
          onPrev={() => setPage(p => p - 1)}
          onNext={() => setPage(p => p + 1)}
        />
      </Collapse>
    </div>
  )
}
