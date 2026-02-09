import { cns } from '@lilnas/utils/cns'
import { forwardRef, InputHTMLAttributes } from 'react'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cns(
        'w-full rounded-sm border border-border bg-bg-raised px-3 py-2',
        'text-sm text-text placeholder:text-text-muted',
        'transition-colors duration-150 ease-smooth',
        'focus:border-primary focus:outline-none focus-visible:shadow-focus',
        className,
      )}
      {...props}
    />
  )
})
