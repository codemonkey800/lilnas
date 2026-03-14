'use client'

import { cns } from '@lilnas/utils/cns'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { type ReactNode } from 'react'

interface MediaHeroProps {
  title: string
  posterUrl: string | null
  fanartUrl: string | null
  posterFallback: ReactNode
  children: ReactNode
}

export function MediaHero({
  title,
  posterUrl,
  fanartUrl,
  posterFallback,
  children,
}: MediaHeroProps) {
  const router = useRouter()

  return (
    <div
      className={cns(
        'relative overflow-hidden',
        '-mt-4 md:-mt-6',
        'w-screen md:w-[calc(100vw-14rem)]',
        'ml-[calc((100%_-_100vw)_/_2)]',
        'md:ml-[calc((100%_-_(100vw_-_14rem))_/_2)]',
        !fanartUrl && 'bg-carbon-800',
      )}
    >
      {fanartUrl && (
        <Image
          src={fanartUrl}
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-center opacity-60"
          priority
          aria-hidden
        />
      )}
      {/* Bottom fade: blends hero into page background */}
      <div className="absolute inset-0 bg-gradient-to-t from-carbon-900 via-carbon-900/40 to-transparent" />
      {/* Left vignette: keeps poster + text legible */}
      <div className="absolute inset-0 bg-gradient-to-r from-carbon-900/70 to-transparent" />

      <div className="relative z-10 px-4 pb-10 pt-4 md:px-6">
        <button
          type="button"
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push('/library')
          }
          className={cns(
            'mb-6 flex items-center gap-1 font-mono text-sm text-carbon-100',
            'transition-colors hover:text-white',
          )}
        >
          <ArrowBackIcon sx={{ fontSize: 16 }} />
          Back
        </button>

        <div className="flex flex-col gap-6 sm:flex-row">
          <div
            className={cns(
              'w-full shrink-0 self-start overflow-hidden rounded-lg sm:w-48',
              'border border-carbon-500 bg-carbon-700',
              'shadow-2xl shadow-black/60',
            )}
          >
            <div className="relative aspect-[2/3]">
              {posterUrl ? (
                <Image
                  src={posterUrl}
                  alt={title}
                  fill
                  sizes="(max-width: 639px) 100vw, 192px"
                  className="object-cover"
                  priority
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  {posterFallback}
                </div>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-3">{children}</div>
        </div>
      </div>
    </div>
  )
}
