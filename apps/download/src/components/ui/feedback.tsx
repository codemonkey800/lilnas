import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

export type SpinnerProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'>

/**
 * Indeterminate spinner — "we asked and haven't heard back". Decorative by
 * default; a caller that wants it announced overrides `aria-hidden` and adds a
 * `role`/`aria-label`.
 */
export function Spinner({ className, ...props }: SpinnerProps): JSX.Element {
  return (
    <div
      aria-hidden="true"
      {...props}
      className={cns(
        'h-[15px] w-[15px] shrink-0 animate-spin rounded-full',
        'border-2 border-line border-t-uv',
        className,
      )}
    />
  )
}

export type SkeletonProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'>

/**
 * Loading placeholder. It carries no intrinsic size the way `Icon` doesn't —
 * give it one at the call site: `<Skeleton className="h-4 w-32" />`.
 */
export function Skeleton({ className, ...props }: SkeletonProps): JSX.Element {
  return (
    <div aria-hidden="true" {...props} className={cns('skeleton', className)} />
  )
}
