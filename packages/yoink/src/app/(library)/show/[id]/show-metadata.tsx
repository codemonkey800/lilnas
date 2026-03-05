import { cns } from '@lilnas/utils/cns'

import { formatBytes, formatRuntime, type ShowDetail } from 'src/media'

interface MetaCell {
  label: string
  value: string
}

function formatDate(dateStr: string | null): string | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatSeriesType(type: string | null): string | null {
  if (!type) return null
  return type.charAt(0).toUpperCase() + type.slice(1)
}

interface ShowMetadataProps {
  show: ShowDetail
}

export function ShowMetadata({ show }: ShowMetadataProps) {
  const cells: MetaCell[] = []

  if (show.runtime) {
    cells.push({ label: 'Runtime', value: formatRuntime(show.runtime) })
  }

  if (show.ratings.value !== null) {
    cells.push({
      label: 'Rating',
      value: `${show.ratings.value.toFixed(1)} / 10`,
    })
  }

  const firstAired = formatDate(show.firstAired)
  if (firstAired) {
    cells.push({ label: 'First Aired', value: firstAired })
  }

  const lastAired = formatDate(show.lastAired)
  if (lastAired && lastAired !== firstAired) {
    cells.push({ label: 'Last Aired', value: lastAired })
  }

  if (show.originalLanguage) {
    cells.push({ label: 'Language', value: show.originalLanguage })
  }

  const seriesType = formatSeriesType(show.seriesType)
  if (seriesType) {
    cells.push({ label: 'Type', value: seriesType })
  }

  if (show.totalEpisodeCount > 0) {
    cells.push({
      label: 'Total Episodes',
      value: String(show.totalEpisodeCount),
    })
  }

  if (show.isInLibrary && show.sizeOnDisk > 0) {
    cells.push({ label: 'On Disk', value: formatBytes(show.sizeOnDisk) })
  }

  if (cells.length === 0) return null

  return (
    <div
      className={cns(
        'rounded-lg border border-carbon-700 bg-carbon-800/50',
        'grid grid-cols-2 divide-x divide-y divide-carbon-700/60 sm:grid-cols-3 lg:grid-cols-4',
        'overflow-hidden',
      )}
    >
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={cns(
            'flex flex-col gap-1 px-4 py-3',
            'animate-fade-in opacity-0',
          )}
          style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'forwards' }}
        >
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-carbon-500">
            {cell.label}
          </span>
          <span className="font-mono text-sm tabular-nums text-carbon-100">
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  )
}
