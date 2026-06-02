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

// When exactly 2 buttons are present, render them side-by-side in a single
// row. Otherwise use the 2×2 grid with invisible spacers for slot stability.
export function ActionButtonGrid({
  buttons,
  isPending,
  onAction,
  onOpenFailed,
}: ActionButtonGridProps) {
  const isTwoButtonRow = buttons.length === 2

  if (isTwoButtonRow) {
    return (
      <div className="flex gap-2.5">
        {buttons.map(btn => {
          const Icon = ICON_MAP[btn.iconKey]
          const { className: treatmentClass } = getTreatmentStyle(btn.treatment)
          const isFailed = btn.actionType === 'Failed'

          return (
            <button
              key={btn.slot}
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
                'flex flex-1 items-center gap-3 px-5',
                'min-h-[60px] rounded-xl text-left',
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

  // Build a map keyed by slot (1–4) for stable positioning.
  const slotMap = new Map(buttons.map(b => [b.slot, b]))

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {([1, 2, 3, 4] as const).map(slot => {
        const btn = slotMap.get(slot)

        if (!btn) {
          // Invisible spacer — keeps anchored slots in place.
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
              'flex items-center gap-2 px-4',
              'min-h-[60px] w-full overflow-hidden rounded-xl text-left',
              'cursor-pointer text-white transition-all duration-150',
              'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
              treatmentClass,
            )}
          >
            <Icon className="flex-shrink-0 opacity-80" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-xs font-bold uppercase tracking-wider leading-none">
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
