import { cns } from '@lilnas/utils/cns'
import { forwardRef, HTMLAttributes } from 'react'

const statusStyles = {
  draft: 'bg-bg-surface text-text-secondary',
  in_progress: 'bg-primary-900 text-primary-300',
  completed: 'bg-success-muted text-success',
}

const statusLabels = {
  draft: 'Draft',
  in_progress: 'In Progress',
  completed: 'Completed',
}

export type CheckInStatus = keyof typeof statusStyles

export interface CheckInStatusBadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: CheckInStatus
  pendingTransition?: string | null
}

export const CheckInStatusBadge = forwardRef<
  HTMLSpanElement,
  CheckInStatusBadgeProps
>(function CheckInStatusBadge(
  { status, pendingTransition, className, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cns(
        'inline-flex items-center gap-1.5 rounded-full',
        'px-2.5 py-0.5 text-xs font-medium',
        statusStyles[status],
        className,
      )}
      {...props}
    >
      {statusLabels[status]}
      {pendingTransition && (
        <span className="rounded-full bg-warning-muted px-1.5 py-px text-[10px] font-medium text-warning">
          Pending
        </span>
      )}
    </span>
  )
})
