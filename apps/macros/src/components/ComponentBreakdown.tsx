import { cns } from '@lilnas/utils/cns'
import { motion } from 'motion/react'

import type { ComponentMacros } from 'src/types/nutrition'

interface ComponentBreakdownProps {
  breakdown: ComponentMacros[]
}

const getComponentIcon = (type: ComponentMacros['type']): string => {
  switch (type) {
    case 'protein':
      return '🍗'
    case 'flavor':
      return '🧂'
    case 'carb':
      return '🍚'
    case 'veggie':
      return '🥦'
  }
}

const getComponentColor = (type: ComponentMacros['type']): string => {
  switch (type) {
    case 'protein':
      return 'from-blue-500 to-cyan-500'
    case 'flavor':
      return 'from-purple-500 to-pink-500'
    case 'carb':
      return 'from-orange-500 to-yellow-500'
    case 'veggie':
      return 'from-green-500 to-emerald-500'
  }
}

const MacroItem = ({
  label,
  value,
  unit = 'g',
}: {
  label: string
  value: number
  unit?: string
}) => (
  <div className={cns('flex items-center justify-between')}>
    <span
      className={cns(
        'text-xs font-medium text-gray-600 dark:text-gray-400 md:text-sm',
      )}
    >
      {label}:
    </span>
    <span
      className={cns(
        'text-xs font-bold text-gray-800 dark:text-gray-100 md:text-sm',
      )}
    >
      {value.toFixed(1)}
      {unit}
    </span>
  </div>
)

export const ComponentBreakdown = ({ breakdown }: ComponentBreakdownProps) => {
  if (breakdown.length === 0) {
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      className="mt-8"
    >
      <h2
        className={cns(
          'mb-6 text-center text-2xl font-bold',
          'text-gray-800 dark:text-gray-100',
        )}
      >
        Component Breakdown
      </h2>
      <div className={cns('grid grid-cols-1 gap-4 md:grid-cols-2')}>
        {breakdown.map((component, index) => (
          <motion.div
            key={`${component.type}-${index}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, delay: 0.5 + index * 0.1 }}
            className={cns(
              'rounded-xl bg-white p-6 shadow-lg',
              'dark:bg-gray-700',
            )}
          >
            <div className={cns('mb-4 flex items-center gap-3')}>
              <div
                className={cns(
                  'flex h-12 w-12 items-center justify-center',
                  'rounded-lg bg-gradient-to-br text-2xl shadow-md',
                  getComponentColor(component.type),
                )}
              >
                {getComponentIcon(component.type)}
              </div>
              <div className={cns('flex-1')}>
                <h3
                  className={cns(
                    'text-base font-bold text-gray-800 dark:text-gray-100 md:text-lg',
                  )}
                >
                  {component.name}
                </h3>
                <p
                  className={cns(
                    'text-xs capitalize text-gray-500 dark:text-gray-400 md:text-sm',
                  )}
                >
                  {component.type}
                </p>
                <p className={cns('text-xs text-gray-400 dark:text-gray-500')}>
                  {component.size}
                </p>
              </div>
            </div>
            <div className={cns('space-y-2')}>
              <MacroItem
                label="Calories"
                value={component.calories}
                unit="kcal"
              />
              <MacroItem label="Protein" value={component.protein} />
              <MacroItem label="Carbs" value={component.carbs} />
              <MacroItem label="Fat" value={component.fat} />
              <MacroItem label="Fiber" value={component.fiber} />
              <MacroItem label="Sugar" value={component.sugar} />
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}
