import { cns } from '@lilnas/utils/cns'
import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type HTMLAttributes } from 'react'

const badgeVariants = cva(
  cns(
    'inline-flex items-center rounded-full px-2.5 py-0.5',
    'font-mono text-xs font-medium',
    'border transition-colors',
  ),
  {
    variants: {
      variant: {
        default: 'border-terminal/30 bg-terminal/10 text-terminal',
        secondary: 'border-carbon-500 bg-carbon-700 text-carbon-200',
        success: 'border-terminal/30 bg-success-muted text-terminal',
        error: 'border-error/30 bg-error-muted text-error',
        warning: 'border-warning/30 bg-warning-muted text-warning',
        info: 'border-info/30 bg-info-muted text-info',
        outline: 'border-carbon-400 bg-transparent text-carbon-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cns(badgeVariants({ variant, className }))}
      {...props}
    />
  ),
)

Badge.displayName = 'Badge'

export { Badge, badgeVariants }
