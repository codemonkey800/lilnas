import '@testing-library/jest-dom'

import type {
  DownloadJob,
  GalleryItem,
  JobRequester,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import { ActivityList } from 'src/components/activity/activity-list'
import { ActivityTable } from 'src/components/activity/activity-table'
import { AdminHistoryRequester } from 'src/components/admin/admin-history-cells'
import { GalleryItemCard } from 'src/components/gallery/gallery-item-card'
import { RecentCard } from 'src/components/home/recent-card'
import { MASKED_INITIALS } from 'src/components/ui/avatar'
import { EMPTY_ADMIN_FILTERS } from 'src/lib/admin-filters'
import { PROFILE_HREF, profileHrefForEmail } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

/**
 * The access rule, asserted across every surface that renders a requester at
 * once.
 *
 * Each surface already has its own spec, and those stay the place a surface's
 * own behaviour is pinned. What none of them can assert is the **invariant**:
 * that no surface, anywhere, hands a viewer a door into an identity the
 * backend would refuse them. A rule with one definition and five call sites
 * fails by one call site quietly stopping to consult it, and a per-surface
 * suite passes right through that — the surface that drifted is the one whose
 * spec was never updated.
 *
 * So this file deliberately asserts the same thing five times over, by
 * rendering real surfaces rather than by re-testing
 * `canViewRequesterProfile`. Its value is the enumeration: adding a sixth
 * surface without adding it here is the failure this guards against, and the
 * list below is the place that omission is visible.
 *
 * ⚠️ **Two different `null`s live in these types**, and conflating them is a
 * mistake this codebase has already made once. On the activity, gallery and
 * home surfaces a `null` requester means **masked** — `projectJobForViewer`
 * stripped an identity the viewer is not entitled to. On `/admin` it means the
 * **service**: an action no person took, on a page where masking never
 * happens. `MASKING_SURFACES` below is therefore the four masking surfaces
 * only, and pointedly not the admin row, whose `null` is covered by
 * `admin/__tests__/admin-history-cells.spec.tsx` as the service instead.
 */

const NOW = Date.parse('2026-09-15T12:00:00.000Z')

/** Somebody else. Every assertion here is about a viewer seeing *this* person. */
const SAM: JobRequester = { email: 'sam@lilnas.io', userId: 'u_sam' }

/** A regular signed-in user, who is not Sam. */
const VIEWER: Viewer = {
  email: 'jeremy@lilnas.io',
  isAdmin: false,
  userId: 'u_jeremy',
}

const ADMIN: Viewer = { ...VIEWER, isAdmin: true }

function job(requester: JobRequester | null): DownloadJob {
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
    requester,
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:41:00.000Z',
  }
}

function item(requester: JobRequester | null): GalleryItem {
  return {
    addedAt: '2026-09-15T11:48:00.000Z',
    downloadCount: 1,
    lastDiscordRequester: null,
    lastDownloadedAt: '2026-09-15T11:48:00.000Z',
    lastRequester: requester,
    media: {
      id: 'tmdb:438631',
      title: 'Salt & Ceremony',
      tmdbId: 438631,
      type: DownloadType.Movie,
      year: 2026,
    },
  }
}

/**
 * One surface that puts somebody's identity on screen.
 *
 * ⚠️ Explicitly typed rather than inferred from a `jest.fn()`. A `jest.fn()`
 * is `any`-shaped and satisfies any signature, which is how a real type
 * collision hid in this repo for two waves — a fixture that accepts anything
 * proves nothing about what the component actually demands.
 */
type Surface = {
  name: string
  /** Renders the surface attributing its row to `requester`, as `viewer`. */
  render: (requester: JobRequester | null, viewer: Viewer | null) => HTMLElement
}

const ATTRIBUTION_SURFACES: readonly Surface[] = [
  {
    name: 'the activity table',
    render: (requester, viewer) =>
      render(
        <ActivityTable
          now={NOW}
          rows={[{ departing: false, job: job(requester) }]}
          viewer={viewer}
        />,
      ).container,
  },
  {
    name: 'the activity list',
    render: (requester, viewer) =>
      render(
        <ActivityList
          now={NOW}
          rows={[{ departing: false, job: job(requester) }]}
          viewer={viewer}
        />,
      ).container,
  },
  {
    name: 'the gallery card',
    render: (requester, viewer) =>
      render(
        <GalleryItemCard item={item(requester)} now={NOW} viewer={viewer} />,
      ).container,
  },
  {
    name: 'the home card',
    render: (requester, viewer) =>
      render(<RecentCard item={item(requester)} now={NOW} viewer={viewer} />)
        .container,
  },
  {
    name: 'the admin history row',
    render: (requester, viewer) =>
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job(requester)}
          viewer={viewer}
        />,
      ).container,
  },
]

/**
 * The surfaces on which a `null` requester means *masked*.
 *
 * The admin history row is absent on purpose — see the `null` warning above.
 */
const MASKING_SURFACES: readonly Surface[] = ATTRIBUTION_SURFACES.filter(
  surface => surface.name !== 'the admin history row',
)

/** Every href the rendered surface offers, in document order. */
function hrefsIn(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('a[href]')).map(
    anchor => anchor.getAttribute('href') ?? '',
  )
}

/** Whether an href lands on `/profile` — bare, or scoped with `?user=`. */
function isProfileHref(href: string): boolean {
  return href === PROFILE_HREF || href.startsWith(`${PROFILE_HREF}?`)
}

describe('the requester access rule, across every surface that renders one', () => {
  describe.each(ATTRIBUTION_SURFACES)('$name', ({ render: renderSurface }) => {
    // The headline. A regular viewer looking at a row that carries somebody
    // else's identity must be offered no way into it — not a disabled one, not
    // an unlabelled avatar link, none. `requesterProfileHref` is the app's only
    // spelling of that rule, and this asserts the rendered consequence of it
    // rather than the function, so a surface that stops calling it fails here.
    it('offers a regular viewer no door into another user’s profile', () => {
      const container = renderSurface(SAM, VIEWER)

      expect(hrefsIn(container).filter(isProfileHref)).toEqual([])
    })

    it('offers no profile door at all when nobody is signed in', () => {
      const container = renderSurface(SAM, null)

      expect(hrefsIn(container).filter(isProfileHref)).toEqual([])
    })

    // The rule is a gate, not a wall: an admin is exactly who may inspect
    // somebody else. Asserted alongside the refusals so a surface cannot pass
    // this file by rendering no attribution links whatsoever.
    it('does let an admin through to that user’s profile', () => {
      const container = renderSurface(SAM, ADMIN)

      expect(hrefsIn(container).filter(isProfileHref)).toContain(
        profileHrefForEmail(SAM.email),
      )
    })

    it('sends a viewer to their own bare profile route, never through ?user=', () => {
      const container = renderSurface(
        { email: VIEWER.email, userId: VIEWER.userId },
        VIEWER,
      )
      const profileHrefs = hrefsIn(container).filter(isProfileHref)

      // A surface may offer more than one door to the same place — the desktop
      // activity row links the avatar *and* the name — so this asserts where
      // they all go rather than how many there are.
      expect(profileHrefs).not.toEqual([])
      // `/profile` resolves server-side to whoever is asking. Handing someone
      // their own `?user=` would put an identity in the address bar that the
      // route never needs, and that a shared URL would then carry.
      expect(profileHrefs.filter(href => href !== PROFILE_HREF)).toEqual([])
    })
  })

  describe.each(MASKING_SURFACES)(
    '$name, masked',
    ({ render: renderSurface }) => {
      it('renders a masked attribution entirely inert', () => {
        const container = renderSurface(null, VIEWER)

        expect(hrefsIn(container).filter(isProfileHref)).toEqual([])
        expect(screen.queryByText(SAM.email)).toBeNull()
      })

      // The mask is not a permission check that an admin passes — there is no
      // identity behind it to send anyone to. `projectJobForViewer` already
      // decided; this is not the surface that reverses that.
      it('stays inert for an admin too, and leaks no initials', () => {
        const container = renderSurface(null, ADMIN)

        expect(hrefsIn(container).filter(isProfileHref)).toEqual([])
        expect(screen.getAllByText(MASKED_INITIALS).length).toBeGreaterThan(0)
      })
    },
  )
})
