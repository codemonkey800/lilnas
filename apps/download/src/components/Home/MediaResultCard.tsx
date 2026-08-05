'use client'

import { cns } from '@lilnas/utils/cns'
import { CircularProgress } from '@mui/material'

import type { MediaSearchResultItem } from './MediaRequestForm'

export function MediaResultCard({
  disabled,
  onSelect,
  pending,
  result,
}: {
  disabled: boolean
  onSelect: (result: MediaSearchResultItem) => void
  pending: boolean
  result: MediaSearchResultItem
}) {
  return (
    <button
      className={cns(
        'flex w-[140px] flex-col items-center gap-1 rounded p-1 text-left',
        disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-white/10',
      )}
      disabled={disabled}
      onClick={() => onSelect(result)}
      title={result.overview}
      type="button"
    >
      <div className="relative flex h-[210px] w-[140px] items-center justify-center overflow-hidden rounded bg-gray-800 text-center text-sm">
        {result.posterUrl ? (
          // Radarr/Sonarr posters are served from arbitrary external
          // domains, so next/image (which requires each domain to be
          // allow-listed in next.config.js) isn't a good fit here.
          <img
            alt={result.title}
            className="h-full w-full object-cover"
            src={result.posterUrl}
          />
        ) : (
          <span className="p-2">{result.title}</span>
        )}

        {pending && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <CircularProgress size={28} />
          </div>
        )}
      </div>

      <p className="line-clamp-2 text-sm font-semibold">{result.title}</p>
      {result.year && <p className="text-xs text-gray-400">{result.year}</p>}
    </button>
  )
}
