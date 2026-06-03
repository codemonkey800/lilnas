'use client'

import { cns } from '@lilnas/utils/cns'

import { type DayCode, dayCodes } from 'src/db/schema'
import { DAY_LABELS } from 'src/lib/format'

export type DayPickerProps = {
  selected: Set<DayCode>
  onToggle: (code: DayCode) => void
}

// Mon-first day toggle pills matching the home day-token look (R6).
export function DayPicker({ selected, onToggle }: DayPickerProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {dayCodes.map(code => {
        const isSelected = selected.has(code)
        return (
          <button
            key={code}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onToggle(code)}
            className={cns(
              'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
              isSelected
                ? 'bg-orange-500 text-white'
                : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700',
            )}
          >
            {DAY_LABELS[code]}
          </button>
        )
      })}
    </div>
  )
}
