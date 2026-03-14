import { cns } from '@lilnas/utils/cns'
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(
  ({ className, icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cns(
        'flex flex-col items-center justify-center gap-4 py-16 text-center',
        className,
      )}
      {...props}
    >
      <div className="text-carbon-400 [&_svg]:size-12">{icon}</div>
      <div className="space-y-1">
        <h3 className="font-mono text-lg font-medium text-carbon-200">
          {title}
        </h3>
        {description && (
          <p className="max-w-sm text-sm text-carbon-400">{description}</p>
        )}
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  ),
)

EmptyState.displayName = 'EmptyState'

export { EmptyState }
