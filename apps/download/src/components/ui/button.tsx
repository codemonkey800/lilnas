'use client'

import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'

export type ButtonVariant = 'uv' | 'outline' | 'ghost' | 'bad'
export type ButtonSize = 'sm' | 'lg'

/**
 * Each variant owns its border colour rather than overriding a shared
 * `border-transparent`. Two utilities for the same property on one element are
 * resolved by Tailwind's output order, not by the order they appear here, so
 * the tables below are kept mutually exclusive on purpose.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
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
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-[11px] text-[13px]',
  lg: 'h-[46px] px-[22px] text-h3',
}

/** `ghost` and `bad` are quieter, so they sit on tighter default padding. */
const BUTTON_DEFAULT_SIZE = 'h-[38px] px-[15px] text-[14px]'
const BUTTON_QUIET_DEFAULT_SIZE = 'h-[38px] px-[11px] text-[14px]'

const BUTTON_BASE = cns(
  'inline-flex items-center justify-center gap-[7px] rounded-md border',
  'font-[550] tracking-[-0.005em] whitespace-nowrap',
  'transition-press active:scale-96',
  'disabled:pointer-events-none disabled:opacity-38',
)

const BUTTON_ICON = 'h-[15px] w-[15px] shrink-0'

export type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  /** Visual weight. Omitted renders the bare, borderless shape. */
  variant?: ButtonVariant
  /** Omitted renders the 38px default. */
  size?: ButtonSize
  /** Icon rendered before the label. */
  icon?: IconName
  /** Icon rendered after the label. */
  iconEnd?: IconName
  /** Stretch to the container width. */
  full?: boolean
}

/**
 * The Ultraviolet button. Defaults to `type="button"` — a bare `<button>`
 * inside a form submits it, which is almost never what a call site means.
 * Callers that do want a submit button pass `type="submit"` explicitly.
 */
export function Button({
  variant,
  size,
  icon,
  iconEnd,
  full = false,
  className,
  children,
  ...props
}: ButtonProps): JSX.Element {
  const quiet = variant === 'ghost' || variant === 'bad'

  return (
    <button
      type="button"
      {...props}
      className={cns(
        BUTTON_BASE,
        variant ? BUTTON_VARIANTS[variant] : 'border-transparent',
        size
          ? BUTTON_SIZES[size]
          : quiet
            ? BUTTON_QUIET_DEFAULT_SIZE
            : BUTTON_DEFAULT_SIZE,
        full && 'w-full',
        className,
      )}
    >
      {icon ? <Icon className={BUTTON_ICON} name={icon} /> : null}
      {children}
      {iconEnd ? <Icon className={BUTTON_ICON} name={iconEnd} /> : null}
    </button>
  )
}
