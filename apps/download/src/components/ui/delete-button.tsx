import { Button, type ButtonProps } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

/**
 * The filled red confirm, the same recipe `@lilnas/ui`'s `ConfirmDialog` uses
 * for its destructive confirm. Applied on top of the `accent` variant, whose
 * hover and press fills it replaces.
 */
const DELETE_FILL = 'bg-bad text-bg-sunk hover:bg-bad/85 active:bg-bad/75'

export type DeleteButtonProps = Omit<ButtonProps, 'variant'>

/**
 * The destructive confirm inside a delete dialog. Defaults to a small button
 * with a trailing `trash` and a "Delete" label, each of which a call site can
 * replace; `full` is for the stacked mobile layout.
 *
 * App-local rather than `ConfirmDialog` because the two delete dialogs carry
 * their own error line, scope copy and mobile stacking, which `ConfirmDialog`
 * has no slot for.
 */
export function DeleteButton({
  size = 'sm',
  iconEnd = 'trash',
  className,
  children,
  ...props
}: DeleteButtonProps): JSX.Element {
  return (
    <Button
      {...props}
      className={cns(DELETE_FILL, className)}
      iconEnd={iconEnd}
      size={size}
      variant="accent"
    >
      {children ?? 'Delete'}
    </Button>
  )
}
