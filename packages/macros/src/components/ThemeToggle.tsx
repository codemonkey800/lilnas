import { cns } from '@lilnas/utils/cns'
import { Moon, Sun } from 'lucide-react'
import { motion } from 'motion/react'

import { useTheme } from 'src/hooks/useTheme'

export const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme()

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      onClick={toggleTheme}
      className={cns(
        'fixed right-4 top-4 z-50',
        'rounded-full bg-white/80 p-3',
        'shadow-lg backdrop-blur-sm transition-all',
        'hover:scale-110 hover:shadow-xl',
        'dark:bg-gray-800/80',
      )}
      aria-label="Toggle theme"
    >
      <motion.div
        initial={false}
        animate={{ rotate: theme === 'dark' ? 360 : 0 }}
        transition={{ duration: 0.5 }}
      >
        {theme === 'light' ? (
          <Moon className={cns('h-5 w-5 text-gray-700 dark:text-gray-300')} />
        ) : (
          <Sun className={cns('h-5 w-5 text-gray-700 dark:text-gray-300')} />
        )}
      </motion.div>
    </motion.button>
  )
}
