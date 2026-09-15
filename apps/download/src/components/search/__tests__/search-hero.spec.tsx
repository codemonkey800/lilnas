import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSearchParams } from 'next/navigation'

import {
  SEARCH_DEBOUNCE_MS,
  SearchHero,
} from 'src/components/search/search-hero'

const replace = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: () => '/search',
  useRouter: () => ({ replace }),
  useSearchParams: jest.fn(),
}))

const mockUseSearchParams = jest.mocked(useSearchParams)

/** `useSearchParams()` returns a `ReadonlyURLSearchParams`, which this is. */
function withUrl(search: string): void {
  mockUseSearchParams.mockReturnValue(
    new URLSearchParams(search) as unknown as ReturnType<
      typeof useSearchParams
    >,
  )
}

function field(): HTMLInputElement {
  return screen.getByRole('textbox', {
    name: 'Search movies and shows',
  }) as HTMLInputElement
}

/** The spinner is decorative, so it is found by its class, not by a role. */
function spinner(): Element | null {
  return document.querySelector('.animate-spin')
}

function setup() {
  return userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
}

describe('SearchHero', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    withUrl('')
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('starts from the query in the URL', () => {
    withUrl('q=the+office')
    render(<SearchHero />)

    expect(field()).toHaveValue('the office')
  })

  describe('the debounce', () => {
    it('does not touch the URL before the window elapses', async () => {
      const user = setup()
      render(<SearchHero />)

      await user.type(field(), 'star')
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1)

      expect(replace).not.toHaveBeenCalled()
    })

    // The whole point of the trailing debounce: four keystrokes are one
    // request, not four. Each keystroke's effect cleanup clears the previous
    // timer, so only the last one ever fires.
    it('coalesces a burst of keystrokes into one navigation', async () => {
      const user = setup()
      render(<SearchHero />)

      await user.type(field(), 'star')
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS)

      expect(replace).toHaveBeenCalledTimes(1)
      expect(replace).toHaveBeenCalledWith('/search?q=star', { scroll: false })
    })

    it('replaces rather than pushes, so Back does not walk the keystrokes', async () => {
      const user = setup()
      render(<SearchHero />)

      await user.type(field(), 'star')
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS)

      expect(replace).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ scroll: false }),
      )
    })

    it('keeps every other parameter intact', async () => {
      withUrl('q=old&genre=Action&sort=title&view=list')
      const user = setup()
      render(<SearchHero />)

      await user.clear(field())
      await user.type(field(), 'star')
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS)

      const [href] = replace.mock.calls.at(-1) ?? []
      const params = new URLSearchParams(String(href).split('?')[1])

      expect(params.get('q')).toBe('star')
      expect(params.get('genre')).toBe('Action')
      expect(params.get('sort')).toBe('title')
      expect(params.get('view')).toBe('list')
    })

    it('drops `q` entirely when the field is emptied', async () => {
      withUrl('q=star&view=list')
      const user = setup()
      render(<SearchHero />)

      await user.clear(field())
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS)

      expect(replace).toHaveBeenCalledWith('/search?view=list', {
        scroll: false,
      })
    })

    // Below the schema's `min(2)` the page renders a hint instead of calling
    // the API — but the URL still mirrors the field, so the address bar never
    // disagrees with what is on screen. The "no call" half of this contract is
    // asserted against the page, which is where the call would be made.
    it('still mirrors a below-threshold query into the URL', async () => {
      const user = setup()
      render(<SearchHero />)

      await user.type(field(), 's')
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS)

      expect(replace).toHaveBeenCalledWith('/search?q=s', { scroll: false })
    })

    it('flushes immediately on Enter instead of waiting the window out', async () => {
      const user = setup()
      render(<SearchHero />)

      await user.type(field(), 'star{Enter}')

      expect(replace).toHaveBeenCalledTimes(1)
      expect(replace).toHaveBeenCalledWith('/search?q=star', { scroll: false })
    })

    it('does not navigate when the field already matches the URL', async () => {
      withUrl('q=star')
      const user = setup()
      render(<SearchHero />)

      await user.click(field())
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 4)

      expect(replace).not.toHaveBeenCalled()
    })
  })

  describe('resyncing from the URL', () => {
    // Adjusted during render against a sentinel, never in an effect —
    // `react-hooks/set-state-in-effect` rejects the effect outright, and it
    // would paint a frame of the old query first.
    it('adopts a query pushed at the route from elsewhere', () => {
      const { rerender } = render(<SearchHero />)

      expect(field()).toHaveValue('')

      withUrl('q=the+office')
      rerender(<SearchHero />)

      expect(field()).toHaveValue('the office')
    })

    it('adopts a query cleared from elsewhere', () => {
      withUrl('q=star')
      const { rerender } = render(<SearchHero />)

      withUrl('')
      rerender(<SearchHero />)

      expect(field()).toHaveValue('')
    })
  })

  describe('the in-flight state', () => {
    it('shows the search glyph while the field matches the URL', () => {
      withUrl('q=star')
      render(<SearchHero />)

      expect(spinner()).toBeNull()
    })

    it('swaps the glyph for a spinner from the first keystroke', async () => {
      const user = setup()
      render(<SearchHero />)

      await user.type(field(), 'st')

      expect(spinner()).not.toBeNull()
    })

    // The mockup marks the input `readonly` while loading. A field you cannot
    // type into for 300ms after every keystroke is unusable.
    it('leaves the field editable while in flight', async () => {
      const user = setup()
      render(<SearchHero />)

      await user.type(field(), 'st')

      expect(field()).not.toHaveAttribute('readonly')
      expect(field()).toBeEnabled()
    })
  })

  it('is a search landmark with no submit button to disable', () => {
    render(<SearchHero />)

    const form = screen.getByRole('search')

    expect(form).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /search/i }),
    ).not.toBeInTheDocument()
  })
})
