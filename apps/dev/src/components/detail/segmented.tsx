import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef } from 'react'

export type SegmentedProps<T extends string | number> = Omit<
  ComponentPropsWithoutRef<'div'>,
  'onChange' | 'role'
> & {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  label: string
}

/** A short row of exclusive choices — the tail selector. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  className,
  ...props
}: SegmentedProps<T>) {
  return (
    <div
      {...props}
      aria-label={label}
      className={cns(
        'inline-flex rounded-md border border-line bg-bg-sunk p-0.5',
        className,
      )}
      role="radiogroup"
    >
      {options.map(option => {
        const active = option === value
        return (
          <button
            aria-checked={active}
            className={cns(
              'h-[28px] rounded-xs px-3 font-mono text-mono-sm tabular-nums transition-colors duration-200 ease-uv',
              active
                ? 'bg-uv-ghost font-medium text-uv-hi'
                : 'text-ink-3 hover:text-ink',
            )}
            key={option}
            onClick={() => onChange(option)}
            role="radio"
            type="button"
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
