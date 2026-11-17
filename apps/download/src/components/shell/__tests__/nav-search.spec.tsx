import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { usePathname } from 'next/navigation'

import { startVideoDownload } from 'src/app/actions/start-video-download'
import { NavSearch, SEARCH_ROUTE } from 'src/components/shell/nav-search'

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

/**
 * The field itself: a `type="search"` input, named for what its button will do
 * (Search for a title, Download for a pasted link).
 */
function field(): HTMLInputElement {
  return screen.getByRole('searchbox') as HTMLInputElement
}

/** The submit button, named for what pressing it does right now. */
function action(name: 'Search' | 'Download'): HTMLElement {
  return screen.getByRole('button', { name })
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
    mockUsePathname.mockReturnValue('/gallery')
    mockStartVideoDownload.mockReset()
    mockStartVideoDownload.mockResolvedValue(undefined)
  })

  describe('the field', () => {
    it('is the package Search: a search landmark, an input and the one button', () => {
      render(<NavSearch />)

      expect(screen.getByRole('search')).toBeInTheDocument()
      expect(field()).toHaveAttribute('placeholder', 'Search or paste a link…')
      expect(action('Search')).toHaveAttribute('type', 'submit')
    })

    it('labels its button Search while it holds a title, or nothing', async () => {
      render(<NavSearch />)

      expect(action('Search')).toBeInTheDocument()

      await type('the office')

      expect(action('Search')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
    })

    it('relabels its button Download for a pasted link', async () => {
      render(<NavSearch />)
      await type('youtube.com/watch?v=x')

      expect(action('Download')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Search' })).toBeNull()
    })

    it('offers no dropdown, no listbox and no preview card in either state', async () => {
      render(<NavSearch />)
      await type('th')

      expect(screen.queryByRole('listbox')).toBeNull()
      expect(screen.queryByRole('combobox')).toBeNull()
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  describe('the search branch', () => {
    it('navigates to the search page when the button is clicked', async () => {
      render(<NavSearch />)
      const user = await type('the office')

      await user.click(action('Search'))

      expect(push).toHaveBeenCalledWith('/search?q=the%20office')
      expect(mockStartVideoDownload).not.toHaveBeenCalled()
    })

    it('does the same thing on Enter', async () => {
      render(<NavSearch />)
      const user = await type('the office')

      await user.type(field(), '{Enter}')

      expect(push).toHaveBeenCalledWith('/search?q=the%20office')
    })

    it('does nothing on Enter below the two-character floor', async () => {
      render(<NavSearch />)
      const user = await type('t')

      await user.type(field(), '{Enter}')

      expect(push).not.toHaveBeenCalled()
      expect(mockStartVideoDownload).not.toHaveBeenCalled()
    })
  })

  describe('the video branch', () => {
    it('starts the download with the normalized URL', async () => {
      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=x')

      await user.click(action('Download'))

      await waitFor(() =>
        expect(mockStartVideoDownload).toHaveBeenCalledWith(
          'https://youtube.com/watch?v=x',
        ),
      )
      expect(push).not.toHaveBeenCalled()
    })

    it('runs the same branch on Enter', async () => {
      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=x')

      await user.type(field(), '{Enter}')

      await waitFor(() =>
        expect(mockStartVideoDownload).toHaveBeenCalledTimes(1),
      )
    })

    it('surfaces a failed create on the field instead of stranding the user', async () => {
      mockStartVideoDownload.mockResolvedValue({ error: 'Not a video link.' })
      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=x')

      await user.click(action('Download'))

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Not a video link.',
      )
    })

    it('clears the error as soon as the text changes', async () => {
      mockStartVideoDownload.mockResolvedValue({ error: 'Not a video link.' })
      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=x')

      await user.click(action('Download'))
      await screen.findByRole('alert')
      await user.type(field(), 'y')

      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  describe('the double-submit guard', () => {
    it('disables the button and ignores every further submit while pending', async () => {
      const release = holdTheAction()

      render(<NavSearch />)
      const user = await type('youtube.com/watch?v=x')
      const button = action('Download')

      await user.click(button)
      await waitFor(() => expect(button).toBeDisabled())

      await user.click(button)
      await user.click(field())
      await user.keyboard('{Enter}')

      expect(mockStartVideoDownload).toHaveBeenCalledTimes(1)

      release()
    })
  })

  describe('the mobile collapse', () => {
    /** The element the collapse is applied to: the form's wrapper. */
    function wrapper(): HTMLElement {
      return screen.getByRole('search').parentElement as HTMLElement
    }

    it('renders a collapsed trigger and a hidden field at rest', () => {
      render(<NavSearch />)

      const trigger = screen.getByRole('button', { name: 'Open search' })

      expect(trigger).toHaveAttribute('aria-expanded', 'false')
      // `sm:hidden` on the trigger and `hidden sm:block` on the field are the
      // whole collapse: one node repositioned by CSS, never two inputs.
      expect(trigger).toHaveClass('sm:hidden')
      expect(wrapper()).toHaveClass('hidden', 'sm:block')
      expect(screen.queryByRole('button', { name: 'Close search' })).toBeNull()
    })

    it('expands over the bar on tap and puts the caret in the field', async () => {
      const user = userEvent.setup()
      render(<NavSearch />)

      await user.click(screen.getByRole('button', { name: 'Open search' }))

      expect(wrapper()).toHaveClass('fixed', 'inset-x-0', 'top-0')
      expect(wrapper()).not.toHaveClass('hidden')
      // ...and undoes all of it at the desktop breakpoint, so crossing 640px
      // while expanded lands on the inline field rather than on an overlay.
      expect(wrapper()).toHaveClass('sm:relative', 'sm:p-0')
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

      expect(wrapper()).toHaveClass('hidden')
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
      // Escape is handled on the wrapper, so it only closes once focus has
      // landed inside it — which is exactly the sequence a real tap produces.
      await waitFor(() => expect(field()).toHaveFocus())

      await user.keyboard('{Escape}')

      expect(wrapper()).toHaveClass('hidden')
      expect(screen.queryByRole('button', { name: 'Close search' })).toBeNull()
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

      expect(action('Download')).toBeVisible()
    })
  })

  // The two routes with a hero field of their own: two copies of one control
  // on one screen is two places to type the same query.
  describe('the hero opt-outs', () => {
    it.each([
      ['the search page', SEARCH_ROUTE],
      ['the home page', '/'],
    ])('renders nothing on %s', (_name, path) => {
      mockUsePathname.mockReturnValue(path)

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
