import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'
import { Dot } from 'src/components/ui/status'

export type TileProps = Omit<ComponentPropsWithoutRef<'a'>, 'title'> & {
  icon: IconName
  /** Hangs a breathing `live` dot in front of {@link TileProps.meta}. */
  live?: boolean
  /** The count under the heading, e.g. `318 in the library`. */
  meta: ReactNode
  /**
   * Lays the tile out as a row — icon beside the text — rather than a column.
   * The mockups use the column in desktop's quick-access grid and the row for
   * the same tiles as full-width list items on mobile.
   */
  row?: boolean
  /**
   * The heading. Shadows the native `title` attribute, which is removed from
   * this type: a tile's entire content is already visible text, so a tooltip
   * repeating it would only be read twice.
   */
  title: ReactNode
}

/**
 * Quick-access tile — icon, heading, count — as one link.
 *
 * The icon plate reacts to `group-hover` on the anchor rather than to a hover
 * of its own, so the whole tile is the target.
 *
 * Ported from `docs/features/download/designs/src/mixins/ui.pug`'s `tile`
 * mixin. Every remaining prop is spread onto the root element, mirroring the
 * mixin's `&attributes(attributes)` convention.
 */
export function Tile({
  children,
  className,
  icon,
  live = false,
  meta,
  row = false,
  title,
  ...props
}: TileProps): JSX.Element {
  return (
    <a
      {...props}
      className={cns(
        'group flex gap-2.5 rounded-md border border-line bg-surface p-[15px]',
        'transition-[border-color,background-color,transform] duration-200 ease-uv',
        'hover:-translate-y-[2px] hover:border-uv hover:bg-surface-uv',
        row ? 'flex-row items-center' : 'flex-col',
        className,
      )}
    >
      <span
        className={cns(
          'grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-surface-3 text-ink-2',
          'transition-[background-color,color] duration-200 ease-uv',
          'group-hover:bg-uv-ghost group-hover:text-uv-hi',
        )}
      >
        <Icon name={icon} className="h-[15px] w-[15px]" />
      </span>
      <span className={row ? 'flex-1' : undefined}>
        <span className="block text-h3">{title}</span>
        <span className="flex items-center gap-1.5 font-mono text-mono-sm text-ink-3">
          {live ? <Dot tone="live" /> : null}
          <span>{meta}</span>
        </span>
      </span>
      {children}
    </a>
  )
}
