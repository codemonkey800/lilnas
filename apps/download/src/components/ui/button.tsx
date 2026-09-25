'use client'

import type { ComponentPropsWithoutRef, JSX } from 'react'

import type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'
import {
  BUTTON_ICON,
  buttonRecipeClassName,
} from 'src/components/ui/button-recipe'
import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'

export type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'

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
 *
 * Two ways to turn it off, and they are not interchangeable:
 *
 * - `disabled` — the default choice. Out of the focus order, not hit-testable.
 * - `aria-disabled` — for a control that disables *itself* under the user,
 *   where losing focus would strand them. Stays focusable and announced as
 *   disabled; `onClick` is swallowed here so no call site has to guard it.
 *
 * ⚠️ `aria-disabled` does **not** stop a `type="submit"` button from
 * submitting its form — the browser does that natively and no handler is
 * involved. Use the real `disabled` attribute for a submit button.
 *
 * Not polymorphic — it renders a `<button>` and only a `<button>`. A control
 * that *navigates* rather than acts wants `ButtonLink`
 * (`src/components/ui/button-link.tsx`) instead, which wears the same recipe
 * on a real `<a>`.
 */
export function Button({
  variant,
  size,
  icon,
  iconEnd,
  full = false,
  className,
  children,
  onClick,
  ...props
}: ButtonProps): JSX.Element {
  // `aria-disabled` arrives as boolean `true` or the string `"true"`
  // depending on the call site; both mean disabled, `"false"` does not.
  const ariaDisabled = props['aria-disabled']
  const inert = ariaDisabled === true || ariaDisabled === 'true'

  return (
    <button
      type="button"
      {...props}
      className={buttonRecipeClassName({ variant, size, full, className })}
      onClick={inert ? undefined : onClick}
    >
      {icon ? <Icon className={BUTTON_ICON} name={icon} /> : null}
      {children}
      {iconEnd ? <Icon className={BUTTON_ICON} name={iconEnd} /> : null}
    </button>
  )
}
