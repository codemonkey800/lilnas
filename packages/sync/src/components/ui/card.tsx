import { cns } from '@lilnas/utils/cns'
import { forwardRef, HTMLAttributes } from 'react'

export type CardProps = HTMLAttributes<HTMLDivElement>

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cns(
        'flex w-full max-w-lg flex-col gap-6',
        'rounded-md border border-border bg-bg-surface p-6 shadow-md md:p-8',
        'animate-fade-in',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
})

export type CardInnerProps = HTMLAttributes<HTMLDivElement>

export const CardInner = forwardRef<HTMLDivElement, CardInnerProps>(
  function CardInner({ className, children, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cns(
          'flex flex-col items-center gap-3 rounded-md border border-border-subtle',
          'bg-bg-raised p-5',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    )
  },
)
