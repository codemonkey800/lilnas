'use client'

import { cns } from '@lilnas/utils/cns'
import { Moon, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

import { Button } from 'src/components/Button'

const ICON_CLASS_NAME = 'h-[1.2rem] w-[1.2rem]'

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [isClient, setIsClient] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsClient(true)
  }, [])

  const isDark = resolvedTheme === 'dark'
  const isLight = resolvedTheme === 'light'

  // Animation variants
  const iconVariants = {
    initial: { y: '100%', opacity: 0 },
    animate: { y: 0, opacity: 1 },
    exit: { y: '-100%', opacity: 0 },
  }

  const transition = { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const }

  const handleToggle = () => {
    if (theme === 'system') {
      // First toggle from system: switch to opposite of current resolved theme
      setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
    } else {
      // Already on explicit theme: toggle between light and dark
      setTheme(theme === 'dark' ? 'light' : 'dark')
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      className={cns(
        '!bg-transparent',
        'hover:!bg-transparent',
        'cursor-pointer',
        'hover:!text-black',
        'dark:hover:!text-white',
        'transition-colors',
      )}
    >
      <div className="relative h-[1.2rem] w-[1.2rem] overflow-hidden">
        <AnimatePresence initial={false}>
          {isClient && isDark && (
            <motion.div
              key="sun"
              className="absolute inset-0"
              variants={iconVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition}
            >
              <Sun className={ICON_CLASS_NAME} />
            </motion.div>
          )}

          {isClient && isLight && (
            <motion.div
              key="moon"
              className="absolute inset-0"
              variants={iconVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition}
            >
              <Moon className={ICON_CLASS_NAME} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
