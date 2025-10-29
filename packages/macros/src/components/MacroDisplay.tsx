import { cns } from '@lilnas/utils/cns'
import { motion } from 'motion/react'

import type { MacrosWithBreakdown } from 'src/types/nutrition'

import { ComponentBreakdown } from './ComponentBreakdown'
import { MacroStat } from './MacroStat'

interface MacroDisplayProps {
  macrosWithBreakdown: MacrosWithBreakdown
}

export const MacroDisplay = ({ macrosWithBreakdown }: MacroDisplayProps) => {
  const { totals, breakdown } = macrosWithBreakdown

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
        className={cns('mt-8')}
      >
        <h2
          className={cns(
            'mb-6 text-center text-2xl font-bold',
            'text-gray-800 dark:text-gray-100',
          )}
        >
          Your Meal Macros
        </h2>
        <div
          className={cns(
            'grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-6',
          )}
        >
          <MacroStat
            label="Calories"
            value={totals.calories}
            unit="kcal"
            color="from-red-500 to-orange-500"
            icon="🔥"
          />
          <MacroStat
            label="Protein"
            value={totals.protein}
            unit="g"
            color="from-blue-500 to-cyan-500"
            icon="💪"
          />
          <MacroStat
            label="Carbs"
            value={totals.carbs}
            unit="g"
            color="from-orange-500 to-yellow-500"
            icon="🍚"
          />
          <MacroStat
            label="Fat"
            value={totals.fat}
            unit="g"
            color="from-green-500 to-emerald-500"
            icon="🥑"
          />
          <MacroStat
            label="Fiber"
            value={totals.fiber}
            unit="g"
            color="from-amber-500 to-orange-600"
            icon="🌾"
          />
          <MacroStat
            label="Sugar"
            value={totals.sugar}
            unit="g"
            color="from-pink-500 to-rose-500"
            icon="🍯"
          />
        </div>
      </motion.div>

      <ComponentBreakdown breakdown={breakdown} />
    </>
  )
}
