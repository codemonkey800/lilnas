import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

export type StateLineProps = ComponentPropsWithoutRef<'div'> & {
  /**
   * Stack the row instead of laying it out in one line. This is a layout
   * switch, not a breakpoint: the mockups render the desktop and mobile
   * appendices side by side on the same page, so the choice has to be a prop
   * rather than a `sm:` variant.
   */
  mobile?: boolean
}

/**
 * A row in a "here's how every other state reads" legend — a status chip, the
 * explanation, and whatever action that state offers.
 *
 * The `[&+&]:` pair draws the divider between consecutive rows from the rows
 * themselves, so a legend is just a `Card` full of `StateLine`s with no
 * separator elements and no `:first-child` special case.
 */
export function StateLine({
  mobile = false,
  className,
  ...props
}: StateLineProps): JSX.Element {
  return (
    <div
      {...props}
      className={cns(
        'flex px-0.5 py-[13px] [&+&]:border-t [&+&]:border-line-soft',
        mobile ? 'flex-col items-start gap-[9px]' : 'items-center gap-[14px]',
        className,
      )}
    />
  )
}

export type StateLineActionsProps = ComponentPropsWithoutRef<'span'>

/**
 * The buttons at the end of a stacked (`mobile`) `StateLine` — full width,
 * split evenly. Desktop rows put their button in the row directly and do not
 * use this wrapper.
 */
export function StateLineActions({
  className,
  ...props
}: StateLineActionsProps): JSX.Element {
  return (
    <span
      {...props}
      className={cns('flex w-full gap-2 [&>button]:flex-1', className)}
    />
  )
}
