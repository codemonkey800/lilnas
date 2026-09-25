import '@testing-library/jest-dom'

import type { DownloadGalleryFacets } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRouter } from 'next/navigation'

import { GalleryControls } from 'src/components/gallery/gallery-controls'
import type { GalleryFilters } from 'src/lib/gallery-filters'
import {
  EMPTY_GALLERY_FILTERS,
  INVALID_RANGE_MESSAGE,
  parseGalleryFilters,
} from 'src/lib/gallery-filters'

// The controls do exactly one thing to the outside world — push a URL — so the
// router is the whole contract under test here.
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}))

const push = jest.fn()

const FACETS: DownloadGalleryFacets = {
  types: [
    { count: 1, type: DownloadType.Movie },
    { count: 1, type: DownloadType.Show },
    { count: 40, type: DownloadType.Video },
  ],
  uploaders: [
    { count: 28, email: 'jeremy@lilnas.io' },
    { count: 3, email: 'sarah@lilnas.io' },
  ],
}

beforeEach(() => {
  jest.mocked(useRouter).mockReturnValue({
    push,
  } as unknown as ReturnType<typeof useRouter>)
})

function renderControls(
  filters: Partial<GalleryFilters> = {},
  props: Partial<Parameters<typeof GalleryControls>[0]> = {},
) {
  return render(
    <GalleryControls
      facets={FACETS}
      filters={{ ...EMPTY_GALLERY_FILTERS, ...filters }}
      rangeError={null}
      total={42}
      {...props}
    />,
  )
}

/** The filters the last `router.push` describes, parsed back out of the URL. */
function pushedFilters(): GalleryFilters {
  const href = push.mock.calls.at(-1)?.[0] as string

  return parseGalleryFilters(new URLSearchParams(href.split('?')[1] ?? ''))
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /^Filters/ }))

  return screen.getByRole('dialog', { name: 'Filters' })
}

describe('GalleryControls tab strip', () => {
  it('selects All when nothing is filtered by type', () => {
    renderControls()

    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('selects the one tab a single-type filter names', () => {
    renderControls({ types: [DownloadType.Movie] })

    expect(screen.getByRole('tab', { name: 'Movies' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('pushes a type filter when a tab is chosen', async () => {
    const user = userEvent.setup()
    renderControls()

    await user.click(screen.getByRole('tab', { name: 'Shows' }))

    expect(pushedFilters().types).toEqual([DownloadType.Show])
  })

  it('pushes a bare /gallery when All is chosen', async () => {
    const user = userEvent.setup()
    renderControls({ types: [DownloadType.Show] })

    await user.click(screen.getByRole('tab', { name: 'All' }))

    expect(push).toHaveBeenLastCalledWith('/gallery', { scroll: false })
  })

  it('leaves every tab unselected when two types are filtered', () => {
    renderControls({ types: [DownloadType.Movie, DownloadType.Show] })

    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-selected', 'false')
    }
  })

  it('keeps the strip reachable by keyboard while no tab is selected', async () => {
    const user = userEvent.setup()
    renderControls({ types: [DownloadType.Movie, DownloadType.Show] })

    // Every `Tab` is `tabIndex={-1}` while none is selected, so the tablist
    // itself has to hold the tab stop or the strip would be pointer-only.
    await user.tab()

    expect(screen.getByRole('tablist')).toHaveFocus()
  })

  it('leaves the tab stop on the selected tab the rest of the time', () => {
    renderControls({ types: [DownloadType.Movie] })

    expect(screen.getByRole('tablist')).not.toHaveAttribute('tabindex')
    expect(screen.getByRole('tab', { name: 'Movies' })).toHaveAttribute(
      'tabindex',
      '0',
    )
  })
})

describe('GalleryControls filter panel', () => {
  it('opens and closes from the Filters trigger', async () => {
    const user = userEvent.setup()
    renderControls()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await openPanel(user)

    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
  })

  it('counts narrowed facets on the trigger, not selected values', async () => {
    renderControls({
      types: [DownloadType.Movie, DownloadType.Show],
      from: '2026-01-01',
      to: '2026-03-31',
    })

    expect(
      screen.getByRole('button', { name: /^Filters/ }),
    ).toHaveAccessibleName('Filters 2')
  })

  it('renders the media type facet counts exactly as the server sent them', async () => {
    const user = userEvent.setup()
    renderControls()
    const panel = await openPanel(user)

    const group = within(panel).getByRole('group', { name: 'media type' })

    expect(
      within(group).getByRole('checkbox', { name: 'Videos 40' }),
    ).toBeInTheDocument()
    expect(
      within(group).getByRole('checkbox', { name: 'Movies 1' }),
    ).toBeInTheDocument()
    expect(
      within(group).getByRole('checkbox', { name: 'Shows 1' }),
    ).toBeInTheDocument()
  })

  it('renders the uploader facet exactly as the server sent it', async () => {
    const user = userEvent.setup()
    renderControls()
    const panel = await openPanel(user)

    const group = within(panel).getByRole('group', { name: 'uploaded by' })

    // Order, membership and counts are all the server's. The attribution-oracle
    // guard is already applied to this list, so anything dropped, re-sorted or
    // recounted here would either hide a real uploader or invent one.
    const boxes = within(group).getAllByRole('checkbox')

    expect(boxes).toHaveLength(2)
    // The avatar beside each name is `aria-hidden`, so the initials stay out of
    // the accessible name — "JE jeremy@lilnas.io 28" would be the same fact
    // twice.
    expect(boxes[0]).toHaveAccessibleName('jeremy@lilnas.io 28')
    expect(boxes[1]).toHaveAccessibleName('sarah@lilnas.io 3')
  })

  it('omits a type the facets do not mention rather than inventing a zero', async () => {
    const user = userEvent.setup()
    renderControls(
      {},
      {
        facets: {
          types: [{ count: 4, type: DownloadType.Video }],
          uploaders: [],
        },
      },
    )
    const panel = await openPanel(user)

    const group = within(panel).getByRole('group', { name: 'media type' })

    expect(within(group).getAllByRole('checkbox')).toHaveLength(1)
    expect(within(group).queryByText('0')).not.toBeInTheDocument()
  })

  it('adds a second type from the panel without dropping the first', async () => {
    const user = userEvent.setup()
    renderControls({ types: [DownloadType.Movie] })
    const panel = await openPanel(user)

    await user.click(within(panel).getByRole('checkbox', { name: 'Shows 1' }))

    expect(pushedFilters().types).toEqual([
      DownloadType.Movie,
      DownloadType.Show,
    ])
  })

  it('normalizes the type order regardless of the order they were ticked', async () => {
    const user = userEvent.setup()
    renderControls({ types: [DownloadType.Show] })
    const panel = await openPanel(user)

    await user.click(within(panel).getByRole('checkbox', { name: 'Videos 40' }))

    expect(push.mock.calls.at(-1)?.[0]).toBe('/gallery?type=video%2Cshow')
  })

  it('unticks a type that is already applied', async () => {
    const user = userEvent.setup()
    renderControls({ types: [DownloadType.Movie, DownloadType.Show] })
    const panel = await openPanel(user)

    await user.click(within(panel).getByRole('checkbox', { name: 'Movies 1' }))

    expect(pushedFilters().types).toEqual([DownloadType.Show])
  })

  it('pushes an uploader filter', async () => {
    const user = userEvent.setup()
    renderControls()
    const panel = await openPanel(user)

    await user.click(
      within(panel).getByRole('checkbox', { name: 'sarah@lilnas.io 3' }),
    )

    expect(pushedFilters().requester).toBe('sarah@lilnas.io')
  })

  it('replaces the uploader rather than accumulating, since the API takes one', async () => {
    const user = userEvent.setup()
    renderControls({ requester: 'jeremy@lilnas.io' })
    const panel = await openPanel(user)

    await user.click(
      within(panel).getByRole('checkbox', { name: 'sarah@lilnas.io 3' }),
    )

    expect(push.mock.calls.at(-1)?.[0]).toBe(
      '/gallery?requester=sarah%40lilnas.io',
    )
  })

  it('shows the applied date range in the two fields', async () => {
    const user = userEvent.setup()
    renderControls({ from: '2026-01-01', to: '2026-03-31' })
    const panel = await openPanel(user)

    expect(within(panel).getByLabelText('Start date')).toHaveValue('2026-01-01')
    expect(within(panel).getByLabelText('End date')).toHaveValue('2026-03-31')
  })

  it('counts the current match in the confirm button', async () => {
    const user = userEvent.setup()
    renderControls()
    const panel = await openPanel(user)

    expect(
      within(panel).getByRole('button', { name: 'Show 42 results' }),
    ).toBeInTheDocument()
  })

  it('says one result in the singular', async () => {
    const user = userEvent.setup()
    renderControls({}, { total: 1 })
    const panel = await openPanel(user)

    expect(
      within(panel).getByRole('button', { name: 'Show 1 result' }),
    ).toBeInTheDocument()
  })

  it('closes from the confirm button without pushing anything', async () => {
    const user = userEvent.setup()
    renderControls()
    const panel = await openPanel(user)

    await user.click(within(panel).getByRole('button', { name: /^Show/ }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('keeps the panel Clear all focusable while it is inert', async () => {
    const user = userEvent.setup()
    renderControls()
    const panel = await openPanel(user)

    const clear = within(panel).getByRole('button', { name: 'Clear all' })

    // `aria-disabled`, not `disabled`: pressing this is what turns it off, and
    // a real `disabled` would drop it out of the focus order under the user.
    expect(clear).toHaveAttribute('aria-disabled', 'true')
    expect(clear).not.toBeDisabled()

    await user.click(clear)

    expect(push).not.toHaveBeenCalled()
  })

  it('clears everything from the panel once something is applied', async () => {
    const user = userEvent.setup()
    renderControls({ types: [DownloadType.Movie], requester: 'a@b.c' })
    const panel = await openPanel(user)

    await user.click(within(panel).getByRole('button', { name: 'Clear all' }))

    expect(push).toHaveBeenLastCalledWith('/gallery', { scroll: false })
  })

  it('dims the app behind an open panel and not otherwise', async () => {
    const user = userEvent.setup()
    const { container } = renderControls()

    expect(container.querySelector('.z-10')).not.toBeInTheDocument()

    await openPanel(user)

    const scrim = container.querySelector('[aria-hidden="true"].fixed')

    expect(scrim).toHaveClass('fixed', 'inset-0', 'z-10')
  })
})

describe('GalleryControls date range validation', () => {
  it('says nothing about a range that is in order', async () => {
    const user = userEvent.setup()
    renderControls({ from: '2026-01-01', to: '2026-03-31' })
    const panel = await openPanel(user)

    expect(within(panel).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(panel).getByLabelText('Start date')).not.toHaveAttribute(
      'aria-invalid',
    )
  })

  it("surfaces the API's rejection on the panel rather than as no results", async () => {
    const user = userEvent.setup()
    renderControls(
      { from: '2026-05-01', to: '2026-01-01' },
      { rangeError: INVALID_RANGE_MESSAGE, total: null },
    )
    const panel = await openPanel(user)

    expect(within(panel).getByRole('alert')).toHaveTextContent(
      INVALID_RANGE_MESSAGE,
    )
  })

  it('marks both ends invalid and points them at the message', async () => {
    const user = userEvent.setup()
    renderControls(
      { from: '2026-05-01', to: '2026-01-01' },
      { rangeError: INVALID_RANGE_MESSAGE, total: null },
    )
    const panel = await openPanel(user)

    const message = within(panel).getByRole('alert')
    const start = within(panel).getByLabelText('Start date')
    const end = within(panel).getByLabelText('End date')

    expect(start).toHaveAttribute('aria-invalid', 'true')
    expect(end).toHaveAttribute('aria-invalid', 'true')
    expect(start).toHaveAccessibleDescription(message.textContent ?? '')
    expect(end).toHaveAccessibleDescription(message.textContent ?? '')
  })

  it('says the same thing locally, before the round trip has answered', async () => {
    const user = userEvent.setup()
    renderControls({ from: '2026-05-01', to: '2026-01-01' })
    const panel = await openPanel(user)

    expect(within(panel).getByRole('alert')).toHaveTextContent(
      INVALID_RANGE_MESSAGE,
    )
  })

  it('offers no result count to confirm when there is no answer', async () => {
    const user = userEvent.setup()
    renderControls(
      { from: '2026-05-01', to: '2026-01-01' },
      { rangeError: INVALID_RANGE_MESSAGE, total: null },
    )
    const panel = await openPanel(user)

    expect(
      within(panel).getByRole('button', { name: 'Close' }),
    ).toBeInTheDocument()
    expect(
      within(panel).queryByRole('button', { name: /^Show/ }),
    ).not.toBeInTheDocument()
  })
})

describe('GalleryControls applied chips', () => {
  it('renders no chip row for an unfiltered gallery', () => {
    renderControls()

    expect(
      screen.queryByRole('group', { name: 'Active filters' }),
    ).not.toBeInTheDocument()
  })

  it('renders one chip per applied value', () => {
    renderControls({
      types: [DownloadType.Movie, DownloadType.Show],
      requester: 'jeremy@lilnas.io',
      from: '2026-01-01',
      to: '2026-03-31',
    })

    const row = screen.getByRole('group', { name: 'Active filters' })

    expect(within(row).getByText('Movies')).toBeInTheDocument()
    expect(within(row).getByText('Shows')).toBeInTheDocument()
    expect(within(row).getByText('jeremy@lilnas.io')).toBeInTheDocument()
    expect(within(row).getByText('2026-01-01 – 2026-03-31')).toBeInTheDocument()
  })

  it('names every remove button by what it removes', () => {
    renderControls({
      types: [DownloadType.Movie, DownloadType.Show],
      requester: 'jeremy@lilnas.io',
    })

    const row = screen.getByRole('group', { name: 'Active filters' })

    expect(
      within(row).queryByRole('button', { name: 'Remove' }),
    ).not.toBeInTheDocument()
    expect(
      within(row).getByRole('button', { name: 'Remove Movies filter' }),
    ).toBeInTheDocument()
    expect(
      within(row).getByRole('button', {
        name: 'Remove uploader filter jeremy@lilnas.io',
      }),
    ).toBeInTheDocument()
  })

  it('removes only the filter its chip names', async () => {
    const user = userEvent.setup()
    renderControls({
      types: [DownloadType.Movie, DownloadType.Show],
      requester: 'jeremy@lilnas.io',
    })

    await user.click(
      screen.getByRole('button', { name: 'Remove Movies filter' }),
    )

    const pushed = pushedFilters()

    expect(pushed.types).toEqual([DownloadType.Show])
    expect(pushed.requester).toBe('jeremy@lilnas.io')
  })

  it('removes both ends of a range from its single chip', async () => {
    const user = userEvent.setup()
    renderControls({ from: '2026-01-01', to: '2026-03-31' })

    await user.click(
      screen.getByRole('button', { name: 'Remove date added filter' }),
    )

    expect(push).toHaveBeenLastCalledWith('/gallery', { scroll: false })
  })

  it('clears everything from the chip row', async () => {
    const user = userEvent.setup()
    renderControls({ types: [DownloadType.Movie], from: '2026-01-01' })

    const row = screen.getByRole('group', { name: 'Active filters' })

    await user.click(within(row).getByRole('button', { name: 'Clear all' }))

    expect(push).toHaveBeenLastCalledWith('/gallery', { scroll: false })
  })
})

/**
 * ⚠️ The filter panel is a **non-modal** popover, and that is a design
 * decision rather than an omission — `FilterPanel`'s own docblock says so, and
 * APG agrees: the grid underneath stays readable and reachable while you
 * filter it. So there is deliberately **no focus trap here**, and no test
 * below asserts one. Trapping focus in this panel would be the regression.
 *
 * What it owes instead is the other half of the contract — focus goes in on
 * open, comes back to the trigger on Escape, and leaving by keyboard dismisses
 * rather than stranding an invisible panel behind the user.
 */
describe('GalleryControls — the filter popover and focus', () => {
  function trigger(): HTMLElement {
    return screen.getByRole('button', { name: /^Filters/ })
  }

  it('moves focus onto the panel itself, not into its first field', async () => {
    const user = userEvent.setup()

    renderControls()

    const panel = await openPanel(user)

    // The panel, not the first input: a screen reader gets to announce the
    // dialog, and a mobile keyboard does not spring open on a date field.
    expect(panel).toHaveFocus()
    expect(panel).toHaveAttribute('tabindex', '-1')
  })

  it('reports its expanded state on the trigger', async () => {
    const user = userEvent.setup()

    renderControls()

    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog')

    await openPanel(user)

    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes on Escape and hands focus back to the trigger', async () => {
    const user = userEvent.setup()

    renderControls()
    await openPanel(user)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull()
    expect(trigger()).toHaveFocus()
  })

  it('dismisses when the keyboard walks out of it, rather than lingering', async () => {
    const user = userEvent.setup()

    renderControls()
    await openPanel(user)

    // Shift+Tab off the panel lands on the trigger, which counts as inside —
    // the panel has to survive that, or the trigger could never be reached.
    await user.tab({ shift: true })

    expect(trigger()).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
  })
})
