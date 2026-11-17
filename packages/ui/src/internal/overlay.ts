import { cns } from '@lilnas/utils/cns'

/**
 * The dimmed layer behind a dialog or sheet. Base UI renders one backdrop for
 * a stack of nested dialogs, so a second dialog never darkens it twice.
 */
export const SCRIM = cns(
  'fixed inset-0 z-50 bg-black/55',
  'transition-opacity duration-200 ease-standard',
  'data-ending-style:opacity-0 data-starting-style:opacity-0',
)

/**
 * The floating panel shared by `Menu` and `Select`. It enters with the
 * system's rise (6px up, fading in) on transitions rather than the `rise`
 * keyframes, because a keyframe fill would hold the popup in place and stop
 * the exit from running.
 */
export const FLOATING_PANEL = cns(
  'rounded-lg border border-line-loud bg-surface p-1.5 shadow-lift outline-none',
  'origin-(--transform-origin) transition-[opacity,transform] duration-200 ease-standard',
  'data-ending-style:translate-y-1.5 data-ending-style:opacity-0',
  'data-starting-style:translate-y-1.5 data-starting-style:opacity-0',
)

/**
 * Menu and Select rows: 32px (28px under `data-density="compact"`), highlight
 * on pointer and keyboard alike.
 */
export const FLOATING_ITEM = cns(
  'flex h-8 cursor-default items-center gap-2 rounded-md px-2.5 text-[13.5px] text-ink-2 select-none',
  'in-data-[density=compact]:h-7',
  'transition-colors duration-200 ease-standard outline-none',
  'data-disabled:pointer-events-none data-disabled:opacity-40',
  'data-highlighted:bg-surface-2 data-highlighted:text-ink',
)

/** Small-caps heading above a group of rows. */
export const FLOATING_GROUP_LABEL = cns(
  'px-2.5 pt-2 pb-1 text-label text-ink-3 uppercase',
)
