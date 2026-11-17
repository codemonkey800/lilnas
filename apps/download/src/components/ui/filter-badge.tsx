import { Badge, type BadgeProps, Icon } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX, ReactNode } from 'react'

export type FilterBadgeProps = Omit<BadgeProps, 'children' | 'tone'> & {
  /** What the filter is currently set to — `Movie`, `failed`. */
  label: ReactNode
  onRemove?: () => void
  /**
   * The remove button's whole accessible name, and required for that reason: a
   * screen-reader user meets a row of these and "Remove" alone says nothing
   * about which one they are on.
   */
  removeLabel: string
}

/**
 * One applied filter: an accent `Badge` — accent because you chose it — with
 * its own remove button.
 */
export function FilterBadge({
  className,
  label,
  onRemove,
  removeLabel,
  ...props
}: FilterBadgeProps): JSX.Element {
  return (
    <Badge {...props} className={cns('h-7 pr-1', className)} tone="accent">
      {label}
      <button
        aria-label={removeLabel}
        className="grid size-5 place-items-center rounded-xs transition-colors duration-200 ease-standard hover:bg-accent-ghost"
        onClick={onRemove}
        type="button"
      >
        <Icon className="size-3" name="x" />
      </button>
    </Badge>
  )
}
