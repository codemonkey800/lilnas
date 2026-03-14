'use client'

import { cns } from '@lilnas/utils/cns'
import { useState } from 'react'

interface ShowScreenshotGalleryProps {
  screenshots: string[]
  title: string
}

export function ShowScreenshotGallery({
  screenshots,
  title,
}: ShowScreenshotGalleryProps) {
  if (screenshots.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="font-mono text-lg text-carbon-100">Stills</h2>
      <div
        className={cns(
          'flex gap-3 overflow-x-auto pb-2',
          '[scroll-snap-type:x_mandatory]',
          // Scrollbar styling to match carbon theme
          '[&::-webkit-scrollbar]:h-1.5',
          '[&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-carbon-900',
          '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-carbon-600',
          '[&::-webkit-scrollbar-thumb:hover]:bg-carbon-500',
        )}
      >
        {screenshots.map((src, i) => (
          <ScreenshotItem key={src} src={src} title={title} index={i} />
        ))}
      </div>
    </div>
  )
}

interface ScreenshotItemProps {
  src: string
  title: string
  index: number
}

function ScreenshotItem({ src, title, index }: ScreenshotItemProps) {
  const [errored, setErrored] = useState(false)

  if (errored) return null

  return (
    <div
      className={cns(
        'relative shrink-0 overflow-hidden rounded-lg',
        'border border-carbon-700',
        'w-[280px] sm:w-[320px]',
        '[scroll-snap-align:start]',
        'animate-fade-in opacity-0',
        'group',
      )}
      style={{
        animationDelay: `${index * 60}ms`,
        animationFillMode: 'forwards',
      }}
    >
      {/* 16:9 aspect ratio container */}
      <div className="relative aspect-video w-full overflow-hidden bg-carbon-800">
        <img
          src={src}
          alt={`${title} still ${index + 1}`}
          className={cns(
            'h-full w-full object-cover',
            'transition-transform duration-500 group-hover:scale-105',
          )}
          loading="lazy"
          onError={() => setErrored(true)}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-carbon-900/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </div>
  )
}
