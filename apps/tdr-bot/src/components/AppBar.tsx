'use client'

import { cns } from '@lilnas/utils/cns'
import { useEffect, useState } from 'react'

import { SadPepeIcon } from './SadPepeIcon'
import { ThemeToggle } from './ThemeToggle'

export function AppBar() {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      const scrolled = window.scrollY > 10
      if (scrolled !== isScrolled) {
        setIsScrolled(scrolled)
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('scroll', handleScroll, { passive: true })
      return () => window.removeEventListener('scroll', handleScroll)
    }

    return undefined
  }, [isScrolled])

  return (
    <header
      className={cns(
        'sticky top-0 z-50',
        'bg-background border-b border-border',
        'transition-[box-shadow,color,background-color,border-color] duration-300 ease-in-out',
        isScrolled ? 'shadow-md' : 'shadow-none',
      )}
    >
      <div
        className={cns(
          'flex items-center justify-between',
          'px-4 md:px-6 py-3 md:py-4',
          'max-w-7xl mx-auto',
        )}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-purple-800 overflow-hidden border-2 border-purple-500">
            <SadPepeIcon
              width={40}
              height={40}
              className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              aria-label="TDR Bot"
            />
          </div>

          <span className="text-lg font-semibold text-foreground">TDR Bot</span>
        </div>

        <ThemeToggle />
      </div>
    </header>
  )
}
