import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { Avatar } from 'src/components/ui/avatar'
import { initials } from 'src/lib/format'
import { PROFILE_HREF } from 'src/lib/profile-filters'

/**
 * The hit target. 32px with a hover plate on mobile, because a 24px avatar is
 * below the 44px touch guidance and the plate is what makes the extra area
 * legible; 30px and plateless on desktop, where the avatar itself is the
 * control and carries its own hover treatment.
 *
 * `group` is here so the avatar can react to a hover anywhere in the box. On
 * desktop the two are the same size so it makes no difference, but on mobile
 * the box is larger than the mark inside it.
 */
const ACCOUNT_LINK_CLASSES = cns(
  'group flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-3',
  'transition-colors duration-200 ease-uv hover:bg-surface-2 hover:text-ink',
  'sm:h-[30px] sm:w-[30px] sm:rounded-full sm:hover:bg-transparent',
)

/**
 * 24px/10.5px on mobile (the `Avatar` default) and 30px/11.5px on desktop.
 *
 * The size is spelled out here rather than passed as `size="md"` because the
 * mockups' nav avatar is `h-[30px] w-[30px] text-[11.5px]` and `md` is
 * `text-[12px]` — half a pixel, but the whole point of porting from the built
 * HTML is not to round it off. Both halves are needed anyway, since `size` is a
 * single value and this mark is two sizes at two widths.
 */
const ACCOUNT_AVATAR_CLASSES = cns(
  'transition-[border-color,background-color] duration-200 ease-uv',
  'sm:h-[30px] sm:w-[30px] sm:text-[11.5px]',
  'sm:group-hover:border-uv-dim sm:group-hover:bg-surface-2',
)

export type AccountLinkProps = Omit<
  ComponentPropsWithoutRef<'a'>,
  'children'
> & {
  /**
   * The viewer's email. Initials and the tooltip are both derived from it, so
   * a call site cannot show one person's initials over another's profile link.
   */
  email: string
}

/**
 * "Your account" — the one avatar in the app that is always safe to link,
 * because it is always the viewer's own.
 *
 * An `<a>` rather than a `<button>`: it navigates. Ported from
 * `docs/features/download/designs/src/mixins/mock.pug`'s `accountLink` mixin
 * (mobile) and the `navBar` mixin's linked nav avatar (desktop) — one component
 * covering both, since the real app is one document at every width.
 */
export function AccountLink({
  className,
  email,
  href = PROFILE_HREF,
  ...props
}: AccountLinkProps): JSX.Element {
  return (
    <a
      aria-label="Your account"
      title={`${email} · you`}
      {...props}
      className={cns(ACCOUNT_LINK_CLASSES, className)}
      href={href}
    >
      <Avatar
        className={ACCOUNT_AVATAR_CLASSES}
        initials={initials(email)}
        ring
      />
    </a>
  )
}
