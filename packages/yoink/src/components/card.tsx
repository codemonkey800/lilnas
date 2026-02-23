import { cns } from '@lilnas/utils/cns'
import { cva, type VariantProps } from 'class-variance-authority'
import { forwardRef, type HTMLAttributes } from 'react'

const cardVariants = cva(
  cns(
    'rounded-lg border border-carbon-500',
    'bg-carbon-800 text-carbon-100',
    'transition-all duration-200',
  ),
  {
    variants: {
      variant: {
        default: '',
        glow: cns(
          'border-terminal/20',
          'shadow-[0_0_16px_rgba(57,255,20,0.08)]',
          'hover:shadow-[0_0_24px_rgba(57,255,20,0.15)]',
          'hover:border-terminal/40',
        ),
        inset: 'bg-carbon-900 border-carbon-600',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cns(cardVariants({ variant, className }))}
      {...props}
    />
  ),
)

Card.displayName = 'Card'

const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cns('flex flex-col gap-1.5 p-4', className)}
      {...props}
    />
  ),
)

CardHeader.displayName = 'CardHeader'

const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cns('p-4 pt-0', className)} {...props} />
  ),
)

CardContent.displayName = 'CardContent'

export { Card, CardContent, CardHeader, cardVariants }
