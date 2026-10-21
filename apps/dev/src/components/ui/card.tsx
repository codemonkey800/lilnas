import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

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
