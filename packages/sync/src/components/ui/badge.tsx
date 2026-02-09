import { cns } from '@lilnas/utils/cns'
import { forwardRef, HTMLAttributes } from 'react'

const variantStyles = {
  primary: 'bg-primary-900 text-primary-300',
  neutral: 'bg-bg-surface text-text-secondary',
  success: 'bg-success-muted text-success',
  error: 'bg-error-muted text-error',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variantStyles
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { variant = 'primary', className, children, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cns(
        'inline-flex items-center rounded-full',
        'px-2.5 py-0.5 text-xs font-medium',
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
})
