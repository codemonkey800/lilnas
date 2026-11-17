'use client'

import { Avatar, Menu } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { initials } from 'src/lib/format'
import { PROFILE_HREF } from 'src/lib/profile-filters'

export type AccountLinkProps = {
  /**
   * The viewer's email. Initials and the menu's heading are both derived from
   * it, so a call site cannot show one person's initials over another's menu.
   */
  email: string
  className?: string
}

/**
 * "Your account": the viewer's own `Avatar` (accent, because it is you) as a
 * menu trigger. The one row is the way to the profile, which is where the
 * viewer's own requests live.
 */
export function AccountLink({
  email,
  className,
}: AccountLinkProps): JSX.Element {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Your account"
        className={cns(
          'shrink-0 rounded-full outline-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          className,
        )}
        title={`${email} · you`}
      >
        <Avatar initials={initials(email)} self size={32} />
      </Menu.Trigger>
      <Menu.Popup align="end">
        <Menu.Group>
          <Menu.GroupLabel className="font-mono normal-case">
            {email}
          </Menu.GroupLabel>
        </Menu.Group>
        <Menu.Separator />
        <Menu.Item render={<a href={PROFILE_HREF} />}>Your profile</Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  )
}
