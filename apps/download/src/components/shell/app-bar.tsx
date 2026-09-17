import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

import { AccountLink } from 'src/components/shell/account-link'
import { Doorplate } from 'src/components/ui/doorplate'
import type { Viewer } from 'src/lib/viewer'

/** The doorplate is the way back out to the rest of the lilnas apps. */
export const LILNAS_HREF = 'https://lilnas.io'

/** The app this bar belongs to, in mono on the doorplate. */
export const APP_NAME = 'Download'

/**
 * The bar itself. Mobile is `py-2.5 pr-[14px] pl-4` — the right edge is 14px
 * rather than 16px because the account link's hover plate is 2px wider than the
 * mark inside it, so 14px of padding puts the *mark* on the same optical margin
 * as the doorplate on the left. Desktop has no such plate and goes back to a
 * symmetric `px-4`.
 *
 * No `gap-*`: the nav-search slot below owns the spacing on both of its sides,
 * which is the only way to get the mockups' mobile 10px/6px pair and desktop
 * 14px/12px pair out of a single flat row. See `NAV_SEARCH_SLOT_CLASSES`.
 */
const APP_BAR_CLASSES = cns(
  'flex shrink-0 items-center border-b border-line-soft bg-bg-sunk',
  'py-2.5 pr-[14px] pl-4',
  'sm:px-4 sm:py-[11px]',
)

/**
 * The nav-search slot — C2's field mounts here.
 *
 * It is one element rendered once, positioned by CSS at both widths, rather
 * than two slots or two renders of the same node: duplicating the node would
 * duplicate an `<input>`, its label association and its id into the accessible
 * tree, and an assistive-technology user would find two search fields on every
 * screen of the app.
 *
 * `flex-1` makes the slot the row's elastic middle. Its child decides what to
 * do with that space:
 *
 *   - desktop (`sm:justify-start`) the child is `flex-1 max-w-[320px]`, so it
 *     starts 14px after the doorplate and stops at 320px, leaving the slack to
 *     the right of the field;
 *   - mobile (`justify-end`) the child is a 30px `shrink-0` icon button, and
 *     the slack collects to its left, which is what puts the icon next to the
 *     account link exactly as the mockups draw it.
 *
 * The padding is the inter-element spacing: 10px/6px mobile, 14px/12px desktop,
 * matching `mock.pug`'s `gap-2.5`/`gap-1.5` and `gap-[14px]`/`gap-3`. Because
 * the slot's content is edge-aligned, the padding on the far side is invisible
 * — which is also why an empty slot (this task, before C2 lands) renders as
 * plain blank space rather than as a visible spacing bug.
 *
 * ⚠️ Deliberately no `max-w-*` here. The field's own cap is 320px, or 360px
 * once it holds something actionable (`mock.pug`'s `navsearch` mixin), and that
 * is the field's decision to make, not the slot's.
 */
const NAV_SEARCH_SLOT_CLASSES = cns(
  'flex min-w-0 flex-1 items-center justify-end pr-1.5 pl-2.5',
  'sm:justify-start sm:pr-3 sm:pl-[14px]',
)

/** Same spacing story on the other side of the optional back control. */
const BACK_SLOT_CLASSES = cns(
  'flex shrink-0 items-center mr-2.5',
  'sm:mr-[14px]',
)

/** Where the admin dashboard lives. */
export const ADMIN_HREF = '/admin'

/**
 * The admin entry's accessible name, and its visible text at both widths —
 * `admin-dashboard.pug` puts an `admin` chip here on desktop *and* on mobile,
 * so the label does not change with the viewport.
 */
export const ADMIN_LINK_LABEL = 'admin'

/**
 * The admin entry. A `uv`-tinted chip on a real `<a>`, matching the
 * `+chip({ label: 'admin', tone: 'uv' })` both of `admin-dashboard.pug`'s
 * frames draw in this exact slot — the accent is the mockup's, and it reads as
 * "you have a privilege" rather than as a status the machine is reporting.
 *
 * Written out here rather than composed from `Chip`: `Chip` is `'use client'`,
 * and its `interactive` variant is a `<button>` — a chip that navigates is
 * neither of those. The recipe is `Chip`'s `CHIP_BASE` plus its `uv` tone plus
 * a hover, which is the same shape `ButtonLink` has to `Button`.
 */
const ADMIN_LINK_CLASSES = cns(
  'inline-flex h-[23px] shrink-0 items-center gap-1.5 rounded-full border px-2.5',
  'font-mono text-[11px] font-medium tracking-[0.01em] whitespace-nowrap',
  'border-uv/30 bg-uv-ghost text-uv-hi',
  'transition-[border-color,background-color,color] duration-200 ease-uv',
  'hover:border-uv/55 hover:text-ink',
  'mr-2.5 sm:mr-[14px]',
)

export type AppBarProps = Omit<
  ComponentPropsWithoutRef<'header'>,
  'children'
> & {
  /**
   * An optional leading control, rendered before the doorplate. Detail screens
   * put their "Back to library" button here (`mock.pug`'s `navBar` `opts.back`)
   * — a 30px ghost `Button` on mobile, 32px on desktop, holding a mirrored
   * `arrow` icon.
   */
  back?: ReactNode
  /**
   * The nav-search field. Task C2 owns what goes in here; the slot's position
   * and spacing at both widths are settled above, so C2 is a drop-in that never
   * needs to reopen this file.
   */
  navSearch?: ReactNode
  /**
   * The viewer, or `null` when there is no forwarded identity — see
   * `src/lib/viewer.ts`. `null` renders the bar without an account link rather
   * than with a placeholder one, because there is no account to link to.
   *
   * Required rather than optional: "who is looking at this" is a decision the
   * caller has to have made, and defaulting it would quietly hide an
   * un-resolved identity behind an anonymous bar.
   */
  viewer: Viewer | null
}

/**
 * The app's top bar, on every screen: doorplate on the left, nav search in the
 * middle, you on the right.
 *
 * Ported from `docs/features/download/designs/src/mixins/mock.pug`'s `appBar`
 * and `navBar` mixins. `navBar` is written as two branches because the mockups
 * render both viewports side by side on one page; the real app is one document
 * that responds, so the two branches are reconciled here into one row with
 * `sm:` variants. `sm` (640px) is the threshold: the collapse exists only
 * because 390px has no room for the field *and* the doorplate, and 640px
 * comfortably has both.
 *
 * ⚠️ Requires `<IconSprite />` in the document — `Doorplate`'s pepe badge is a
 * `<use href="#pepe">` into it, and without the sprite the badge is blank. The
 * root layout renders the sprite once, before this.
 */
export function AppBar({
  back,
  className,
  navSearch,
  viewer,
  ...props
}: AppBarProps): JSX.Element {
  return (
    <header {...props} className={cns(APP_BAR_CLASSES, className)}>
      {back ? <span className={BACK_SLOT_CLASSES}>{back}</span> : null}
      <Doorplate
        className={cns('shrink-0')}
        href={LILNAS_HREF}
        name={APP_NAME}
      />
      <div className={NAV_SEARCH_SLOT_CLASSES}>{navSearch}</div>
      {/*
        ⚠️ Gated on `isAdmin`, and rendered as *nothing at all* for everybody
        else — not as a disabled or greyed entry. A control a user can see and
        cannot use is an invitation to ask why, and `/admin` answers that
        question with its own `NotAuthorized` panel anyway; a bar that offers
        the link is a bar that says the answer will be yes. `AppBarProps` is
        unchanged: `Viewer` already carries `isAdmin`, so the shell needed no
        new contract to know this.
      */}
      {viewer?.isAdmin ? (
        <a className={ADMIN_LINK_CLASSES} href={ADMIN_HREF}>
          {ADMIN_LINK_LABEL}
        </a>
      ) : null}
      {viewer ? <AccountLink email={viewer.email} /> : null}
    </header>
  )
}
