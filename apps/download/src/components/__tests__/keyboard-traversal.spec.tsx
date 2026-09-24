import '@testing-library/jest-dom'

import type {
  DownloadJob,
  GalleryItem,
  JobRequester,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ActivityList } from 'src/components/activity/activity-list'
import { ActivityTable } from 'src/components/activity/activity-table'
import { AdminActor } from 'src/components/admin/admin-actor'
import { AdminHistoryRequester } from 'src/components/admin/admin-history-cells'
import { GalleryItemCard } from 'src/components/gallery/gallery-item-card'
import { RecentCard } from 'src/components/home/recent-card'
import { Avatar } from 'src/components/ui/avatar'
import { Button } from 'src/components/ui/button'
import { ButtonLink } from 'src/components/ui/button-link'
import { Chip } from 'src/components/ui/chip'
import { MChip } from 'src/components/ui/mchip'
import { ToggleChip } from 'src/components/ui/toggle-chip'
import { EMPTY_ADMIN_FILTERS } from 'src/lib/admin-filters'
import type { Viewer } from 'src/lib/viewer'

/**
 * Keyboard traversal, asserted as an invariant across surfaces rather than
 * per component.
 *
 * Modelled on `requester-access.spec.tsx`, and for the same reason: every
 * surface here already has its own spec, and not one of them can catch the
 * failure this file exists for. "Is every control reachable without a mouse"
 * is not a property of any one component — it is a property of the *choices*
 * made independently at forty call sites, and it breaks when one of them
 * quietly picks the wrong element.
 *
 * ⚠️ **Focus *visibility* is deliberately absent from this file.**
 * `:focus-visible` is defined in `tailwind.css`, and jsdom has no real
 * stylesheet and computes no styles from one — an assertion about a focus ring
 * here would pass regardless of whether the ring exists, which is worse than
 * no assertion. It belongs to the browser pass.
 */

const NOW = Date.parse('2026-09-15T12:00:00.000Z')

const SAM: JobRequester = { email: 'sam@lilnas.io', userId: 'u_sam' }

const ADMIN: Viewer = {
  email: 'jeremy@lilnas.io',
  isAdmin: true,
  userId: 'u_jeremy',
}

function job(): DownloadJob {
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
    requester: SAM,
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:41:00.000Z',
  }
}

function item(): GalleryItem {
  return {
    addedAt: '2026-09-15T11:48:00.000Z',
    downloadCount: 1,
    lastDiscordRequester: null,
    lastDownloadedAt: '2026-09-15T11:48:00.000Z',
    lastRequester: SAM,
    media: {
      id: 'tmdb:438631',
      title: 'Salt & Ceremony',
      tmdbId: 438631,
      type: DownloadType.Movie,
      year: 2026,
    },
  }
}

type Surface = {
  name: string
  render: () => HTMLElement
}

const SURFACES: readonly Surface[] = [
  {
    name: 'the activity table',
    render: () =>
      render(
        <ActivityTable
          now={NOW}
          rows={[{ departing: false, job: job() }]}
          viewer={ADMIN}
        />,
      ).container,
  },
  {
    name: 'the activity list',
    render: () =>
      render(
        <ActivityList
          now={NOW}
          rows={[{ departing: false, job: job() }]}
          viewer={ADMIN}
        />,
      ).container,
  },
  {
    name: 'the gallery card',
    render: () =>
      render(<GalleryItemCard item={item()} now={NOW} viewer={ADMIN} />)
        .container,
  },
  {
    name: 'the home card',
    render: () =>
      render(<RecentCard item={item()} now={NOW} viewer={ADMIN} />).container,
  },
  {
    name: 'the admin history requester cell',
    render: () =>
      render(
        <AdminHistoryRequester
          filters={EMPTY_ADMIN_FILTERS}
          job={job()}
          viewer={ADMIN}
        />,
      ).container,
  },
]

/**
 * Containers whose members hold a *roving* tab stop: the container is the one
 * tab stop and its members sit at `tabindex="-1"` on purpose, reached with
 * arrows instead. They are keyboard-operable, so the reachability sweep below
 * has to skip their members or it would report the pattern itself as a bug.
 */
const ROVING_CONTAINERS =
  '[role="listbox"],[role="radiogroup"],[role="tablist"],[role="menu"]'

/** A readable identifier for a control that failed a sweep. */
function describeControl(element: Element): string {
  const name =
    element.getAttribute('aria-label') ?? element.textContent?.trim() ?? ''

  return `<${element.tagName.toLowerCase()}> ${name}`.trim()
}

/**
 * Controls that announce themselves as activatable but cannot be reached from
 * the keyboard — the mouse-only control, which is what a `<div onClick>` in
 * place of a `<button>` produces.
 */
function mouseOnlyControls(container: HTMLElement): string[] {
  const suspects = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button,a,input,select,textarea,[role="button"],[role="link"]',
    ),
  )

  return suspects
    .filter(element => {
      // Deliberately out of the tab order, and announced as such.
      if (
        element.hasAttribute('disabled') ||
        element.getAttribute('aria-disabled') === 'true'
      ) {
        return false
      }

      // An anchor with no `href` is not a link and announces as nothing — it
      // is how `ButtonLink` implements its own disabled state.
      if (element.tagName === 'A' && !element.hasAttribute('href')) {
        return false
      }

      if (element.closest(ROVING_CONTAINERS)) {
        return false
      }

      return element.tabIndex < 0
    })
    .map(describeControl)
}

/** Every explicit `tabindex` in the tree, as a number. */
function tabIndexValues(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('[tabindex]')).map(element =>
    Number(element.getAttribute('tabindex')),
  )
}

/**
 * The sweep's own teeth.
 *
 * Every assertion in this file is of the form "this list is empty", and a
 * detector that has quietly stopped detecting produces exactly that result on
 * every surface forever. So the detector is pointed at controls that are known
 * to be wrong, and required to find them.
 */
describe('the reachability sweep detects what it claims to', () => {
  function markup(html: string): HTMLElement {
    const host = document.createElement('div')

    host.innerHTML = html

    return host
  }

  it('catches a div wearing a button role with no way in', () => {
    expect(
      mouseOnlyControls(markup('<div role="button">Delete</div>')),
    ).toEqual(['<div> Delete'])
  })

  it('catches a control pulled out of the tab order by hand', () => {
    expect(
      mouseOnlyControls(markup('<button tabindex="-1">Go</button>')),
    ).toEqual(['<button> Go'])
  })

  it('spares a disabled control, which is meant to be unreachable', () => {
    expect(mouseOnlyControls(markup('<button disabled>Go</button>'))).toEqual(
      [],
    )
    expect(
      mouseOnlyControls(
        markup('<div role="button" aria-disabled="true">Go</div>'),
      ),
    ).toEqual([])
  })

  it('spares a roving group member, whose container is the tab stop', () => {
    expect(
      mouseOnlyControls(
        markup(
          '<div role="listbox"><button role="option" tabindex="-1">A</button></div>',
        ),
      ),
    ).toEqual([])
  })

  it('notices a positive tabIndex, which no surface may carry', () => {
    expect(tabIndexValues(markup('<button tabindex="3">Go</button>'))).toEqual([
      3,
    ])
  })
})

describe('every surface is traversable by keyboard', () => {
  it.each(SURFACES.map(surface => [surface.name, surface] as const))(
    '%s hands the keyboard every control it hands the mouse',
    (_name, surface) => {
      expect(mouseOnlyControls(surface.render())).toEqual([])
    },
  )

  it.each(SURFACES.map(surface => [surface.name, surface] as const))(
    '%s carries no positive tabIndex',
    (_name, surface) => {
      // A positive `tabindex` pulls its element ahead of the entire document
      // order, so one of them anywhere reorders the whole page for everyone
      // arriving by keyboard. There is no legitimate use in this app; the only
      // values that should ever appear are 0 and -1.
      const values = tabIndexValues(surface.render())

      expect(values.filter(value => value > 0)).toEqual([])
      expect(values.every(value => value === 0 || value === -1)).toBe(true)
    },
  )
})

/**
 * The trap this sweep exists for.
 *
 * Several components render a link-shaped control beside a button-shaped one
 * and the two look identical once the classes land. They are not
 * interchangeable: a control that *navigates* has to be an `<a href>` so it
 * can be opened in a new tab, copied, previewed on the status bar and followed
 * by Enter; a control that *activates* has to be a `<button>` so it responds
 * to Space and is not announced as a destination. The failure is invisible on
 * screen and total for anyone not using a mouse.
 */
describe('navigating controls are links, activating controls are buttons', () => {
  it('ButtonLink is a real anchor with a real href', () => {
    render(<ButtonLink href="/gallery">Gallery</ButtonLink>)

    const link = screen.getByRole('link', { name: 'Gallery' })

    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/gallery')
    expect(link.tabIndex).toBeGreaterThanOrEqual(0)
  })

  it('a disabled ButtonLink drops the href rather than faking it', () => {
    render(
      <ButtonLink aria-disabled href="/gallery">
        Gallery
      </ButtonLink>,
    )

    // A hrefless anchor is neither a link nor focusable, so nothing else has
    // to be done to pull it out of the tab order.
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('Button is a real button, and never an anchor', () => {
    render(<Button onClick={jest.fn()}>Retry</Button>)

    const button = screen.getByRole('button', { name: 'Retry' })

    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('an interactive Chip is a button carrying its own pressed state', () => {
    render(<Chip interactive active label="Movies" onClick={jest.fn()} />)

    const chip = screen.getByRole('button', { name: 'Movies' })

    expect(chip.tagName).toBe('BUTTON')
    expect(chip).toHaveAttribute('aria-pressed', 'true')
  })

  it('a static Chip is inert markup, not a control with no keyboard', () => {
    const { container } = render(<Chip label="Movies" />)

    // The honest half of the rule: a chip that does nothing must not *look*
    // like a control to assistive tech either. Silence beats a button that
    // does nothing when you press it.
    expect(container.querySelector('span')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(mouseOnlyControls(container)).toEqual([])
  })

  it('a ToggleChip toggles through a real checkbox, not a styled div', () => {
    render(
      <ToggleChip
        checked={false}
        label="Video"
        value="video"
        onCheckedChange={jest.fn()}
      />,
    )

    const box = screen.getByRole('checkbox', { name: 'Video' })

    expect(box.tagName).toBe('INPUT')
    expect(box.tabIndex).toBeGreaterThanOrEqual(0)
  })

  it('a ToggleChip is operable from the keyboard alone', async () => {
    const user = userEvent.setup()
    const onCheckedChange = jest.fn()

    render(
      <ToggleChip
        checked={false}
        label="Video"
        value="video"
        onCheckedChange={onCheckedChange}
      />,
    )

    await user.tab()

    expect(screen.getByRole('checkbox', { name: 'Video' })).toHaveFocus()

    await user.keyboard(' ')

    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('an MChip is metadata, and claims no interactive role', () => {
    const { container } = render(<MChip icon="layers" label="1080p" />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
    expect(mouseOnlyControls(container)).toEqual([])
  })

  it('an Avatar is a link only when it has somewhere to go', () => {
    const { container: linked } = render(
      <Avatar href="/profile" initials="SA" />,
    )

    expect(linked.querySelector('a')).toHaveAttribute('href', '/profile')

    const { container: plain } = render(<Avatar initials="SA" />)

    expect(plain.querySelector('a')).toBeNull()
    expect(mouseOnlyControls(plain)).toEqual([])
  })
})

/**
 * `AdminActor` is the sharpest instance of the trap: it renders up to three
 * controls in one cell — an avatar, the email, and a small glyph — and two of
 * them go to *different* places. Getting any of them wrong produces a cell
 * that looks right and strands a keyboard user on the row.
 */
describe('AdminActor renders every one of its three targets as a link', () => {
  const FILTER_HREF = '/admin?requester=sam%40lilnas.io'

  it('makes the name a link and the profile glyph a separate link', () => {
    const { container } = render(
      <AdminActor actor={SAM} href={FILTER_HREF} viewer={ADMIN} />,
    )

    const links = Array.from(container.querySelectorAll('a[href]'))

    // Avatar and name both filter the page; the glyph opens the profile.
    expect(links.length).toBeGreaterThanOrEqual(2)

    for (const link of links) {
      expect(link.tagName).toBe('A')
      expect(link).toHaveAttribute('href')
    }

    expect(
      screen.getByRole('link', { name: `Open ${SAM.email}’s profile` }),
    ).toHaveAttribute('href', expect.stringContaining('/profile'))
    expect(mouseOnlyControls(container)).toEqual([])
  })

  it('reaches each of them in document order, by Tab alone', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <AdminActor actor={SAM} href={FILTER_HREF} viewer={ADMIN} />,
    )

    const links = Array.from(container.querySelectorAll<HTMLElement>('a[href]'))

    for (const link of links) {
      await user.tab()

      expect(link).toHaveFocus()
    }
  })

  it('offers nothing focusable at all when there is nowhere to go', () => {
    // The service actor: no identity, so no filter and no profile. It must
    // come out as text rather than as a dead control.
    const { container } = render(<AdminActor actor={null} viewer={ADMIN} />)

    expect(container.querySelectorAll('a[href]')).toHaveLength(0)
    expect(mouseOnlyControls(container)).toEqual([])
  })
})
