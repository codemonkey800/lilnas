import { cns } from '@lilnas/utils/cns'
import { animate } from 'motion'
import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'

interface MacroStatProps {
  label: string
  value: number
  unit?: string
  color: string
  icon: string
}

export const MacroStat = ({
  label,
  value,
  unit = 'g',
  color,
  icon,
}: MacroStatProps) => {
  const nodeRef = useRef<HTMLSpanElement>(null)
  const previousValue = useRef(value)

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return

    const from = previousValue.current
    const to = value

    const animation = animate(from, to, {
      duration: 0.6,
      onUpdate: (latest: number) => {
        if (node) {
          node.textContent = latest.toFixed(1)
        }
      },
    })

    previousValue.current = value

    return () => animation.stop()
  }, [value])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
      className={cns(
        'flex flex-col items-center gap-2',
        'rounded-xl bg-gradient-to-br p-6',
        'shadow-lg transition-shadow hover:shadow-xl',
        color,
      )}
    >
      <div className="text-4xl">{icon}</div>
      <div className="w-full text-center">
        <div className="flex items-baseline justify-center gap-1 overflow-hidden text-2xl font-bold text-white md:text-3xl">
          <span ref={nodeRef}>{value.toFixed(1)}</span>
          <span className="flex-shrink-0 text-lg font-normal md:text-2xl">
            {unit}
          </span>
        </div>
        <div className="mt-1 text-sm font-medium uppercase tracking-wide text-white/90">
          {label}
        </div>
      </div>
    </motion.div>
  )
}
