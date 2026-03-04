'use client'

import { cns } from '@lilnas/utils/cns'
import DownloadIcon from '@mui/icons-material/Download'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import { useMemo } from 'react'

import { formatBytes, type MovieRelease } from 'src/lib/media'
import { parseReleaseName } from 'src/lib/parse-release'

import { AttributePills } from './release-pills'

function formatAge(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return '1 day'
  return `${days}d`
}

// ── Individual release card ───────────────────────────────────────────────────

interface ReleaseCardProps {
  release: MovieRelease
  index: number
  onGrab: (guid: string, indexerId: number) => void
  isGrabbing: boolean
  disabled: boolean
}

export function ReleaseCard({
  release,
  index,
  onGrab,
  isGrabbing,
  disabled,
}: ReleaseCardProps) {
  const parsed = useMemo(() => parseReleaseName(release.title), [release.title])

  const metaParts: string[] = []
  metaParts.push(formatBytes(release.size))
  metaParts.push(formatAge(release.age))
  if (release.indexer) metaParts.push(release.indexer)
  if (
    release.language &&
    release.language.toLowerCase() !== 'english' &&
    release.language.toLowerCase() !== 'en'
  ) {
    metaParts.push(release.language)
  }
  if (parsed.group) metaParts.push(parsed.group)

  const seedersLabel =
    release.protocol === 'torrent' && release.seeders !== null
      ? `${release.seeders}S`
      : null

  return (
    <div
      className={cns(
        'group flex items-start gap-3 px-4 py-3.5 transition-colors',
        index % 2 === 1 ? 'bg-carbon-800/40' : '',
        'hover:bg-carbon-700/50',
        'animate-fade-in',
      )}
      style={{ animationDelay: `${Math.min(index, 9) * 25}ms` }}
    >
      <div className="min-w-0 flex-1 space-y-2">
        <AttributePills parsed={parsed} />

        {parsed.hdr.length === 0 &&
          parsed.audio.length === 0 &&
          parsed.codec === null &&
          parsed.source.length === 0 && (
            <p
              className="truncate font-mono text-xs text-carbon-300"
              title={release.title ?? undefined}
            >
              {release.title ?? 'Unknown release'}
            </p>
          )}

        {release.title && (
          <p className="hidden truncate font-mono text-[0.65rem] leading-tight text-carbon-500 md:block">
            {release.title}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {metaParts.map((part, i) => (
            <span key={part} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-carbon-600">·</span>}
              <span
                className={cns(
                  'font-mono text-xs tabular-nums',
                  i === 0 ? 'font-medium text-carbon-200' : 'text-carbon-500',
                )}
              >
                {part}
              </span>
            </span>
          ))}
          {seedersLabel && (
            <>
              <span className="text-carbon-600">·</span>
              <span className="font-mono text-xs tabular-nums text-phosphor-500">
                {seedersLabel}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 self-center">
        <IconButton
          size="small"
          disabled={disabled}
          onClick={() => onGrab(release.guid, release.indexerId)}
          sx={{
            color: 'var(--color-phosphor-500)',
            bgcolor: 'rgba(57, 255, 20, 0.05)',
            '&:hover': {
              color: 'var(--color-terminal)',
              bgcolor: 'rgba(57, 255, 20, 0.12)',
            },
            '&.Mui-disabled': { opacity: 0.25 },
          }}
        >
          {isGrabbing ? (
            <CircularProgress size={18} color="inherit" />
          ) : (
            <DownloadIcon sx={{ fontSize: 22 }} />
          )}
        </IconButton>
      </div>
    </div>
  )
}
