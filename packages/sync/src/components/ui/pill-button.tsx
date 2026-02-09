import { cns } from '@lilnas/utils/cns'
import { ButtonHTMLAttributes, forwardRef } from 'react'

export interface PillButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean
}

export const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  function PillButton({ selected, className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={cns(
          'rounded-full border px-3 py-1.5 text-sm font-medium',
          'transition-all duration-150 ease-smooth',
          'focus-visible:shadow-focus',

          selected
            ? 'border-primary bg-primary-900 text-primary-300'
            : 'border-border bg-bg-raised text-text-secondary hover:border-primary-700 hover:text-text',

          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)
