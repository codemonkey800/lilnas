'use client'

import { AppBar as UiAppBar, type AppBarLink, Button, Sheet } from '@lilnas/ui'
import { usePathname } from 'next/navigation'
import type { JSX, ReactNode } from 'react'

import { AccountLink } from 'src/components/shell/account-link'
import { PROFILE_HREF } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

/** The subdomain the doorplate reads: `download.lilnas.io`. */
export const APP_NAME = 'download'

/** The library: home, the gallery and every detail page. */
export const LIBRARY_NAV_HREF = '/'

/** The jobs feed. */
export const ACTIVITY_NAV_HREF = '/activity'

/** Where the admin dashboard lives. */
export const ADMIN_HREF = '/admin'

/** The admin entry's name. Only a viewer who can open `/admin` sees it. */
export const ADMIN_LINK_LABEL = 'Admin'

type NavSection = 'library' | 'activity' | 'admin'

/** Which primary link a path belongs under; everything else is the library. */
function sectionOf(pathname: string): NavSection {
  if (pathname.startsWith(ACTIVITY_NAV_HREF)) {
    return 'activity'
  }

  if (pathname.startsWith(ADMIN_HREF)) {
    return 'admin'
  }

  return 'library'
}

export type AppBarProps = {
  /**
   * The viewer, or `null` when there is no forwarded identity — see
   * `src/lib/viewer.ts`. `null` renders the bar without an account menu rather
   * than with a placeholder one, because there is no account to open.
   *
   * Required rather than optional: "who is looking at this" is a decision the
   * caller has to have made, and defaulting it would quietly hide an
   * unresolved identity behind an anonymous bar.
   */
  viewer: Viewer | null
  /** The nav field, mounted once at the end of the bar. */
  navSearch?: ReactNode
}

const MENU_LINK =
  'flex h-11 items-center rounded-md px-3 text-body font-medium text-ink-2 hover:bg-surface-2 hover:text-ink aria-[current=page]:text-ink'

/**
 * The app's top bar, on every screen: the `download.lilnas.io` doorplate,
 * Library and Activity (and Admin, for an admin), the nav field, then you.
 *
 * `@lilnas/ui`'s `AppBar` does the frame. Below `md` its links collapse, and
 * the same links — plus the account row, which has no room in the bar — move
 * into a bottom `Sheet` behind the menu button.
 *
 * The doorplate is the package's and links to the app's home (`/`); the
 * Library link goes to the library itself.
 */
export function AppBar({ viewer, navSearch }: AppBarProps): JSX.Element {
  const section = sectionOf(usePathname())

  const links: AppBarLink[] = [
    {
      href: LIBRARY_NAV_HREF,
      label: 'Library',
      active: section === 'library',
    },
    {
      href: ACTIVITY_NAV_HREF,
      label: 'Activity',
      active: section === 'activity',
    },
    // ⚠️ Rendered as nothing at all for everybody else, not as a disabled
    // entry: a control a user can see and cannot use invites the question why,
    // and `/admin` answers it with its own `NotAuthorized` panel anyway.
    ...(viewer?.isAdmin
      ? [
          {
            href: ADMIN_HREF,
            label: ADMIN_LINK_LABEL,
            active: section === 'admin',
          },
        ]
      : []),
  ]

  return (
    <UiAppBar
      app={APP_NAME}
      end={
        <>
          {navSearch}
          {viewer ? (
            <AccountLink className="max-md:hidden" email={viewer.email} />
          ) : null}
        </>
      }
      links={links}
      sheet={
        <Sheet.Root>
          <Sheet.Trigger
            render={
              <Button aria-label="Open menu" icon="menu" variant="ghost" />
            }
          />
          <Sheet.Popup side="bottom">
            <Sheet.Title>Menu</Sheet.Title>
            <nav aria-label="Menu" className="mt-2 flex flex-col">
              {links.map(link => (
                <a
                  aria-current={link.active ? 'page' : undefined}
                  className={MENU_LINK}
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </a>
              ))}
              {viewer ? (
                <a className={MENU_LINK} href={PROFILE_HREF}>
                  Your profile
                </a>
              ) : null}
            </nav>
          </Sheet.Popup>
        </Sheet.Root>
      }
    />
  )
}
