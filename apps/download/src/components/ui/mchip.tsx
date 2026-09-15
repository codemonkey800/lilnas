import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

import { Icon, type IconName } from 'src/components/ui/icon'

export type MChipProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  /**
   * The leading icon. Optional, and explicitly nullable: the mockups drop the
   * icon on narrow viewports (`search.pug` passes `mobile ? null : icon`) and
   * keep the label.
   */
  icon?: IconName | null
  /** The metadata itself, e.g. `Movie`, `1h 52m`, `Movie · 2019`. */
  label: ReactNode
}

/**
 * Icon + text run, for the type/duration/year metadata under a card or inside
 * a table cell.
 *
 * `MChip` carries no type or colour of its own — every call site in the
 * mockups supplies `font-mono text-mono-sm text-ink-3`, and that string works
 * verbatim: `packages/utils/src/cns.ts` registers this theme's `--text-*`
 * names as font sizes, so the size and the colour no longer share a
 * tailwind-merge conflict group.
 */
export function MChip({
  icon,
  label,
  className,
  ...props
}: MChipProps): JSX.Element {
  return (
    <span
      {...props}
      className={cns('inline-flex items-center gap-[5px]', className)}
    >
      {icon ? (
        <Icon name={icon} className="h-[11px] w-[11px] shrink-0" />
      ) : null}
      {label}
    </span>
  )
}
