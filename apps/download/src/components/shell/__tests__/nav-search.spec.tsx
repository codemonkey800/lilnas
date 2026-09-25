import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePathname } from 'next/navigation'

import { startVideoDownload } from 'src/app/actions/start-video-download'
import { NavSearch, SEARCH_ROUTE } from 'src/components/shell/nav-search'
import { iconSymbolId } from 'src/components/ui/icon'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
  useRouter: () => ({ push }),
}))

jest.mock('src/app/actions/start-video-download', () => ({
  startVideoDownload: jest.fn(),
}))

const mockUsePathname = jest.mocked(usePathname)
const mockStartVideoDownload = jest.mocked(startVideoDownload)

/** The field itself. `type="text"`, so it is a textbox, not a searchbox. */
function field(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Search or paste a link' })
}

/**
 * The glyph in the pill. Found through the input's own parent rather than the
 * first `svg` in the form, because the mobile close button's `x` renders ahead
 * of it while the field is expanded.
 */
function leadingIcon(): SVGElement {
  return field().parentElement?.querySelector('svg') as SVGElement
}

function leadingIconHref(): string | null {
  return leadingIcon().querySelector('use')?.getAttribute('href') ?? null
}

/** A deferred `startVideoDownload`, so `pending` can be held open. */
function holdTheAction(): () => void {
  let release: () => void = () => {}

  mockStartVideoDownload.mockReturnValue(
    new Promise(resolve => {
      release = () => resolve(undefined)
    }),
  )

  return () => release()
}

/**
 * Replaces `requestAnimationFrame` with a queue the test pumps by hand.
 *
 * Both of this field's focus moves are deferred by a frame, and the bug this
 * exists to pin is what happens when a close is queued while an open's frame
 * is *still pending*. jsdom fires a real frame roughly every 16ms, so whether
 * that overlap happens at all is a footrace between the machine and the timer
 * — which is exactly how this surfaced originally, as a test that failed six
 * runs in ten for no reason anyone could name. Owning the queue turns the
 * overlap from something the test has to win into something it constructs.
 */
function manualFrames() {
  const queue = new Map<number, FrameRequestCallback>()
  let nextHandle = 1

  const request = jest
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation(callback => {
      const handle = nextHandle++

      queue.set(handle, callback)

      return handle
    })

  const cancel = jest
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation(handle => {
      queue.delete(handle)
    })

  return {
    /** Runs every frame still queued, oldest first, as one browser would. */
    async flush(): Promise<void> {
      const pending = Array.from(queue.values())

      queue.clear()

      await act(async () => {
        for (const callback of pending) {
          callback(0)
        }
      })
    },
    restore(): void {
      request.mockRestore()
      cancel.mockRestore()
    },
  }
}

async function type(text: string) {
  const user = userEvent.setup()

  await user.clear(field())

  if (text.length > 0) {
    await user.type(field(), text)
  }

  return user
}

describe('NavSearch', () => {
  beforeEach(() => {
    // `clearMocks` clears calls but keeps implementations, so both of these have
    // to be re-stated rather than merely cleared between tests.
    mockUsePathname.mockReturnValue('/')
    mockStartVideoDownload.mockReset()
    mockStartVideoDownload.mockResolvedValue(undefined)
  })

  describe('classification', () => {
    it('is idle with an empty field: no action button, untinted search glyph', () => {
      render(<NavSearch />)

      expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
      expect(leadingIconHref()).toBe(`#${iconSymbolId('search')}`)
      expect(leadingIcon()).toHaveClass('text-ink-4')
      expect(leadingIcon()).not.toHaveClass('text-uv-hi')
    })

    it('shows no button at one character', async () => {
      render(<NavSearch />)
      await type('t')

      expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
    })

    it('shows Search at two characters, and tints the glyph', async () => {
      render(<NavSearch />)
      await type('th')

      expect(screen.getByRole('button', { name: 'Search' })).toBeVisible()
      expect(leadingIconHref()).toBe(`#${iconSymbolId('search')}`)
      expect(leadingIcon()).toHaveClass('text-uv-hi')
    })

    it('shows no button for whitespace only', async () => {
      render(<NavSearch />)
      await type('   ')

      expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
    })

    it('swaps the glyph and shows Download for a bare host', async () => {
      render(<NavSearch />)
      await type('youtube.com/watch?v=7f2k9dQ')

      expect(screen.getByRole('button', { name: 'Download' })).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
      expect(leadingIconHref()).toBe(`#${iconSymbolId('download')}`)
      expect(leadingIcon()).toHaveClass('text-uv-hi')
    })

    it('offers no dropdown, no listbox and no preview card in either state', async () => {
      render(<NavSearch />)
      await type('youtube.com/watch?v=x')

      expect(screen.queryByRole('listbox')).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(screen.queryByRole('option')).toBeNull()
    })
  })

  describe('the search branch', () => {
    it('navigates to the search page when the button is clicked', async () => {
      render(<NavSearch />)
      const user = await type('the office')

      await user.click(screen.getByRole('button', { name: 'Search' }))

      expect(push).toHaveBeenCalledWith(`${SEARCH_ROUTE}?q=the%20office`)
      expect(mockStartVideoDownload).not.toHaveBeenCalled()
    })

    it('does the same thing on Enter', async () => {
      render(<NavSearch />)
      const user = await type('the office')

      await user.keyboard('{Enter}')

      expect(push).toHaveBeenCalledWith(`${SEARCH_ROUTE}?q=the%20office`)
      expect(mockStartVideoDownload).not.toHaveBeenCalled()
    })

    it('does nothing on Enter below the two-character floor', async () => {
      render(<NavSearch />)
      const user = await type('t')

      await user.keyboard('{Enter}')

      expect(push).not.toHaveBeenCalled()
    })
  })

  describe('the video branch', () => {
    it('starts the download with the normalized URL', async () => {
      holdTheAction()

      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=7f2k9dQ')

      await user.click(screen.getByRole('button', { name: 'Download' }))

      expect(mockStartVideoDownload).toHaveBeenCalledWith(
        'https://youtube.com/watch?v=7f2k9dQ',
      )
      expect(push).not.toHaveBeenCalled()
    })

    it('runs the same branch on Enter', async () => {
      holdTheAction()

      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=x')

      await user.keyboard('{Enter}')

      expect(mockStartVideoDownload).toHaveBeenCalledWith(
        'https://youtube.com/watch?v=x',
      )
    })

    it('surfaces a failed create on the field instead of stranding the user', async () => {
      mockStartVideoDownload.mockResolvedValue({ error: 'Nope, try again' })

      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=x')

      await user.click(screen.getByRole('button', { name: 'Download' }))

      const alert = await screen.findByRole('alert')

      expect(alert).toHaveTextContent('Nope, try again')
      expect(field()).toHaveAttribute('aria-describedby', alert.id)
      expect(field()).toHaveValue('youtube.com/watch?v=x')
      expect(push).not.toHaveBeenCalled()
    })

    it('clears the error as soon as the text changes', async () => {
      mockStartVideoDownload.mockResolvedValue({ error: 'Nope, try again' })

      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=x')

      await user.click(screen.getByRole('button', { name: 'Download' }))
      await screen.findByRole('alert')

      await user.type(field(), 'y')

      expect(screen.queryByRole('alert')).toBeNull()
      expect(field()).not.toHaveAttribute('aria-describedby')
    })
  })

  describe('the double-submit guard', () => {
    it('marks the button aria-disabled and ignores every further submit while pending', async () => {
      const release = holdTheAction()

      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=x')
      const button = screen.getByRole('button', { name: 'Download' })

      await user.click(button)
      await waitFor(() =>
        expect(button).toHaveAttribute('aria-disabled', 'true'),
      )

      await user.click(button)
      await user.click(field())
      await user.keyboard('{Enter}')

      expect(mockStartVideoDownload).toHaveBeenCalledTimes(1)

      release()
    })

    it('keeps the pending button in the tab order', async () => {
      // jsdom does not blur an element when it becomes `disabled`, so asserting
      // on focus would pass under either implementation and prove nothing. Tab
      // order jsdom does model, and a real `disabled` attribute removes the
      // button from it — which is the whole reason this field uses
      // `aria-disabled` plus a guard in `onSubmit` instead.
      const release = holdTheAction()

      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=x')
      const button = screen.getByRole('button', { name: 'Download' })

      await user.click(button)
      await waitFor(() =>
        expect(button).toHaveAttribute('aria-disabled', 'true'),
      )

      expect(button).not.toBeDisabled()

      field().focus()
      await user.tab()

      expect(button).toHaveFocus()

      release()
    })
  })

  describe('the mobile collapse', () => {
    it('renders a collapsed trigger and a hidden field at rest', () => {
      render(<NavSearch />)

      const trigger = screen.getByRole('button', { name: 'Open search' })

      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      // `sm:hidden` on the trigger and `hidden sm:flex` on the field are the
      // whole collapse: one node repositioned by CSS, never two inputs.
      expect(trigger).toHaveClass('sm:hidden')
      expect(screen.getByRole('search')).toHaveClass('hidden', 'sm:flex')
      expect(screen.queryByRole('button', { name: 'Close search' })).toBeNull()
    })

    it('expands over the bar on tap and puts the caret in the field', async () => {
      const user = userEvent.setup()
      render(<NavSearch />)

      await user.click(screen.getByRole('button', { name: 'Open search' }))

      const form = screen.getByRole('search')

      expect(form).toHaveClass('fixed', 'inset-x-0', 'top-0')
      expect(form).not.toHaveClass('hidden')
      // ...and undoes all of it at the desktop breakpoint, so crossing 640px
      // while expanded lands on the inline field rather than on an overlay.
      expect(form).toHaveClass('sm:relative', 'sm:p-0')
      expect(screen.getByRole('button', { name: 'Close search' })).toBeVisible()
      expect(
        screen.getByRole('button', { name: 'Open search' }),
      ).toHaveAttribute('aria-expanded', 'true')
      await waitFor(() => expect(field()).toHaveFocus())
    })

    it('hands the bar back on close, and returns focus to the trigger', async () => {
      const user = userEvent.setup()
      render(<NavSearch />)

      const trigger = screen.getByRole('button', { name: 'Open search' })

      await user.click(trigger)
      await user.click(screen.getByRole('button', { name: 'Close search' }))

      expect(screen.getByRole('search')).toHaveClass('hidden')
      // Awaited, because the restore is deliberately deferred a frame: the
      // trigger is still `hidden` at the instant the handler runs.
      await waitFor(() => expect(trigger).toHaveFocus())
    })

    it('does not let the opening frame steal the focus a close just handed back', async () => {
      const frames = manualFrames()

      try {
        const user = userEvent.setup()
        render(<NavSearch />)

        const trigger = screen.getByRole('button', { name: 'Open search' })

        // Opened and closed without a single frame running in between, so the
        // frame `openSearch` queued is still pending when `closeSearch` queues
        // its own. Whichever of the two survives owns the caret.
        await user.click(trigger)
        await user.click(screen.getByRole('button', { name: 'Close search' }))

        await frames.flush()

        expect(trigger).toHaveFocus()
        // The specific wrong answer: focus dragged onto an input that the
        // collapse has just made `display: none`, which in a browser is focus
        // nowhere at all.
        expect(field()).not.toHaveFocus()
      } finally {
        frames.restore()
      }
    })

    it('closes on Escape, and hands the trigger back too', async () => {
      const user = userEvent.setup()
      render(<NavSearch />)

      const trigger = screen.getByRole('button', { name: 'Open search' })

      await user.click(trigger)
      // Escape is handled on the form, so it only closes once focus has landed
      // inside it — which is exactly the sequence a real tap produces, the
      // trigger being `display: none` the moment the overlay opens.
      await waitFor(() => expect(field()).toHaveFocus())

      await user.keyboard('{Escape}')

      expect(screen.getByRole('search')).toHaveClass('hidden')
      expect(screen.queryByRole('button', { name: 'Close search' })).toBeNull()
      // Escape and the close button are the same exit, so they owe the same
      // debt — the keyboard route to it especially, since a user who pressed
      // Escape has no pointer to recover with.
      await waitFor(() => expect(trigger).toHaveFocus())
    })

    it('mounts exactly one input, expanded or not', async () => {
      const user = userEvent.setup()
      const { container } = render(<NavSearch />)

      expect(container.querySelectorAll('input')).toHaveLength(1)

      await user.click(screen.getByRole('button', { name: 'Open search' }))

      expect(container.querySelectorAll('input')).toHaveLength(1)
    })

    it('classifies identically while expanded', async () => {
      const user = userEvent.setup()
      render(<NavSearch />)

      await user.click(screen.getByRole('button', { name: 'Open search' }))
      await user.type(field(), 'youtube.com/watch?v=x')

      expect(screen.getByRole('button', { name: 'Download' })).toBeVisible()
      expect(leadingIconHref()).toBe(`#${iconSymbolId('download')}`)
    })
  })

  describe('the /search opt-out', () => {
    it('renders nothing on the search page, whose hero already is the field', () => {
      mockUsePathname.mockReturnValue(SEARCH_ROUTE)

      const { container } = render(<NavSearch />)

      expect(container).toBeEmptyDOMElement()
    })

    it('still renders on every other route', () => {
      mockUsePathname.mockReturnValue('/videos/abc')

      render(<NavSearch />)

      expect(screen.getByRole('search')).toBeInTheDocument()
    })
  })
})
