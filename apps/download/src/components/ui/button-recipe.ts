import { cns } from '@lilnas/utils/cns'

export type ButtonVariant = 'uv' | 'outline' | 'ghost' | 'bad'
export type ButtonSize = 'sm' | 'lg'

/**
 * Each variant owns its border colour rather than overriding a shared
 * `border-transparent`. Two utilities for the same property on one element are
 * resolved by Tailwind's output order, not by the order they appear here, so
 * the tables below are kept mutually exclusive on purpose.
 */
export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  uv: 'border-transparent bg-uv text-uv-ink font-[620] hover:bg-uv-hi active:bg-uv-press',
  outline:
    'border-line bg-surface text-ink hover:border-uv-dim hover:bg-surface-2',
  ghost: 'border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink',
  bad: 'border-transparent text-bad hover:bg-bad-ghost',
}

/**
 * ...and for the same reason each size owns its height, padding *and* type
 * size. `ui.pug` leaves `text-[14px]` on the base and lets `lg`'s `text-h3`
 * land on top of it; `text-h3` is a theme token rather than an arbitrary
 * length, so that pairing is exactly the output-order coin flip the variant
 * table avoids. Folding the default `text-[14px]` into the size table keeps
 * one font-size utility per button.
 *
 * `lg` uses the plain `text-h3` token, which carries its own
 * `--text-h3--line-height` and `--text-h3--font-weight` companions. That is
 * only safe because `packages/utils/src/cns.ts` registers this theme's
 * `--text-*` names as font sizes with `extendTailwindMerge`; without it
 * tailwind-merge reads them as text *colours* and `cns(BASE, variant, size)`
 * silently drops the variant's ink — which is how a large `uv` button once
 * shipped near-white on its purple fill.
 */
export const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-[11px] text-[13px]',
  lg: 'h-[46px] px-[22px] text-h3',
}

/** `ghost` and `bad` are quieter, so they sit on tighter default padding. */
export const BUTTON_DEFAULT_SIZE = 'h-[38px] px-[15px] text-[14px]'
export const BUTTON_QUIET_DEFAULT_SIZE = 'h-[38px] px-[11px] text-[14px]'

/**
 * `aria-disabled` is styled alongside the real `:disabled`, because the two
 * mean the same thing to a reader and should look the same.
 *
 * They differ in one respect on purpose. `:disabled` takes
 * `pointer-events-none`; `aria-disabled` does not, and gets
 * `cursor-not-allowed` plus a suppressed press animation instead. The whole
 * reason to reach for `aria-disabled` is that a real `disabled` attribute
 * drops the element out of the focus order — so a control that disables
 * itself *while the user is on it* throws focus to `<body>`, and the user has
 * to Tab back from the top of the document to press it again.
 *
 * This same string is correct on both `Button` and `ButtonLink` without a
 * split: `disabled:` compiles to the `:disabled` pseudo-class, which no
 * anchor can ever match, so it is silently inert there; `aria-disabled:`
 * compiles to the plain attribute selector `[aria-disabled="true"]`, which
 * applies identically to a `<button>` or an `<a>`. Each component still owns
 * its half of the *behavioural* contract (swallowing `onClick`, and for
 * `ButtonLink`, dropping `href`) — this constant only carries the paint.
 */
export const BUTTON_BASE = cns(
  'inline-flex items-center justify-center gap-[7px] rounded-md border',
  'font-[550] tracking-[-0.005em] whitespace-nowrap',
  'transition-press active:scale-96',
  'disabled:pointer-events-none disabled:opacity-38',
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-38',
  'aria-disabled:active:scale-100',
)

export const BUTTON_ICON = 'h-[15px] w-[15px] shrink-0'

export type ButtonRecipeOptions = {
  /** Visual weight. Omitted renders the bare, borderless shape. */
  variant?: ButtonVariant
  /** Omitted renders the 38px default. */
  size?: ButtonSize
  /** Stretch to the container width. */
  full?: boolean
  /** Caller override, merged last so it can beat any of the above. */
  className?: string
}

/**
 * The single class-list recipe `Button` and `ButtonLink` both render, so a
 * change to a variant or size table only ever has one call site to update.
 */
export function buttonRecipeClassName({
  variant,
  size,
  full = false,
  className,
}: ButtonRecipeOptions): string {
  const quiet = variant === 'ghost' || variant === 'bad'

  return cns(
    BUTTON_BASE,
    variant ? BUTTON_VARIANTS[variant] : 'border-transparent',
    size
      ? BUTTON_SIZES[size]
      : quiet
        ? BUTTON_QUIET_DEFAULT_SIZE
        : BUTTON_DEFAULT_SIZE,
    full && 'w-full',
    className,
  )
}
