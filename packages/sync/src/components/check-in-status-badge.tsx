import { cns } from '@lilnas/utils/cns'
import { forwardRef, HTMLAttributes } from 'react'

const statusStyles = {
  draft: 'bg-bg-surface text-text-secondary',
  scheduled: 'bg-warning-muted text-warning',
  in_progress: 'bg-primary-900 text-primary-300',
  completed: 'bg-success-muted text-success',
}

const statusLabels = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
}

export type CheckInStatus = keyof typeof statusStyles

export interface CheckInStatusBadgeProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: CheckInStatus
}

export const CheckInStatusBadge = forwardRef<
  HTMLSpanElement,
  CheckInStatusBadgeProps
>(function CheckInStatusBadge({ status, className, ...props }, ref) {
  return (
    <span
      ref={ref}
      className={cns(
        'inline-flex items-center rounded-full',
        'px-2.5 py-0.5 text-xs font-medium',
        statusStyles[status],
        className,
      )}
      {...props}
    >
      {statusLabels[status]}
    </span>
  )
})
