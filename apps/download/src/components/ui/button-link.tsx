'use client'

import type { ComponentPropsWithoutRef, JSX } from 'react'

import type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'
import {
  BUTTON_ICON,
  buttonRecipeClassName,
} from 'src/components/ui/button-recipe'
import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'

export type ButtonLinkProps = ComponentPropsWithoutRef<'a'> & {
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
 * `Button`'s recipe on a real `<a>`, for a control that navigates rather than
 * acts — an external deep link (Emby's `watchUrl`) or an in-app route. A
 * `<button>` with an `onClick` gives none of middle-click, ⌘-click, "copy link
 * address" or the anchor's own accessible role; wrapping a `Button` in an
 * `<a>` nests interactive content, which is invalid HTML. `Button` is
 * `ComponentPropsWithoutRef<'button'>` and cannot render either, so this is
 * the polymorphic half `Button` deliberately doesn't grow an `as`/`asChild`
 * for.
 *
 * `target`/`rel` are left to the call site rather than defaulted here: they
 * describe the *navigation*, not the *look*, and the two calls this replaces
 * already disagree on them (an in-app "See full library" link has no reason
 * to open a new tab; an external Emby link does) — an ambient default would
 * either break the in-app case or silently paper over that call sites forgot
 * `rel="noreferrer"` on an external one.
 *
 * `aria-disabled` is supported, not omitted: it drops `href` (the accessible
 * pattern — a hrefless anchor is neither a link nor focusable, so nothing
 * else has to be done to pull it out of the tab order) and swallows `onClick`,
 * mirroring `Button`'s own two-way contract. The paint comes for free from
 * `BUTTON_BASE`'s `aria-disabled:` rules, which are attribute-selector based
 * and so apply to an anchor exactly as they do to a button.
 */
export function ButtonLink({
  variant,
  size,
  icon,
  iconEnd,
  full = false,
  className,
  children,
  href,
  onClick,
  ...props
}: ButtonLinkProps): JSX.Element {
  // `aria-disabled` arrives as boolean `true` or the string `"true"`
  // depending on the call site; both mean disabled, `"false"` does not.
  const ariaDisabled = props['aria-disabled']
  const inert = ariaDisabled === true || ariaDisabled === 'true'

  return (
    <a
      {...props}
      className={buttonRecipeClassName({ variant, size, full, className })}
      href={inert ? undefined : href}
      onClick={inert ? undefined : onClick}
    >
      {icon ? <Icon className={BUTTON_ICON} name={icon} /> : null}
      {children}
      {iconEnd ? <Icon className={BUTTON_ICON} name={iconEnd} /> : null}
    </a>
  )
}
