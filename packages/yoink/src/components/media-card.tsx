'use client'

import { cns } from '@lilnas/utils/cns'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import Card from '@mui/material/Card'
import Chip from '@mui/material/Chip'
import Image from 'next/image'
import Link from 'next/link'
import { useState } from 'react'

import type { LibraryItem } from 'src/lib/media'

const statusDotColor: Record<LibraryItem['status'], string> = {
  downloaded: 'bg-terminal',
  missing: 'bg-carbon-400',
}

interface MediaCardProps {
  item: LibraryItem
  showMediaType?: boolean
}

export function MediaCard({ item, showMediaType }: MediaCardProps) {
  const [loaded, setLoaded] = useState(false)
  const PlaceholderIcon = item.mediaType === 'movie' ? MovieIcon : TvIcon

  return (
    <Link href={item.href} className="group block">
      <Card
        className={cns(
          'overflow-hidden transition-transform duration-200',
          'group-hover:-translate-y-0.5',
        )}
        sx={{
          '&:hover': {
            borderColor: 'rgba(57, 255, 20, 0.3)',
            boxShadow: '0 0 16px rgba(57, 255, 20, 0.08)',
          },
        }}
      >
        <div className="relative aspect-[2/3] overflow-hidden bg-carbon-700">
          {item.posterUrl ? (
            <>
              {!loaded && (
                <div className="absolute inset-0 animate-pulse bg-carbon-600" />
              )}
              <Image
                src={item.posterUrl}
                alt={item.title}
                fill
                sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, (max-width: 1280px) 20vw, 16vw"
                className={cns(
                  'object-cover transition-opacity duration-300',
                  loaded ? 'opacity-100' : 'opacity-0',
                )}
                onLoad={() => setLoaded(true)}
              />
            </>
          ) : (
            <div className="flex h-full items-center justify-center">
              <PlaceholderIcon
                className="text-carbon-500"
                sx={{ fontSize: 48 }}
              />
            </div>
          )}

          <div
            className={cns(
              'absolute right-2 top-2 size-2 rounded-full shadow-sm',
              statusDotColor[item.status],
            )}
          />

          {showMediaType && (
            <Chip
              icon={
                item.mediaType === 'movie' ? (
                  <MovieIcon sx={{ fontSize: 12 }} />
                ) : (
                  <TvIcon sx={{ fontSize: 12 }} />
                )
              }
              label={item.mediaType === 'movie' ? 'Movie' : 'Show'}
              size="small"
              sx={{
                position: 'absolute',
                left: 6,
                bottom: 6,
                height: 20,
                fontSize: '0.625rem',
                fontFamily: 'var(--font-mono)',
                bgcolor: 'rgba(0, 0, 0, 0.7)',
                backdropFilter: 'blur(4px)',
                color: 'var(--color-carbon-200)',
                '& .MuiChip-icon': { color: 'var(--color-carbon-300)' },
              }}
            />
          )}
        </div>

        <div className="space-y-0.5 p-2">
          <p className="line-clamp-1 font-mono text-sm text-carbon-100">
            {item.title}
          </p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs tabular-nums text-carbon-400">
              {item.year}
            </span>
            {item.quality && (
              <Chip
                label={item.quality}
                size="small"
                variant="outlined"
                color="secondary"
                sx={{ height: 18, fontSize: '0.625rem' }}
              />
            )}
          </div>
        </div>
      </Card>
    </Link>
  )
}
