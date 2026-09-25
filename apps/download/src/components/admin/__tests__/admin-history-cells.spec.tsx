import '@testing-library/jest-dom'

import type { DownloadJob } from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import {
  AdminHistoryRequester,
  HIDDEN_ATTRIBUTION_LABEL,
} from 'src/components/admin/admin-history-cells'
import { AUDIT_SERVICE_LABEL } from 'src/lib/admin-audit'
import type { AdminFilters } from 'src/lib/admin-filters'
import { EMPTY_ADMIN_FILTERS } from 'src/lib/admin-filters'
import { profileHrefForEmail } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

/** The only viewer `/admin` ever has — `AdminGuard` turns everyone else away. */
const ADMIN: Viewer = {
  email: 'jeremy@lilnas.io',
  isAdmin: true,
  userId: 'u_jeremy',
}

function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:40:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
    media: {
      id: 'tmdb:438631',
      title: 'Salt & Ceremony',
      tmdbId: 438631,
      type: DownloadType.Movie,
    },
    requester: { email: 'sam@lilnas.io', userId: 'u_sam' },
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:41:00.000Z',
    ...overrides,
  }
}

/** The primary target: this same page, scoped to one requester. */
function filterLink(email: string): HTMLElement | null {
  return screen.queryByRole('link', { name: email })
}

/** The secondary target: that person's profile, by its accessible name. */
function profileLink(email: string): HTMLElement | null {
  return screen.queryByRole('link', { name: `Open ${email}’s profile` })
}

describe('AdminHistoryRequester', () => {
  describe('the requester filter', () => {
    it('points the name at this page scoped to that requester', () => {
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job()}
          viewer={ADMIN}
        />,
      )

      expect(filterLink('sam@lilnas.io')).toHaveAttribute(
        'href',
        '/admin?requester=sam%40lilnas.io',
      )
    })

    it('extends the filter the page is already at rather than replacing it', () => {
      const filters: AdminFilters = {
        ...EMPTY_ADMIN_FILTERS,
        types: [DownloadType.Movie],
      }

      render(
        <AdminHistoryRequester filters={filters} job={job()} viewer={ADMIN} />,
      )

      const href = filterLink('sam@lilnas.io')?.getAttribute('href') ?? ''
      expect(href).toContain('requester=sam%40lilnas.io')
      expect(href).toContain(`type=${DownloadType.Movie}`)
    })

    it('drops the link once the table is already scoped to that requester', () => {
      const filters: AdminFilters = {
        ...EMPTY_ADMIN_FILTERS,
        requester: 'sam@lilnas.io',
      }

      render(
        <AdminHistoryRequester filters={filters} job={job()} viewer={ADMIN} />,
      )

      // The name is still there; it just has nowhere new to go.
      expect(screen.getByText('sam@lilnas.io')).toBeInTheDocument()
      expect(filterLink('sam@lilnas.io')).toBeNull()
    })
  })

  describe('the service', () => {
    // ⚠️ On `/admin` a null requester is the *service*, not a masked person:
    // `AdminGuard` is what makes true attribution safe here, so nothing was
    // ever masked. Rendering `ActivityRequester`'s "hidden" would put a person
    // behind an action no person took.
    it('names a null requester as the service, never as a hidden person', () => {
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job({ requester: null })}
          viewer={ADMIN}
        />,
      )

      expect(screen.getByText(AUDIT_SERVICE_LABEL)).toBeInTheDocument()
      expect(screen.queryByText('hidden')).not.toBeInTheDocument()
    })

    it('offers a service row no link of any kind', () => {
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job({ requester: null })}
          viewer={ADMIN}
        />,
      )

      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })

    // A download the poller adopted from Radarr or Sonarr is the service too,
    // but a named one — `service` would hide which of them started it.
    it.each([
      [
        'Radarr',
        {
          id: 'tmdb:438631',
          title: 'Salt & Ceremony',
          tmdbId: 438631,
          type: DownloadType.Movie,
        },
      ],
      [
        'Sonarr',
        {
          id: 'tvdb:81189',
          title: 'Tidewater',
          tvdbId: 81189,
          type: DownloadType.Show,
        },
      ],
    ] as const)('names an adopted download after %s', (label, media) => {
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job({ media, requester: null, startedUpstream: true })}
          viewer={ADMIN}
        />,
      )

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(screen.queryByText(AUDIT_SERVICE_LABEL)).not.toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    })
  })

  describe('the hidden-attribution marker', () => {
    // It marks the *privilege*, not the person: the row is one everybody else
    // sees masked, which is exactly why it sits beside a fully-named requester.
    it('marks a row only an admin can attribute, beside the name it names', () => {
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job({ hiddenAttribution: true })}
          viewer={ADMIN}
        />,
      )

      expect(
        screen.getByRole('img', { name: HIDDEN_ATTRIBUTION_LABEL }),
      ).toBeInTheDocument()
      expect(screen.getByText('sam@lilnas.io')).toBeInTheDocument()
    })

    it('leaves an ordinarily-attributed row unmarked', () => {
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job()}
          viewer={ADMIN}
        />,
      )

      expect(
        screen.queryByRole('img', { name: HIDDEN_ATTRIBUTION_LABEL }),
      ).toBeNull()
    })
  })

  describe('the access rule', () => {
    it('offers an admin the other user’s profile beside the filter link', () => {
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job()}
          viewer={ADMIN}
        />,
      )

      expect(profileLink('sam@lilnas.io')).toHaveAttribute(
        'href',
        profileHrefForEmail('sam@lilnas.io'),
      )
    })

    // The cell gates that secondary affordance on `requesterProfileHref`
    // rather than on this page's own guard, so the rule holds even for a
    // viewer `AdminGuard` would never have let in.
    it('withholds another user’s profile from a non-admin viewer', () => {
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job()}
          viewer={{ ...ADMIN, isAdmin: false }}
        />,
      )

      expect(profileLink('sam@lilnas.io')).toBeNull()
    })

    it('withholds a profile entirely when nobody is signed in', () => {
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job()}
          viewer={null}
        />,
      )

      expect(profileLink('sam@lilnas.io')).toBeNull()
    })
  })

  describe('the stacked mobile row', () => {
    it('keeps the mark but drops the name and the profile glyph', () => {
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job({ hiddenAttribution: true })}
          nameless
          viewer={ADMIN}
        />,
      )

      expect(screen.queryByText('sam@lilnas.io')).toBeNull()
      expect(profileLink('sam@lilnas.io')).toBeNull()
      // The avatar still carries the identity, and the marker still marks.
      expect(screen.getByTitle('sam@lilnas.io')).toBeInTheDocument()
      expect(
        screen.getByRole('img', { name: HIDDEN_ATTRIBUTION_LABEL }),
      ).toBeInTheDocument()
    })
  })
})
