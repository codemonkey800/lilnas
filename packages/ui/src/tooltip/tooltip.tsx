'use client'

import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import { cns } from '@lilnas/utils/cns'
import type { ComponentProps, JSX } from 'react'

/** Wait this long before the first tooltip opens. */
export const TOOLTIP_DELAY_MS = 400

/**
 * Wraps a region of tooltips. Moving between neighbours inside the provider's
 * grace period opens the next one with no delay at all.
 */
function Provider({
  delay = TOOLTIP_DELAY_MS,
  closeDelay = 0,
  ...props
}: ComponentProps<typeof BaseTooltip.Provider>): JSX.Element {
  return (
    <BaseTooltip.Provider closeDelay={closeDelay} delay={delay} {...props} />
  )
}

type PopupProps = ComponentProps<typeof BaseTooltip.Popup> &
  Pick<
    ComponentProps<typeof BaseTooltip.Positioner>,
    'side' | 'align' | 'sideOffset'
  >

/**
 * The tooltip surface. Bundles the portal and the positioner, which every
 * tooltip needs, so a call site is `Tooltip.Root > Trigger + Popup`.
 */
function Popup({
  side,
  align,
  sideOffset = 6,
  className,
  ...props
}: PopupProps): JSX.Element {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner
        align={align}
        className="z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <BaseTooltip.Popup
          {...props}
          className={cns(
            'animate-rise rounded-md border border-line-loud bg-surface-2 px-2 py-1.5',
            'text-xs font-medium text-ink shadow-lift',
            className,
          )}
        />
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}

/**
 * Never the only place a fact appears: touch users can't hover.
 *
 * ```tsx
 * <Tooltip.Provider>
 *   <Tooltip.Root>
 *     <Tooltip.Trigger render={<Button />}>Pause</Tooltip.Trigger>
 *     <Tooltip.Popup>Pause all downloads</Tooltip.Popup>
 *   </Tooltip.Root>
 * </Tooltip.Provider>
 * ```
 */
export const Tooltip = {
  Provider,
  Root: BaseTooltip.Root,
  Trigger: BaseTooltip.Trigger,
  Popup,
}
