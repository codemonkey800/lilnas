import '@testing-library/jest-dom'

import type {
  DiscordIdentity,
  DiscordRequester,
  JobRequester,
} from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import { AdminActor } from 'src/components/admin/admin-actor'
import { AUDIT_SERVICE_LABEL } from 'src/lib/admin-audit'
import { PROFILE_HREF, profileHrefForEmail } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

const JEREMY: JobRequester = { email: 'jeremy@lilnas.io', userId: 'u_jeremy' }
const SAM: JobRequester = { email: 'sam@lilnas.io', userId: 'u_sam' }

/** A real snowflake, as a **string literal** — 18 digits do not fit a number. */
const SNOWFLAKE = '273145016936267776'

const DISCORD_SAM: DiscordRequester = {
  discordUserId: SNOWFLAKE,
  discordUsername: 'sam.pham',
}

const LINKED_JEREMY: DiscordIdentity = {
  discordUserId: '583920174659201024',
  discordUsername: 'jeremy.a',
}

/** E5's disclosure trigger, by the accessible name it announces. */
function discordMark(): HTMLElement | null {
  return screen.queryByRole('button', { name: /Discord account details/ })
}

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

  /**
   * ⚠️ The hazard this page owns: **a null actor now has two readings.** The
   * service chip and an unlinked Discord person both arrive with
   * `actor === null`, and only `discordActor` tells them apart. Getting it
   * wrong attributes a person's download to a machine — the mirror image of
   * `ActivityRequester`'s masked/unlinked pair, and wrong in the other
   * direction.
   */
  describe('Discord attribution', () => {
    it('leaves the service chip exactly as it was', () => {
      render(<AdminActor actor={null} discordActor={null} viewer={ADMIN} />)

      expect(screen.getByText(AUDIT_SERVICE_LABEL)).toBeInTheDocument()
      expect(discordMark()).not.toBeInTheDocument()
      expect(document.body).not.toHaveTextContent(SNOWFLAKE)
    })

    it('renders an unlinked Discord actor as a person, not as the service', () => {
      render(
        <AdminActor actor={null} discordActor={DISCORD_SAM} viewer={ADMIN} />,
      )

      expect(screen.getByText(DISCORD_SAM.discordUsername)).toBeInTheDocument()
      expect(discordMark()).toBeInTheDocument()
      // The whole point: a person did this, so the machine's chip is wrong.
      expect(screen.queryByText(AUDIT_SERVICE_LABEL)).not.toBeInTheDocument()
    })

    // Both of this page's targets are email-keyed — `?requester=` filters on an
    // email, `requesterProfileHref` resolves one — and a raw snowflake is
    // neither, so it gets the mark and no doors.
    it('gives an unlinked Discord actor no filter link and no profile link', () => {
      render(
        <AdminActor
          actor={null}
          discordActor={DISCORD_SAM}
          href={FILTER_HREF}
          viewer={ADMIN}
        />,
      )

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    it('keeps the mark on the nameless mobile row', () => {
      render(
        <AdminActor
          actor={null}
          discordActor={DISCORD_SAM}
          nameless
          viewer={ADMIN}
        />,
      )

      expect(
        screen.queryByText(DISCORD_SAM.discordUsername),
      ).not.toBeInTheDocument()
      expect(discordMark()).toBeInTheDocument()
    })

    it('shows a linked handle beside the email with no popover on it', () => {
      render(
        <AdminActor
          actor={JEREMY}
          linkedDiscord={LINKED_JEREMY}
          viewer={ADMIN}
        />,
      )

      expect(screen.getByText(JEREMY.email)).toBeInTheDocument()
      expect(
        screen.getByText(`@${LINKED_JEREMY.discordUsername}`),
      ).toBeInTheDocument()
      expect(discordMark()).not.toBeInTheDocument()
      expect(screen.queryAllByRole('button')).toHaveLength(0)
      expect(document.body).not.toHaveTextContent(LINKED_JEREMY.discordUserId)
    })

    it('drops the linked handle from the nameless mobile row', () => {
      render(
        <AdminActor
          actor={JEREMY}
          linkedDiscord={LINKED_JEREMY}
          nameless
          viewer={ADMIN}
        />,
      )

      expect(
        screen.queryByText(`@${LINKED_JEREMY.discordUsername}`),
      ).not.toBeInTheDocument()
    })

    it('renders a plain web actor with no Discord furniture at all', () => {
      render(
        <AdminActor
          actor={SAM}
          discordActor={null}
          href={FILTER_HREF}
          linkedDiscord={null}
          viewer={ADMIN}
        />,
      )

      expect(screen.getByRole('link', { name: SAM.email })).toBeInTheDocument()
      expect(discordMark()).not.toBeInTheDocument()
    })
  })
})
