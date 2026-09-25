import type { DiscoveryFacets } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { SearchState } from 'src/components/search/search-params'
import { parseSearchState } from 'src/components/search/search-params'
import { SearchToolbar } from 'src/components/search/search-toolbar'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => '/search',
  useRouter: () => ({ push }),
}))

const FACETS: DiscoveryFacets = {
  genres: [
    { count: 5, genre: 'Comedy' },
    { count: 4, genre: 'Drama' },
  ],
}

function state(search: string): SearchState {
  return parseSearchState(new URLSearchParams(search))
}

function renderToolbar(search = 'q=star', total = 40) {
  return render(
    <SearchToolbar
      facets={FACETS}
      showViewToggle={total > 0}
      state={state(search)}
      total={total}
    />,
  )
}

/** The query string of the most recent navigation. */
function pushedParams(): URLSearchParams {
  const [href] = push.mock.calls.at(-1) ?? []

  return new URLSearchParams(String(href).split('?')[1] ?? '')
}

describe('SearchToolbar', () => {
  it('reports the count, and quotes the query once there is room', () => {
    renderToolbar('q=star', 40)

    expect(screen.getByText(/40 results/)).toHaveTextContent(
      '40 results for “star”',
    )
  })

  it('singularises a lone result', () => {
    renderToolbar('q=star', 1)

    expect(screen.getByText(/1 result/)).toHaveTextContent('1 result for')
  })

  describe('the view switch', () => {
    // Deviation from `search.pug`, which wraps `aria-pressed` buttons in a
    // `role="radiogroup"` — two patterns that do not compose. A pair of toggle
    // buttons is what this actually is.
    it('is a group of pressed-state toggles', () => {
      renderToolbar('q=star&view=list')

      expect(screen.getByRole('button', { name: 'List view' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    })

    it('writes the view to the URL', async () => {
      const user = userEvent.setup()
      renderToolbar('q=star')

      await user.click(screen.getByRole('button', { name: 'List view' }))

      expect(pushedParams().get('view')).toBe('list')
      expect(pushedParams().get('q')).toBe('star')
    })

    it('is dropped entirely when nothing matched', () => {
      renderToolbar('q=xyzzy', 0)

      expect(screen.queryByRole('button', { name: 'Grid view' })).toBeNull()
    })
  })

  describe('the sort menu', () => {
    it('offers exactly the API enum, and no more', async () => {
      const user = userEvent.setup()
      renderToolbar()

      await user.click(screen.getByRole('button', { name: /^Sort by/ }))

      // In the enum's own declaration order, which is `DiscoverQuerySchema`'s.
      // `search.mjs` lists a fourth option, `Oldest release`; the API has no
      // ascending release order, so it is not offered.
      expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
        'Relevance',
        'Title A–Z',
        'Newest release',
      ])
    })

    it('writes the chosen ordering to the URL', async () => {
      const user = userEvent.setup()
      renderToolbar()

      await user.click(screen.getByRole('button', { name: /^Sort by/ }))
      await user.click(screen.getByRole('option', { name: 'Title A–Z' }))

      expect(pushedParams().get('sort')).toBe('title')
    })
  })

  describe('the filter panel', () => {
    it('badges how many filters are applied', () => {
      renderToolbar('q=star&genre=Comedy&yearFrom=1999&yearTo=2012')

      expect(
        screen.getByRole('button', { name: /^Filters/ }),
      ).toHaveTextContent('2')
    })

    it('is closed until the trigger is pressed', async () => {
      const user = userEvent.setup()
      renderToolbar()

      expect(screen.queryByRole('dialog')).toBeNull()

      await user.click(screen.getByRole('button', { name: /^Filters/ }))

      expect(screen.getByRole('dialog', { name: 'Filters' })).toBeVisible()
    })

    it('offers the API-computed genre facets', async () => {
      const user = userEvent.setup()
      renderToolbar()

      await user.click(screen.getByRole('button', { name: /^Filters/ }))

      expect(screen.getByRole('checkbox', { name: 'Comedy' })).toBeVisible()
      expect(screen.getByRole('checkbox', { name: 'Drama' })).toBeVisible()
    })

    // Nothing reaches the URL until "Show results" — the panel is a draft.
    it('does not navigate while the draft is being edited', async () => {
      const user = userEvent.setup()
      renderToolbar()

      await user.click(screen.getByRole('button', { name: /^Filters/ }))
      await user.click(screen.getByRole('checkbox', { name: 'Comedy' }))

      expect(push).not.toHaveBeenCalled()
    })

    it('applies the draft on Show results', async () => {
      const user = userEvent.setup()
      renderToolbar()

      await user.click(screen.getByRole('button', { name: /^Filters/ }))
      await user.click(screen.getByRole('checkbox', { name: 'Comedy' }))
      await user.type(
        screen.getByRole('textbox', { name: 'Start year' }),
        '1999',
      )
      await user.click(screen.getByRole('button', { name: 'Show results' }))

      expect(pushedParams().getAll('genre')).toEqual(['Comedy'])
      expect(pushedParams().get('yearFrom')).toBe('1999')
    })

    // The API refines `yearFrom <= yearTo` and 400s otherwise, so an
    // impossible range can never be submitted from here.
    it('blocks an inverted year range and says why', async () => {
      const user = userEvent.setup()
      renderToolbar()

      await user.click(screen.getByRole('button', { name: /^Filters/ }))
      await user.type(
        screen.getByRole('textbox', { name: 'Start year' }),
        '2015',
      )
      await user.type(screen.getByRole('textbox', { name: 'End year' }), '1998')

      expect(
        screen.getByText('Start year must be before end year'),
      ).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'Show results' }),
      ).toBeDisabled()
    })

    // A half-typed `20` on the way to `2012` is not a year, so the error
    // cannot flash at you mid-keystroke.
    it('stays quiet while a year is still being typed', async () => {
      const user = userEvent.setup()
      renderToolbar()

      await user.click(screen.getByRole('button', { name: /^Filters/ }))
      await user.type(
        screen.getByRole('textbox', { name: 'Start year' }),
        '2015',
      )
      await user.type(screen.getByRole('textbox', { name: 'End year' }), '19')

      expect(
        screen.queryByText('Start year must be before end year'),
      ).toBeNull()
      expect(screen.getByRole('button', { name: 'Show results' })).toBeEnabled()
    })
  })

  describe('the applied-filter chips', () => {
    it('are absent when nothing is applied', () => {
      renderToolbar('q=star')

      expect(screen.queryByRole('group', { name: 'Active filters' })).toBeNull()
    })

    it('name the value they remove, not merely "Remove"', () => {
      renderToolbar('q=star&genre=Comedy&genre=Drama&yearFrom=1999&yearTo=2012')

      expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
      expect(
        screen.getByRole('button', { name: 'Remove Comedy genre filter' }),
      ).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'Remove release year filter' }),
      ).toBeVisible()
    })

    it('removes one genre and leaves the rest', async () => {
      const user = userEvent.setup()
      renderToolbar('q=star&genre=Comedy&genre=Drama')

      await user.click(
        screen.getByRole('button', { name: 'Remove Comedy genre filter' }),
      )

      expect(pushedParams().getAll('genre')).toEqual(['Drama'])
    })

    it('removes both ends of the year range at once', async () => {
      const user = userEvent.setup()
      renderToolbar('q=star&yearFrom=1999&yearTo=2012')

      await user.click(
        screen.getByRole('button', { name: 'Remove release year filter' }),
      )

      expect(pushedParams().has('yearFrom')).toBe(false)
      expect(pushedParams().has('yearTo')).toBe(false)
      expect(pushedParams().get('q')).toBe('star')
    })

    it('keeps the query and the sort when everything is cleared', async () => {
      const user = userEvent.setup()
      renderToolbar('q=star&genre=Comedy&yearFrom=1999&sort=title')

      await user.click(screen.getByRole('button', { name: 'Clear all' }))

      expect(pushedParams().get('q')).toBe('star')
      expect(pushedParams().get('sort')).toBe('title')
      expect(pushedParams().has('genre')).toBe(false)
      expect(pushedParams().has('yearFrom')).toBe(false)
    })
  })
})

/**
 * The toolbar is the one place in the app that composes both popover kinds —
 * a `Menu` listbox and a `FilterPanel` dialog — side by side, each with its
 * own trigger. Each primitive's keyboard model is proved in `menu.spec.tsx`
 * and `filters.spec.tsx`; what is asserted here is that this call site wires
 * both up, and that the two do not interfere.
 *
 * Neither is focus-trapped, deliberately: a listbox releases on Tab and the
 * filter panel is non-modal. The obligation both carry is the handback.
 */
describe('SearchToolbar — popover focus', () => {
  function sortTrigger(): HTMLElement {
    return screen.getByRole('button', { name: /^Sort by/ })
  }

  function filtersTrigger(): HTMLElement {
    return screen.getByRole('button', { name: /^Filters/ })
  }

  describe('the sort menu', () => {
    it('opens onto the option it is currently sitting on', async () => {
      const user = userEvent.setup()

      renderToolbar('q=star&sort=title')

      await user.click(sortTrigger())

      const selected = screen.getByRole('option', { selected: true })

      // Real DOM focus, not `aria-activedescendant` — so the first arrow press
      // moves from somewhere meaningful.
      expect(selected).toHaveFocus()
    })

    it('closes on Escape and hands focus back to its own trigger', async () => {
      const user = userEvent.setup()

      renderToolbar()

      const trigger = sortTrigger()

      await user.click(trigger)
      expect(screen.getByRole('listbox')).toBeInTheDocument()

      await user.keyboard('{Escape}')

      expect(screen.queryByRole('listbox')).toBeNull()
      expect(trigger).toHaveFocus()
    })

    it('opens from the keyboard alone, with no pointer anywhere', async () => {
      const user = userEvent.setup()

      renderToolbar()

      sortTrigger().focus()
      await user.keyboard('{ArrowDown}')

      expect(screen.getByRole('listbox')).toBeInTheDocument()
      expect(screen.getByRole('option', { selected: true })).toHaveFocus()
    })
  })

  describe('the filter panel', () => {
    it('takes focus onto the panel and reports itself expanded', async () => {
      const user = userEvent.setup()

      renderToolbar()

      expect(filtersTrigger()).toHaveAttribute('aria-expanded', 'false')

      await user.click(filtersTrigger())

      expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveFocus()
      expect(filtersTrigger()).toHaveAttribute('aria-expanded', 'true')
    })

    it('closes on Escape and hands focus back to its own trigger', async () => {
      const user = userEvent.setup()

      renderToolbar()

      const trigger = filtersTrigger()

      await user.click(trigger)
      await user.keyboard('{Escape}')

      expect(screen.queryByRole('dialog', { name: 'Filters' })).toBeNull()
      expect(trigger).toHaveFocus()
    })

    it('does not leave the sort menu open behind it', async () => {
      const user = userEvent.setup()

      renderToolbar()

      await user.click(sortTrigger())
      expect(screen.getByRole('listbox')).toBeInTheDocument()

      // A pointer press outside the menu dismisses it, and the filters button
      // is outside. Two popovers stacked over each other would be two Escapes
      // to get out of, and the second one invisible.
      await user.click(filtersTrigger())

      expect(screen.queryByRole('listbox')).toBeNull()
      expect(
        screen.getByRole('dialog', { name: 'Filters' }),
      ).toBeInTheDocument()
    })
  })
})
