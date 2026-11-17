'use client'

import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cns } from '@lilnas/utils/cns'
import type { ComponentProps, JSX, ReactNode } from 'react'

import { Button } from '../button'
import { SCRIM } from '../internal/overlay'

/**
 * The scrim, the centring viewport and the panel in one part. A nested dialog
 * reuses the parent's scrim, so only the panel is drawn for it.
 */
function Popup({
  className,
  children,
  ...props
}: ComponentProps<typeof BaseDialog.Popup>): JSX.Element {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={SCRIM} />
      <BaseDialog.Viewport className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-6">
        <BaseDialog.Popup
          {...props}
          className={cns(
            'flex w-full max-w-[440px] flex-col gap-3 rounded-lg border border-line-loud bg-surface p-5 shadow-lift outline-none',
            'transition-[opacity,transform] duration-200 ease-standard',
            'data-ending-style:translate-y-1.5 data-ending-style:opacity-0',
            'data-starting-style:translate-y-1.5 data-starting-style:opacity-0',
            className,
          )}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  )
}

function Title({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Title>): JSX.Element {
  return (
    <BaseDialog.Title
      {...props}
      className={cns('text-h3 text-ink', className)}
    />
  )
}

function Description({
  className,
  ...props
}: ComponentProps<typeof BaseDialog.Description>): JSX.Element {
  return (
    <BaseDialog.Description
      {...props}
      className={cns('text-sm text-ink-2', className)}
    />
  )
}

/** Right-aligned button row; the primary action goes last. */
function Actions({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      {...props}
      className={cns('flex items-center justify-end gap-2 pt-2', className)}
    />
  )
}

/**
 * A modal that traps focus, closes on Escape and a scrim click, and hands
 * focus back to its trigger.
 *
 * ```tsx
 * <Dialog.Root>
 *   <Dialog.Trigger render={<Button />}>Report a problem</Dialog.Trigger>
 *   <Dialog.Popup>
 *     <Dialog.Title>Report a problem</Dialog.Title>
 *     <Dialog.Description>What went wrong?</Dialog.Description>
 *     <Dialog.Actions>
 *       <Dialog.Close render={<Button variant="ghost" />}>Cancel</Dialog.Close>
 *       <Button variant="accent">Send</Button>
 *     </Dialog.Actions>
 *   </Dialog.Popup>
 * </Dialog.Root>
 * ```
 */
export const Dialog = {
  Root: BaseDialog.Root,
  Trigger: BaseDialog.Trigger,
  Popup,
  Title,
  Description,
  Actions,
  Close: BaseDialog.Close,
}

export type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Names the object: `Delete "Dune: Part Two"?`, never "Are you sure?". */
  title: ReactNode
  /** Names the consequence: what comes off the disk, what can be undone. */
  body: ReactNode
  /** The verb the button does: `Delete`, `Kill session`. */
  confirmLabel: ReactNode
  /** `Keep it` fits a destructive verb better than `Cancel`. */
  cancelLabel?: ReactNode
  /** `bad` fills the confirm red; `accent` is for a consequential, harmless ask. */
  tone?: 'bad' | 'accent'
  /** Called once per press. It does not close the dialog: the caller does. */
  onConfirm: () => void
  /**
   * The confirmed action is in flight. The confirm button shows a ring and
   * swallows clicks, Cancel is disabled, and Escape and the scrim stop
   * dismissing.
   */
  pending?: boolean
}

/**
 * The yes/no dialog. The filled red button exists here and nowhere else in
 * the system, so a destructive confirm is always this component.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Keep it',
  tone = 'bad',
  onConfirm,
  pending = false,
}: ConfirmDialogProps): JSX.Element {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        if (pending && !next) return
        onOpenChange(next)
      }}
    >
      <Dialog.Popup>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description>{body}</Dialog.Description>
        <Dialog.Actions>
          <Dialog.Close render={<Button disabled={pending} variant="ghost" />}>
            {cancelLabel}
          </Dialog.Close>
          <Button
            className={cns(
              tone === 'bad' &&
                'bg-bad text-bg-sunk hover:bg-bad/85 active:bg-bad/75',
            )}
            loading={pending}
            variant="accent"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </Dialog.Actions>
      </Dialog.Popup>
    </Dialog.Root>
  )
}
