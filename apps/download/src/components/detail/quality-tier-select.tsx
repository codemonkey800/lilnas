'use client'

import { cns } from '@lilnas/utils/cns'
import type { QualityTier } from '@lilnas/utils/download/types'
import {
  QUALITY_TIER_LABELS,
  QUALITY_TIERS,
} from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'
import { useId, useState } from 'react'

import { Menu, MenuItem } from 'src/components/ui/menu'

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

/** `Menu` reports a plain string — this is the narrowing back to the enum, no cast. */
function isQualityTier(value: string): value is QualityTier {
  return (QUALITY_TIERS as readonly string[]).includes(value)
}

/**
 * The picker and the button, side by side from `sm` and stacked under it —
 * the header row of `movie-detail.pug` and `show-detail.pug`, and
 * their mobile column. `items-start` so the
 * button lines up with the trigger rather than the picker's middle.
 */
export const QUALITY_TIER_ROW = cns(
  'flex flex-col gap-2',
  'sm:flex-row sm:items-start sm:gap-2.5',
)

/**
 * `tierSelect`'s `w-[236px]`, and `full` on the stacked mobile header.
 * `shrink-0` so a `full` button beside it takes the rest of the row rather
 * than squeezing the picker.
 */
export const QUALITY_TIER_PICKER = 'w-full sm:w-[236px] sm:shrink-0'

const TRIGGER = 'gap-2'
/** The closed trigger's hover — never drawn over the open accent ring. */
const TRIGGER_CLOSED_HOVER = 'hover:border-uv-dim'

const CAPTION = 'font-mono text-label tracking-[0.11em] uppercase text-ink-4'
const VALUE = 'min-w-0 flex-1 truncate'
const HINT = 'text-cap text-ink-4'

export type QualityTierSelectProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'id' | 'onChange'
> & {
  /** Out of the focus order — a request is already on its way. */
  disabled?: boolean
  /** A caption under the trigger — the show page's "Applies to the whole show". */
  hint?: string
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
 * Built on `Menu` rather than a native `<select>` because the mockup's open
 * state is `Menu`'s panel exactly, and `Menu` already carries the keyboard
 * model a `<select>` would give for free. Controlled — the request button
 * beside it owns the choice, because that is what it sends.
 *
 * Width is the caller's: the mockups draw it `236px` beside the button and
 * full-width on the stacked mobile header, which is a layout decision and not
 * this component's.
 */
export function QualityTierSelect({
  className,
  disabled = false,
  hint,
  id,
  onChange,
  value,
  ...props
}: QualityTierSelectProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const hintId = useId()

  return (
    <div {...props} className={cns('flex flex-col gap-1.5', className)}>
      <Menu
        label={
          <>
            <span className={cns(CAPTION)}>{QUALITY_TIER_SELECT_LABEL}</span>
            <span className={cns(VALUE)}>{QUALITY_TIER_LABELS[value]}</span>
          </>
        }
        open={open}
        triggerClassName={cns(TRIGGER, !open && TRIGGER_CLOSED_HOVER)}
        triggerProps={{
          'aria-describedby': hint ? hintId : undefined,
          'aria-label': qualityTierSelectName(value),
          disabled,
          id,
        }}
        value={value}
        onOpenChange={setOpen}
        onValueChange={next => {
          if (isQualityTier(next)) {
            onChange(next)
          }
        }}
      >
        {QUALITY_TIERS.map(tier => (
          <MenuItem key={tier} value={tier}>
            {QUALITY_TIER_LABELS[tier]}
          </MenuItem>
        ))}
      </Menu>
      {hint ? (
        <p className={cns(HINT)} id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
