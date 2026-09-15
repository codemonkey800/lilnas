import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'

/**
 * `Button`'s `ghost`/`sm` appearance, spelled out for an anchor.
 *
 * `home.pug` draws both of this page's outbound affordances — `See full
 * library` and a card's `Watch` — with `+btn({ variant: 'ghost' })`, because a
 * static mockup has nowhere to navigate to. In the real app both are
 * *navigations*: rendering them as `<button>` would cost middle-click,
 * open-in-new-tab, the status-bar preview and the "link" role, and wrapping a
 * `Button` in an `<a>` would nest interactive content, which is invalid HTML.
 *
 * `Button` is not polymorphic (no `as`/`asChild`) and it is a shipped contract
 * several other tasks compose on, so this deliberately does not reopen it. The
 * class list below is `BUTTON_BASE` + `BUTTON_VARIANTS.ghost` +
 * `BUTTON_SIZES.sm` minus the `:disabled`/`aria-disabled` rules, which an
 * anchor cannot be. If a second screen needs the same thing, promote this to
 * `src/components/ui/` as a general `ButtonLink` rather than copying it again.
 */
const GHOST_LINK_CLASS = cns(
  'inline-flex items-center justify-center gap-[7px] rounded-md border',
  'font-[550] tracking-[-0.005em] whitespace-nowrap',
  'transition-press active:scale-96',
  'border-transparent text-ink-3 hover:bg-surface-2 hover:text-ink',
  'h-[30px] px-[11px] text-[13px]',
)

export type GhostLinkProps = ComponentPropsWithoutRef<'a'> & {
  /** Icon rendered before the label, matching `Button`'s `icon`. */
  icon?: IconName
  /** Icon rendered after the label, matching `Button`'s `iconEnd`. */
  iconEnd?: IconName
}

const GHOST_LINK_ICON = 'h-[15px] w-[15px] shrink-0'

/** A link that reads as a quiet button. See {@link GHOST_LINK_CLASS}. */
export function GhostLink({
  children,
  className,
  icon,
  iconEnd,
  ...props
}: GhostLinkProps): JSX.Element {
  return (
    <a {...props} className={cns(GHOST_LINK_CLASS, className)}>
      {icon ? <Icon className={GHOST_LINK_ICON} name={icon} /> : null}
      {children}
      {iconEnd ? <Icon className={GHOST_LINK_ICON} name={iconEnd} /> : null}
    </a>
  )
}
