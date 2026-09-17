import '@testing-library/jest-dom'

import type { JobRequester } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import { AdminActor } from 'src/components/admin/admin-actor'
import { AUDIT_SERVICE_LABEL } from 'src/lib/admin-audit'
import { PROFILE_HREF, profileHrefForEmail } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

const JEREMY: JobRequester = { email: 'jeremy@lilnas.io', userId: 'u_jeremy' }
const SAM: JobRequester = { email: 'sam@lilnas.io', userId: 'u_sam' }

/** The only viewer `/admin` ever has — `AdminGuard` turns everyone else away. */
const ADMIN: Viewer = {
  email: 'jeremy@lilnas.io',
  isAdmin: true,
  userId: 'u_jeremy',
}

const FILTER_HREF = '/admin?requester=sam%40lilnas.io'

/** The secondary profile link, by the accessible name it announces. */
function profileLink(email: string): HTMLElement | null {
  return screen.queryByRole('link', { name: `Open ${email}’s profile` })
}

describe('AdminActor', () => {
  describe('the service', () => {
    it('names a null actor as the service rather than as a hidden person', () => {
      render(<AdminActor actor={null} viewer={ADMIN} />)

      expect(screen.getByText(AUDIT_SERVICE_LABEL)).toBeInTheDocument()
      // Never `ActivityRequester`'s masked wording — no person acted here.
      expect(screen.queryByText('hidden')).not.toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    // The whole hazard this component exists for: `requesterProfileHref` reads
    // a null as *masked*, and a masked identity has a profile behind it that
    // this page must never offer. The service has no identity at all.
    it('offers a service row neither a filter link nor a profile link', () => {
      render(<AdminActor actor={null} href={FILTER_HREF} viewer={ADMIN} />)

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })

  describe('a person', () => {
    it('keeps the requester filter as the primary target', () => {
      render(<AdminActor actor={SAM} href={FILTER_HREF} viewer={ADMIN} />)

      expect(screen.getByRole('link', { name: SAM.email })).toHaveAttribute(
        'href',
        FILTER_HREF,
      )
    })

    it('offers somebody else’s profile beside the name, at their ?user=', () => {
      render(<AdminActor actor={SAM} href={FILTER_HREF} viewer={ADMIN} />)

      expect(profileLink(SAM.email)).toHaveAttribute(
        'href',
        profileHrefForEmail(SAM.email),
      )
    })

    it('sends the admin’s own row to the bare profile route', () => {
      render(<AdminActor actor={JEREMY} viewer={ADMIN} />)

      expect(profileLink(JEREMY.email)).toHaveAttribute('href', PROFILE_HREF)
    })

    // The gate is the point of the import: `/admin` asks the app's one access
    // rule rather than assuming its own viewer is always entitled.
    it('withholds the profile link from a viewer the access rule refuses', () => {
      render(
        <AdminActor
          actor={SAM}
          href={FILTER_HREF}
          viewer={{ ...ADMIN, isAdmin: false }}
        />,
      )

      expect(profileLink(SAM.email)).not.toBeInTheDocument()
      // The filter link is untouched — the two targets are independent.
      expect(screen.getByRole('link', { name: SAM.email })).toHaveAttribute(
        'href',
        FILTER_HREF,
      )
    })

    it('withholds the profile link when nobody is signed in', () => {
      render(<AdminActor actor={SAM} href={FILTER_HREF} viewer={null} />)

      expect(profileLink(SAM.email)).not.toBeInTheDocument()
    })

    it('drops the profile link from the nameless mobile row', () => {
      render(
        <AdminActor actor={SAM} href={FILTER_HREF} nameless viewer={ADMIN} />,
      )

      expect(profileLink(SAM.email)).not.toBeInTheDocument()
      // The avatar still carries the filter link, so the row is not inert.
      expect(screen.getAllByRole('link')).toHaveLength(1)
    })

    it('rings the viewer’s own mark and says so in the tooltip', () => {
      const { container } = render(<AdminActor actor={JEREMY} viewer={ADMIN} />)
      const avatar = container.querySelector('.rounded-full')

      expect(avatar).toHaveAttribute('title', `${JEREMY.email} · you`)
    })
  })
})
