import '@testing-library/jest-dom'

import { THEME_FONT_SIZES } from '@lilnas/utils/cns'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LoadMore } from 'src/components/ui/load-more'

/** The count line — the element carrying the polite live region. */
function count(): HTMLElement {
  const node = document.querySelector('[aria-live="polite"]')

  if (!(node instanceof HTMLElement)) {
    throw new Error('expected a polite live region')
  }

  return node
}

function classes(element: Element): string[] {
  return Array.from(element.classList)
}

/**
 * Every font-size utility on the element. An allow-list of arbitrary values
 * plus this theme's `--text-*` token names, exactly as `button.spec.tsx` does
 * it: a loose `text-` prefix would count `text-ink-4` as a size and report one
 * that isn't there.
 */
function fontSizeClasses(element: Element): string[] {
  return classes(element).filter(
    name =>
      /^text-\[/.test(name) ||
      THEME_FONT_SIZES.some(token => name === `text-${token}`),
  )
}

describe('LoadMore', () => {
  const onLoadMore = jest.fn()

  beforeEach(() => {
    onLoadMore.mockClear()
  })

  it('renders the count', () => {
    render(<LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />)

    expect(count()).toHaveTextContent('Showing 24 of 340')
  })

  it('offers the control when another page exists', () => {
    render(<LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />)

    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled()
  })

  it('appends the next page on click', async () => {
    const user = userEvent.setup()

    render(<LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />)
    await user.click(screen.getByRole('button', { name: 'Load more' }))

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  describe('hasMore', () => {
    it('hides the button when there is no next cursor', () => {
      render(
        <LoadMore
          hasMore={false}
          loaded={340}
          onLoadMore={onLoadMore}
          total={340}
        />,
      )

      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('keeps the count when the button is gone', () => {
      render(
        <LoadMore
          hasMore={false}
          loaded={340}
          onLoadMore={onLoadMore}
          total={340}
        />,
      )

      expect(count()).toHaveTextContent('Showing 340 of 340')
    })

    /**
     * `hasMore` is the cursor, never `loaded < total`. A concurrent write can
     * leave a page whose `total` already counts rows this cursor has run out
     * of, and the count disagreeing with the cursor must not resurrect the
     * button.
     */
    it('is taken from the prop, not derived from loaded vs total', () => {
      const { rerender } = render(
        <LoadMore
          hasMore={false}
          loaded={24}
          onLoadMore={onLoadMore}
          total={340}
        />,
      )

      expect(screen.queryByRole('button')).not.toBeInTheDocument()

      rerender(
        <LoadMore hasMore loaded={340} onLoadMore={onLoadMore} total={340} />,
      )

      expect(
        screen.getByRole('button', { name: 'Load more' }),
      ).toBeInTheDocument()
    })
  })

  describe('pending', () => {
    /**
     * `aria-disabled`, deliberately not the real `disabled` attribute. A
     * `disabled` element leaves the focus order, so pressing this button by
     * keyboard used to disable it under the user's own focus and drop them on
     * `<body>` — after which loading a third page meant Tabbing from the top
     * of the document, past every row that had just been appended.
     */
    it('marks the button aria-disabled without leaving the focus order', () => {
      render(
        <LoadMore
          hasMore
          loaded={24}
          onLoadMore={onLoadMore}
          pending
          total={340}
        />,
      )

      const button = screen.getByRole('button', { name: 'Load more' })

      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).not.toBeDisabled()
      expect(button).not.toHaveAttribute('disabled')
    })

    it('carries no aria-disabled at rest', () => {
      render(
        <LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />,
      )

      expect(
        screen.getByRole('button', { name: 'Load more' }),
      ).not.toHaveAttribute('aria-disabled', 'true')
    })

    /**
     * The point of the `aria-disabled` choice, in the strongest form jsdom can
     * actually falsify.
     *
     * ⚠️ jsdom does **not** implement the browser behaviour this change exists
     * to avoid — it does not blur an element when that element becomes
     * `disabled`. So a test that focuses the button, flips `pending`, and
     * asserts `toHaveFocus()` passes under *either* implementation and proves
     * nothing. Staying in the tab order is the part jsdom does model: a real
     * `disabled` button is unreachable by Tab, so this fails if the attribute
     * ever comes back.
     */
    it('stays reachable by Tab while pending', async () => {
      const user = userEvent.setup()

      render(
        <LoadMore
          hasMore
          loaded={24}
          onLoadMore={onLoadMore}
          pending
          total={340}
        />,
      )

      await user.tab()

      expect(screen.getByRole('button', { name: 'Load more' })).toHaveFocus()
    })

    /**
     * Non-trivial now that the button is only *aria*-disabled: the click
     * genuinely dispatches, and it is `Button` swallowing `onClick` that stops
     * the second fetch. Both a pointer press and a keyboard activation are
     * checked, since only the handler stands between them and a duplicate
     * request.
     */
    it('blocks a second request while one is in flight', async () => {
      const user = userEvent.setup()

      render(
        <LoadMore
          hasMore
          loaded={24}
          onLoadMore={onLoadMore}
          pending
          total={340}
        />,
      )

      const button = screen.getByRole('button', { name: 'Load more' })

      await user.click(button)

      button.focus()
      await user.keyboard('{Enter}')
      await user.keyboard(' ')

      expect(onLoadMore).not.toHaveBeenCalled()
    })

    it('shows the spinner before the label', () => {
      render(
        <LoadMore
          hasMore
          loaded={24}
          onLoadMore={onLoadMore}
          pending
          total={340}
        />,
      )

      const button = screen.getByRole('button', { name: 'Load more' })

      expect(button.firstElementChild).toHaveClass('animate-spin')
      expect(button.firstElementChild).toHaveAttribute('aria-hidden', 'true')
    })

    it('renders no spinner at rest', () => {
      render(
        <LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />,
      )

      expect(
        screen.getByRole('button', { name: 'Load more' }).firstElementChild,
      ).toBeNull()
    })

    it('does not move the count until the page lands', () => {
      const { rerender } = render(
        <LoadMore
          hasMore
          loaded={24}
          onLoadMore={onLoadMore}
          pending
          total={340}
        />,
      )

      expect(count()).toHaveTextContent('Showing 24 of 340')

      rerender(
        <LoadMore hasMore loaded={48} onLoadMore={onLoadMore} total={340} />,
      )

      expect(count()).toHaveTextContent('Showing 48 of 340')
    })
  })

  describe('empty', () => {
    it('renders nothing when nothing matched', () => {
      const { container } = render(
        <LoadMore
          hasMore={false}
          loaded={0}
          onLoadMore={onLoadMore}
          total={0}
        />,
      )

      expect(container).toBeEmptyDOMElement()
    })

    it('never renders "Showing 0 of 0"', () => {
      render(
        <LoadMore
          hasMore={false}
          loaded={0}
          onLoadMore={onLoadMore}
          total={0}
        />,
      )

      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument()
    })

    it('renders nothing for a nonsense negative total', () => {
      const { container } = render(
        <LoadMore
          hasMore={false}
          loaded={0}
          onLoadMore={onLoadMore}
          total={-1}
        />,
      )

      expect(container).toBeEmptyDOMElement()
    })
  })

  describe('the live region', () => {
    it('is polite', () => {
      render(
        <LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />,
      )

      expect(count()).toHaveAttribute('aria-live', 'polite')
    })

    /**
     * The region has to be the *same* element across the update — a live
     * region that is inserted along with its new text announces nothing in
     * most screen readers.
     */
    it('updates in place when a page lands', () => {
      const { rerender } = render(
        <LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />,
      )
      const region = count()

      rerender(
        <LoadMore hasMore loaded={48} onLoadMore={onLoadMore} total={340} />,
      )

      expect(count()).toBe(region)
      expect(region).toHaveTextContent('Showing 48 of 340')
    })

    it('survives the button disappearing on the last page', () => {
      const { rerender } = render(
        <LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={48} />,
      )
      const region = count()

      rerender(
        <LoadMore
          hasMore={false}
          loaded={48}
          onLoadMore={onLoadMore}
          total={48}
        />,
      )

      expect(count()).toBe(region)
      expect(region).toHaveTextContent('Showing 48 of 48')
    })
  })

  describe('type', () => {
    /**
     * Regression: `cns` is `twMerge(clsx(...))`, and this theme's `--text-*`
     * tokens are only font sizes to tailwind-merge because
     * `packages/utils/src/cns.ts` registers them. Unregistered, `text-mono-sm`
     * and `text-ink-4` share a conflict group and one of the two is silently
     * dropped on the way to the DOM. Asserted off the rendered `class`
     * attribute for that reason.
     */
    it('keeps both the mono size token and the ink-4 colour', () => {
      render(
        <LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />,
      )

      expect(fontSizeClasses(count())).toEqual(['text-mono-sm'])
      expect(count()).toHaveClass('font-mono', 'text-ink-4')
    })

    /** A count that changes must not reflow as digits change width. */
    it('sets the count in tabular figures', () => {
      render(
        <LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />,
      )

      expect(count()).toHaveClass('tabular-nums')
    })

    it('carries no line-height utility beside the size token', () => {
      render(
        <LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />,
      )

      expect(
        classes(count()).filter(name => name.startsWith('leading-')),
      ).toEqual([])
    })

    it('uses the neutral outline control, not the accent', () => {
      render(
        <LoadMore hasMore loaded={24} onLoadMore={onLoadMore} total={340} />,
      )

      const button = screen.getByRole('button', { name: 'Load more' })

      expect(button).toHaveClass('border-line', 'bg-surface', 'text-ink')
      expect(button).not.toHaveClass('bg-uv')
    })
  })

  it('merges a caller className and spreads the rest onto the root', () => {
    const { container } = render(
      <LoadMore
        className="mt-8"
        data-testid="foot"
        hasMore
        loaded={24}
        onLoadMore={onLoadMore}
        total={340}
      />,
    )
    const root = container.firstElementChild

    expect(root).toHaveClass('mt-8', 'flex', 'flex-col', 'items-center')
    expect(root).toHaveAttribute('data-testid', 'foot')
  })
})
