'use client'

import { useRender } from '@base-ui/react/use-render'
import { cns } from '@lilnas/utils/cns'
import type { MouseEvent, ReactElement, ReactNode } from 'react'

import type { IconName } from '../icons'
import { Icon } from '../icons'

export type ButtonVariant = 'accent' | 'outline' | 'ghost' | 'bad'
export type ButtonSize = 'sm' | 'md' | 'lg'

/**
 * Each variant owns its border colour instead of overriding a shared
 * `border-transparent`: two utilities for one property resolve by Tailwind's
 * output order, not by position in the class list, so the tables are kept
 * mutually exclusive on purpose.
 */
const VARIANTS: Record<ButtonVariant, string> = {
  accent:
    'border-transparent bg-accent text-accent-ink hover:bg-accent-hi active:bg-accent-press',
  outline:
    'border-line bg-surface-2 text-ink hover:border-line-loud hover:bg-surface',
  ghost: 'border-transparent text-accent-hi hover:bg-accent-ghost',
  bad: 'border-bad text-bad hover:bg-bad-ghost',
}

/**
 * Heights ride the `--control-h*` variables `theme.css` flips under
 * `data-density="compact"`; `lg` is a fixed 44px. Icon-only buttons are square
 * on the same variable. Everything is at least 44px on a coarse pointer.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-(--control-h-sm) px-[11px] text-sm',
  md: 'h-(--control-h) px-3.5 text-body',
  lg: 'h-11 px-5 text-[15px]',
}

const ICON_ONLY_SIZES: Record<ButtonSize, string> = {
  sm: 'h-(--control-h-sm) w-(--control-h-sm) px-0',
  md: 'h-(--control-h) w-(--control-h) px-0',
  lg: 'size-11 px-0',
}

const BASE = cns(
  'relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap',
  'pointer-coarse:min-h-11 pointer-coarse:min-w-11',
  'transition-press',
  'disabled:pointer-events-none disabled:opacity-40',
  'aria-disabled:cursor-not-allowed aria-disabled:not-aria-busy:opacity-40',
  'aria-busy:cursor-progress aria-disabled:active:transform-none',
)

export type ButtonClassNameOptions = {
  variant?: ButtonVariant
  size?: ButtonSize
  full?: boolean
  iconOnly?: boolean
  className?: string
}

/** The class list `Button` renders, for a control that can't be a `Button`. */
export function buttonClassName({
  variant = 'outline',
  size = 'md',
  full = false,
  iconOnly = false,
  className,
}: ButtonClassNameOptions = {}): string {
  return cns(
    BASE,
    VARIANTS[variant],
    iconOnly ? ICON_ONLY_SIZES[size] : SIZES[size],
    full && 'w-full',
    className,
  )
}

export type ButtonProps = Omit<useRender.ComponentProps<'button'>, 'render'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Stretch to the container width. */
  full?: boolean
  /**
   * In flight: sets `aria-busy` and `aria-disabled`, swallows clicks, and
   * swaps the leading icon for a ring. The label stays and the width doesn't
   * change. Stays focusable, unlike `disabled`.
   */
  loading?: boolean
  icon?: IconName
  iconEnd?: IconName
  /** Swap the element, e.g. `render={<Link href="…" />}`. */
  render?: ReactElement
}

const isTrue = (value: unknown): boolean => value === true || value === 'true'

function Ring(): ReactNode {
  return (
    <span
      aria-hidden="true"
      className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  )
}

/**
 * `type="button"` unless `render` swaps the element, so a bare button inside a
 * form never submits by accident. Icon-only buttons (an icon, no children)
 * must carry an `aria-label`; outside production a missing one throws.
 */
export function Button({
  variant,
  size,
  full,
  loading = false,
  icon,
  iconEnd,
  render,
  className,
  children,
  onClick,
  ref,
  type,
  ...props
}: ButtonProps): ReactElement {
  const iconOnly = (icon || iconEnd) && !children
  const inert = loading || isTrue(props['aria-disabled'])

  if (
    process.env.NODE_ENV !== 'production' &&
    iconOnly &&
    !props['aria-label'] &&
    !props['aria-labelledby']
  ) {
    throw new Error('An icon-only Button needs an aria-label.')
  }

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (inert) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  // With no leading icon to swap, the ring sits over the label (kept in the
  // layout, hidden) so the button doesn't grow.
  const overlayRing = loading && !icon

  return useRender({
    defaultTagName: 'button',
    render,
    ref,
    props: {
      type: type ?? (render ? undefined : 'button'),
      ...props,
      'aria-busy': loading || undefined,
      'aria-disabled': inert || undefined,
      className: buttonClassName({
        variant,
        size,
        full,
        iconOnly: Boolean(iconOnly),
        className,
      }),
      onClick: handleClick,
      children: (
        <>
          {loading && icon ? <Ring /> : icon ? <Icon name={icon} /> : null}
          {overlayRing ? (
            <span className="absolute inset-0 grid place-items-center">
              <Ring />
            </span>
          ) : null}
          {children != null ? (
            <span className={cns(overlayRing && 'invisible')}>{children}</span>
          ) : null}
          {iconEnd ? (
            <Icon className={cns(overlayRing && 'invisible')} name={iconEnd} />
          ) : null}
        </>
      ),
    },
  })
}
