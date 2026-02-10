import { cns } from '@lilnas/utils/cns'
import { HiCheck } from 'react-icons/hi2'

import { GOAL_OPTIONS } from './constants'

export interface GoalsFieldsProps {
  goals: string[]
  toggleGoal: (v: string) => void
}

export function GoalsFields({ goals, toggleGoal }: GoalsFieldsProps) {
  return (
    <div className="flex flex-col gap-2">
      {GOAL_OPTIONS.map(goal => (
        <button
          key={goal}
          type="button"
          onClick={() => toggleGoal(goal)}
          className={cns(
            'flex items-center gap-3 rounded-md border p-3 text-left',
            'transition-all duration-150 ease-smooth',
            'focus-visible:shadow-focus',
            goals.includes(goal)
              ? 'border-primary bg-primary-900/40 shadow-glow'
              : 'border-border bg-bg-raised hover:border-primary-700',
          )}
        >
          {/* Checkbox indicator */}
          <span
            className={cns(
              'flex h-5 w-5 shrink-0 items-center justify-center rounded',
              'border transition-all duration-150 ease-smooth',
              goals.includes(goal)
                ? 'border-primary bg-primary text-text-inverse'
                : 'border-border bg-bg-surface',
            )}
          >
            {goals.includes(goal) && <HiCheck className="h-3 w-3" />}
          </span>
          <span
            className={cns(
              'text-sm font-medium',
              goals.includes(goal) ? 'text-text' : 'text-text-secondary',
            )}
          >
            {goal}
          </span>
        </button>
      ))}
    </div>
  )
}
