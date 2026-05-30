'use client'

import { cns } from '@lilnas/utils/cns'

import {
  getTreatmentStyle,
  ICON_MAP,
} from 'src/components/session/action-presentation'
import type { Action } from 'src/core/session-machine'
import { formatWeightPreview } from 'src/lib/format'
import type { ButtonSlotConfig } from 'src/lib/runner'

export type ActionButtonGridProps = {
  buttons: ButtonSlotConfig[]
  isPending: boolean
  // Called for all non-Failed actions. Failed opens the FailedSheet.
  onAction: (action: Action) => void
  // Called when the Failed button is tapped to open the sheet.
  onOpenFailed: () => void
}

// Equal 2×2 grid (R7/R8). Empty slots render invisible spacers so slots 1
// and 4 stay anchored regardless of how many buttons are present.
export function ActionButtonGrid({
  buttons,
  isPending,
  onAction,
  onOpenFailed,
}: ActionButtonGridProps) {
  // Build a map keyed by slot (1–4) for stable positioning.
  const slotMap = new Map(buttons.map(b => [b.slot, b]))

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {([1, 2, 3, 4] as const).map(slot => {
        const btn = slotMap.get(slot)

        if (!btn) {
          // Invisible spacer — keeps anchored slots in place (R8).
          return (
            <div
              key={slot}
              aria-hidden
              className="pointer-events-none invisible"
            />
          )
        }

        const Icon = ICON_MAP[btn.iconKey]
        const { className: treatmentClass } = getTreatmentStyle(btn.treatment)
        const isFailed = btn.actionType === 'Failed'

        return (
          <button
            key={slot}
            type="button"
            disabled={isPending}
            onClick={() => {
              if (isFailed) {
                onOpenFailed()
              } else {
                onAction({ type: btn.actionType } as Action)
              }
            }}
            className={cns(
              'flex items-center gap-3 px-5',
              'min-h-[60px] w-full rounded-xl text-left',
              'cursor-pointer text-white transition-all duration-150',
              'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
              treatmentClass,
            )}
          >
            <Icon className="flex-shrink-0 opacity-80" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold uppercase tracking-widest leading-none">
                {btn.label}
              </span>
              {btn.previewWeight !== undefined && (
                <span className="text-xs font-medium leading-none opacity-60">
                  {formatWeightPreview(btn.previewWeight)}
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
