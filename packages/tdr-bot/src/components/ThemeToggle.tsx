'use client'

import { MoonIcon, SunIcon } from '@heroicons/react/24/outline'
import { cns } from '@lilnas/utils/cns'

import { useTheme } from './ThemeProvider'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      onClick={toggleTheme}
      className={cns(
        'rounded-lg p-2 transition-colors duration-200',
        'hover:bg-gray-200 dark:hover:bg-gray-700',
        'focus:outline-none focus:ring-2 focus:ring-eminence-500 focus:ring-offset-2',
        'text-gray-700 dark:text-gray-300',
      )}
      aria-label="Toggle theme"
      type="button"
    >
      {theme === 'light' ? (
        <MoonIcon className="h-5 w-5" />
      ) : (
        <SunIcon className="h-5 w-5" />
      )}
    </button>
  )
}
