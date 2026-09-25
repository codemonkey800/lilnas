import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { Icon, type IconName } from 'src/components/ui/icon'

export type CardProps = ComponentPropsWithoutRef<'div'> & {
  /**
   * Inverts the card into a well rather than nudging its shade: a sunk card
   * sits on `bg-sunk`, *below* the page surface, where the default raised card
   * sits on `surface`, above it. Ported from `ui.pug`'s `+card({ sunk: true })`.
   */
  sunk?: boolean
}

/**
 * The default raised surface. `sunk` inverts it into a well.
 *
 * The padding is the mixin's `p-5`; call sites routinely replace it with their
 * own (`px-1.5 pt-1 pb-1.5` around a `DataTable`, `px-4 py-1` around a stack of
 * `StateLine`s), which `cns` resolves in the caller's favour.
 */
export function Card({
  sunk = false,
  className,
  ...props
}: CardProps): JSX.Element {
  return (
    <div
      {...props}
      className={cns(
        'rounded-lg border border-line p-5',
        sunk ? 'bg-bg-sunk' : 'bg-surface',
        className,
      )}
    />
  )
}

export type NoteProps = ComponentPropsWithoutRef<'div'> & {
  /** The leading icon. Defaults to the neutral hint, `alert`. */
  icon?: IconName
}

/**
 * An aside the interface is making to you — a leading icon and a block of
 * prose, boxed at the same weight as a `Card` but tighter.
 *
 * `Note` has no tone prop, and that is deliberate: `ui.pug` gives it exactly
 * one appearance and the two mockup screens that need a louder one override it
 * from the call site with `!` utilities, e.g.
 * `className="border-bad/35! bg-bad-ghost! [&>svg]:text-bad!"`. The icon is a
 * direct child `<svg>`, so that `[&>svg]:` selector reaches it.
 */
export function Note({
  icon = 'alert',
  className,
  children,
  ...props
}: NoteProps): JSX.Element {
  return (
    <div
      {...props}
      className={cns(
        'flex gap-2.5 rounded-md border border-line bg-surface px-[15px] py-[13px] text-sm text-ink-2',
        className,
      )}
    >
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}
