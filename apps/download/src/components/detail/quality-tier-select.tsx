'use client'

import { Select } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { QualityTier } from '@lilnas/utils/download/types'
import {
  QUALITY_TIER_LABELS,
  QUALITY_TIERS,
} from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/** The mono caption inside the trigger — `ui.pug`'s `tierSelect`. */
export const QUALITY_TIER_SELECT_LABEL = 'Quality'

/**
 * The trigger's accessible name — `Quality: HD (up to 1080p)`.
 *
 * Spelled out rather than left to the trigger's text, which runs the caption
 * and the value together (`QualityHD (up to 1080p)`) — the same call
 * `search-toolbar.tsx` makes with its `Sort by …` label. The listbox is
 * labelled by the trigger, so it reads the same name.
 */
export function qualityTierSelectName(tier: QualityTier): string {
  return `${QUALITY_TIER_SELECT_LABEL}: ${QUALITY_TIER_LABELS[tier]}`
}

/** `Select` reports a plain string — this is the narrowing back to the enum, no cast. */
function isQualityTier(value: string): value is QualityTier {
  return (QUALITY_TIERS as readonly string[]).includes(value)
}

/**
 * The picker and the button, side by side from `sm` and stacked under it -
 * `requestRow` in the movie and show mockups. `items-end` so the button lines
 * up with the trigger, not with the label above it.
 */
export const QUALITY_TIER_ROW = cns(
  'flex flex-col gap-3',
  'sm:flex-row sm:items-end sm:gap-2.5',
)

/** The picker's own column: 240px beside the button, full width stacked. */
export const QUALITY_TIER_PICKER = 'w-full sm:w-60 sm:shrink-0'

/** One sentence under the row: what a tier is. A cap, not an exact match. */
export const QUALITY_TIER_HINT =
  'A cap, not a match — it falls back when nothing fits.'

/** The hint's own style, for the two request buttons that draw it under their row. */
export const QUALITY_TIER_HINT_CLASS = 'max-w-[56ch] text-cap text-ink-3'

/** The visible `Quality` label above the trigger, as `Field` draws one. */
const CAPTION = 'text-sm font-medium text-ink-2'

/** A long tier name truncates inside the trigger rather than widening it. */
const VALUE = 'min-w-0 flex-1 truncate'

export type QualityTierSelectProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'id' | 'onChange'
> & {
  /** Out of the focus order — a request is already on its way. */
  disabled?: boolean
  /** The id of the caption under the whole row, so the trigger is described by it. */
  describedBy?: string
  /** The trigger's id, for an outside `<label>` to point at. */
  id?: string
  onChange: (tier: QualityTier) => void
  value: QualityTier
}

/**
 * The quality tier picker — `ui.pug`'s `tierSelect`: an input-shaped trigger
 * reading `QUALITY` and the chosen tier, over a listbox of every tier, best
 * first.
 *
 * Built on `Select` rather than a native `<select>` because the open state is
 * `Select`'s panel exactly, and `Select` already carries the keyboard model a
 * `<select>` would give for free. Controlled — the request button
 * beside it owns the choice, because that is what it sends.
 *
 * Width is the caller's: the mockups draw it `236px` beside the button and
 * full-width on the stacked mobile header, which is a layout decision and not
 * this component's.
 */
export function QualityTierSelect({
  className,
  disabled = false,
  describedBy,
  id,
  onChange,
  value,
  ...props
}: QualityTierSelectProps): JSX.Element {
  return (
    <div {...props} className={cns('flex flex-col gap-1.5', className)}>
      <span aria-hidden="true" className={cns(CAPTION)}>
        {QUALITY_TIER_SELECT_LABEL}
      </span>
      <Select.Root
        disabled={disabled}
        items={QUALITY_TIER_LABELS}
        value={value}
        onValueChange={next => {
          if (next !== null && isQualityTier(next)) {
            onChange(next)
          }
        }}
      >
        <Select.Trigger
          aria-describedby={describedBy}
          aria-label={qualityTierSelectName(value)}
          id={id}
        >
          <Select.Value className={cns(VALUE)} />
        </Select.Trigger>
        <Select.Popup>
          {QUALITY_TIERS.map(tier => (
            <Select.Item key={tier} value={tier}>
              {QUALITY_TIER_LABELS[tier]}
            </Select.Item>
          ))}
        </Select.Popup>
      </Select.Root>
    </div>
  )
}
