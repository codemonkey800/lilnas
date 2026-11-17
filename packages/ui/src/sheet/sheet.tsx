'use client'

import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cns } from '@lilnas/utils/cns'
import type { ComponentProps, JSX } from 'react'

import { SCRIM } from '../internal/overlay'

export type SheetSide = 'right' | 'bottom'

const SIDES: Record<SheetSide, string> = {
  right: cns(
    'inset-y-0 right-0 w-full max-w-[480px] border-l border-line-loud',
    'data-ending-style:translate-x-full data-starting-style:translate-x-full',
  ),
  bottom: cns(
    'inset-x-0 bottom-0 max-h-[85vh] rounded-t-xl border-t border-line-loud',
    'data-ending-style:translate-y-full data-starting-style:translate-y-full',
  ),
}

type PopupProps = ComponentProps<typeof BaseDialog.Popup> & {
  /** The edge it slides from. `bottom` is for phones, `right` for detail panes. */
  side?: SheetSide
}

/**
 * The scrim and an edge-anchored panel. A `bottom` sheet draws a grab handle;
 * it has no swipe gesture, so on any screen it closes by button, Escape or
 * scrim.
 */
function Popup({
  side = 'right',
  className,
  children,
  ...props
}: PopupProps): JSX.Element {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className={SCRIM} />
      <BaseDialog.Popup
        {...props}
        className={cns(
          'fixed z-50 flex flex-col overflow-y-auto bg-surface p-4 shadow-lift outline-none',
          'transition-transform duration-[380ms] ease-standard',
          SIDES[side],
          className,
        )}
        data-side={side}
      >
        {side === 'bottom' ? (
          <span
            aria-hidden="true"
            className="mx-auto mb-3 h-1 w-9 shrink-0 rounded-full bg-line-loud"
            data-sheet-handle=""
          />
        ) : null}
        {children}
      </BaseDialog.Popup>
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

/**
 * A Base UI dialog pinned to an edge: it traps focus, closes on Escape and a
 * scrim click, and restores focus to its trigger.
 *
 * ```tsx
 * <Sheet.Root>
 *   <Sheet.Trigger render={<Button />}>Details</Sheet.Trigger>
 *   <Sheet.Popup side="right">
 *     <Sheet.Title>Session 4f2a</Sheet.Title>
 *     <Sheet.Close render={<Button variant="ghost" />}>Close</Sheet.Close>
 *   </Sheet.Popup>
 * </Sheet.Root>
 * ```
 */
export const Sheet = {
  Root: BaseDialog.Root,
  Trigger: BaseDialog.Trigger,
  Popup,
  Title,
  Close: BaseDialog.Close,
}
