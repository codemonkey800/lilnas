import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LogDetailPanel } from 'src/app/logs/log-detail-panel'
import type { LogLine } from 'src/logging/log-view.types'

function makeLine(
  parsed: Record<string, unknown> | null,
  overrides: Partial<LogLine> = {},
): LogLine {
  return {
    byteOffset: 0,
    byteLength: 0,
    raw: parsed === null ? '<malformed>' : JSON.stringify(parsed),
    parsed,
    ...overrides,
  }
}

// navigator.clipboard is undefined by default under jsdom — tests that need
// a working clipboard install this stub themselves and restore afterward
// via jest's own clearMocks/restoreMocks (jest.config.js has both enabled
// globally), so no per-test manual cleanup of navigator.clipboard is needed
// beyond what each `describe` block does explicitly for its own override.
//
// MUST be called AFTER `userEvent.setup()`, never before: user-event's own
// `setup()` unconditionally installs ITS OWN navigator.clipboard getter stub
// (see @testing-library/user-event/dist/cjs/utils/dataTransfer/Clipboard.js
// — `attachClipboardStubToView` runs on every `setup()` call and clobbers
// whatever was there, since it only skips reinstalling when the existing
// value is already tagged as ITS stub via a private symbol). Calling this
// before `userEvent.setup()` silently loses the mock — confirmed by
// instrumenting `Object.getOwnPropertyDescriptor(navigator, 'clipboard')`
// across setup()/render()/click() during initial development of this file;
// the descriptor is intact through render() but replaced the instant
// `userEvent.setup()` runs.
function installClipboardStub() {
  const writeText = jest.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
  return writeText
}

describe('LogDetailPanel — closed state', () => {
  it('renders nothing when line is null', () => {
    const { container } = render(
      <LogDetailPanel line={null} stream="backend" onClose={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('LogDetailPanel — happy path (parsed line)', () => {
  it('shows pretty-printed JSON containing all fields, and copy writes that same text to the clipboard', async () => {
    const user = userEvent.setup()
    const writeText = installClipboardStub()
    const parsed = {
      level: 30,
      time: 1783247968175,
      process: 'main',
      event: 'generation-inserted',
      msg: 'Inserted bot generation',
      generationId: 424,
    }
    const line = makeLine(parsed)

    render(<LogDetailPanel line={line} stream="backend" onClose={jest.fn()} />)

    const expectedText = JSON.stringify(parsed, null, 2)
    // The pretty-printed JSON is split across many highlighted <span>
    // tokens, so a single getByText(expectedText) would never match —
    // assert against the panel's aggregated textContent instead, which is
    // exactly what a user actually reads/copies regardless of markup.
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('"level": 30')
    expect(dialog).toHaveTextContent('"generationId": 424')
    expect(dialog).toHaveTextContent('"msg": "Inserted bot generation"')
    expect(dialog).toHaveTextContent('"event": "generation-inserted"')

    await user.click(screen.getByRole('button', { name: /^copy$/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expectedText))
  })
})

describe('LogDetailPanel — malformed line (R14)', () => {
  it('shows the raw string verbatim (never a JSON.stringify(null) artifact), and copy copies the raw text', async () => {
    const user = userEvent.setup()
    const writeText = installClipboardStub()
    const line = makeLine(null, { raw: '{"level":30, "msg":', byteOffset: 7 })

    render(<LogDetailPanel line={line} stream="backend" onClose={jest.fn()} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('{"level":30, "msg":')
    expect(dialog).not.toHaveTextContent('null')

    await user.click(screen.getByRole('button', { name: /^copy$/i }))

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('{"level":30, "msg":'),
    )
  })
})

// U12 (R13, filter-actions half): the deferred "filter by this field/value"
// actions, now that log-viewer.tsx's filter model actually exists to feed
// them.
describe('LogDetailPanel — filter actions (U12, R13)', () => {
  describe('rendering: only for present fields, only when callbacks are provided', () => {
    it('renders all three actions when the line has level+process+event and every callback is provided', () => {
      const line = makeLine({
        level: 40,
        process: 'bot',
        event: 'writer-fault',
        msg: 'hi',
      })

      render(
        <LogDetailPanel
          line={line}
          stream="backend"
          onClose={jest.fn()}
          onFilterByLevel={jest.fn()}
          onFilterByProcess={jest.fn()}
          onFilterByEvent={jest.fn()}
        />,
      )

      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-level"]',
        ),
      ).toBeInTheDocument()
      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-process"]',
        ),
      ).toBeInTheDocument()
      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-event"]',
        ),
      ).toBeInTheDocument()
    })

    it('does NOT render the event action for a valid debug-level line with no event field (a normal state, not malformed)', () => {
      const line = makeLine({ level: 20, process: 'main', msg: 'debug line' })

      render(
        <LogDetailPanel
          line={line}
          stream="backend"
          onClose={jest.fn()}
          onFilterByLevel={jest.fn()}
          onFilterByProcess={jest.fn()}
          onFilterByEvent={jest.fn()}
        />,
      )

      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-level"]',
        ),
      ).toBeInTheDocument()
      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-process"]',
        ),
      ).toBeInTheDocument()
      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-event"]',
        ),
      ).not.toBeInTheDocument()
    })

    it('renders no action buttons at all on a malformed line (parsed === null), even when every callback is provided', () => {
      const line = makeLine(null, { raw: 'not json at all' })

      render(
        <LogDetailPanel
          line={line}
          stream="backend"
          onClose={jest.fn()}
          onFilterByLevel={jest.fn()}
          onFilterByProcess={jest.fn()}
          onFilterByEvent={jest.fn()}
        />,
      )

      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-actions"]',
        ),
      ).not.toBeInTheDocument()
    })

    it('renders NO action buttons at all when every callback is omitted (backward compatibility with pre-U12 usage)', () => {
      const line = makeLine({
        level: 40,
        process: 'bot',
        event: 'writer-fault',
        msg: 'hi',
      })

      render(
        <LogDetailPanel line={line} stream="backend" onClose={jest.fn()} />,
      )

      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-actions"]',
        ),
      ).not.toBeInTheDocument()
    })

    it('renders only the actions whose OWN callback was provided, even if the line has every field', () => {
      const line = makeLine({
        level: 40,
        process: 'bot',
        event: 'writer-fault',
        msg: 'hi',
      })

      render(
        <LogDetailPanel
          line={line}
          stream="backend"
          onClose={jest.fn()}
          onFilterByLevel={jest.fn()}
          // onFilterByProcess / onFilterByEvent deliberately omitted.
        />,
      )

      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-level"]',
        ),
      ).toBeInTheDocument()
      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-process"]',
        ),
      ).not.toBeInTheDocument()
      expect(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-event"]',
        ),
      ).not.toBeInTheDocument()
    })
  })

  describe('clicking each action calls the corresponding callback with the correct value', () => {
    it('"Filter by level" calls onFilterByLevel with this line\'s own numeric level', async () => {
      const user = userEvent.setup()
      const onFilterByLevel = jest.fn()
      const line = makeLine({ level: 40, process: 'bot', msg: 'hi' })

      render(
        <LogDetailPanel
          line={line}
          stream="backend"
          onClose={jest.fn()}
          onFilterByLevel={onFilterByLevel}
        />,
      )

      await user.click(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-level"]',
        ) as HTMLElement,
      )

      expect(onFilterByLevel).toHaveBeenCalledWith(40)
    })

    it('"Filter by process" calls onFilterByProcess with this line\'s own process string', async () => {
      const user = userEvent.setup()
      const onFilterByProcess = jest.fn()
      const line = makeLine({ level: 40, process: 'bot', msg: 'hi' })

      render(
        <LogDetailPanel
          line={line}
          stream="backend"
          onClose={jest.fn()}
          onFilterByProcess={onFilterByProcess}
        />,
      )

      await user.click(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-process"]',
        ) as HTMLElement,
      )

      expect(onFilterByProcess).toHaveBeenCalledWith('bot')
    })

    it('"Filter by event" calls onFilterByEvent with this line\'s own event slug', async () => {
      const user = userEvent.setup()
      const onFilterByEvent = jest.fn()
      const line = makeLine({
        level: 50,
        event: 'writer-fault',
        msg: 'hi',
      })

      render(
        <LogDetailPanel
          line={line}
          stream="backend"
          onClose={jest.fn()}
          onFilterByEvent={onFilterByEvent}
        />,
      )

      await user.click(
        document.querySelector(
          '[data-track-id="log-detail-panel-filter-by-event"]',
        ) as HTMLElement,
      )

      expect(onFilterByEvent).toHaveBeenCalledWith('writer-fault')
    })
  })
})

describe('LogDetailPanel — dismissal', () => {
  it('Esc calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    const line = makeLine({ level: 30, time: 1, msg: 'hi' })

    render(<LogDetailPanel line={line} stream="backend" onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the close button calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    const line = makeLine({ level: 30, time: 1, msg: 'hi' })

    render(<LogDetailPanel line={line} stream="backend" onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('re-rendering with a different non-null line shows the new content, not stale content from the previous one', () => {
    const lineA = makeLine({
      level: 30,
      time: 1,
      msg: 'first message',
      event: 'first-event',
    })
    const lineB = makeLine({
      level: 30,
      time: 2,
      msg: 'second message',
      event: 'second-event',
    })

    const { rerender } = render(
      <LogDetailPanel line={lineA} stream="backend" onClose={jest.fn()} />,
    )
    expect(screen.getByRole('dialog')).toHaveTextContent('first message')

    rerender(
      <LogDetailPanel line={lineB} stream="backend" onClose={jest.fn()} />,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('second message')
    expect(dialog).not.toHaveTextContent('first message')
  })
})

describe('LogDetailPanel — accessibility: focus management', () => {
  it('opening the panel moves focus into it', () => {
    const line = makeLine({ level: 30, time: 1, msg: 'hi' })

    render(<LogDetailPanel line={line} stream="backend" onClose={jest.fn()} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('Tab from the last focusable element cycles to the first, and Shift+Tab from the first cycles to the last', async () => {
    const user = userEvent.setup()
    const line = makeLine({ level: 30, time: 1, msg: 'hi' })

    render(<LogDetailPanel line={line} stream="backend" onClose={jest.fn()} />)

    const copyButton = screen.getByRole('button', { name: /^copy$/i })
    const closeButton = screen.getByRole('button', { name: /close/i })

    // The panel root itself is focused on open (not one of the two
    // buttons), so the first Tab press moves to the first REAL focusable
    // descendant before the wrap-around logic is exercised.
    copyButton.focus()
    expect(document.activeElement).toBe(copyButton)

    await user.tab()
    expect(document.activeElement).toBe(closeButton)

    // Forward wrap: Tab from the last focusable element goes to the first.
    await user.tab()
    expect(document.activeElement).toBe(copyButton)

    // Backward wrap: Shift+Tab from the first focusable element goes to the
    // last.
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(closeButton)
  })

  it('Shift+Tab as the very first keystroke after open (focus still on the panel root) wraps to the last focusable element instead of escaping the trap', async () => {
    const user = userEvent.setup()
    const line = makeLine({ level: 30, time: 1, msg: 'hi' })

    render(<LogDetailPanel line={line} stream="backend" onClose={jest.fn()} />)

    const dialog = screen.getByRole('dialog')
    const closeButton = screen.getByRole('button', { name: /close/i })
    // Confirms the premise this test is guarding: focus opens on the panel
    // root itself, not on either button — so the wrap-around check must
    // handle "active is the root" as its own case, not just "active is
    // first/last", or a reverse-tab here would escape to whatever the page
    // puts before this panel in document order.
    expect(document.activeElement).toBe(dialog)

    await user.tab({ shift: true })
    expect(document.activeElement).toBe(closeButton)
  })
})

describe('LogDetailPanel — accessibility: focus restore', () => {
  it('closing (Esc) returns focus to whatever was active immediately before the panel opened', async () => {
    const user = userEvent.setup()

    const trigger = document.createElement('button')
    trigger.textContent = 'row trigger'
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const line = makeLine({ level: 30, time: 1, msg: 'hi' })
    const { rerender } = render(
      <LogDetailPanel line={line} stream="backend" onClose={jest.fn()} />,
    )
    // Sanity: opening did move focus away from the trigger into the panel.
    expect(document.activeElement).not.toBe(trigger)

    await user.keyboard('{Escape}')
    // Esc only calls onClose (the caller decides what happens next); the
    // host is responsible for actually setting line back to null. Simulate
    // that here so the panel unmounts and its cleanup runs.
    rerender(
      <LogDetailPanel line={null} stream="backend" onClose={jest.fn()} />,
    )

    expect(document.activeElement).toBe(trigger)

    document.body.removeChild(trigger)
  })

  it('closing via the close button returns focus to whatever was active immediately before the panel opened', async () => {
    const user = userEvent.setup()

    const trigger = document.createElement('button')
    trigger.textContent = 'row trigger'
    document.body.appendChild(trigger)
    trigger.focus()

    const line = makeLine({ level: 30, time: 1, msg: 'hi' })
    const { rerender } = render(
      <LogDetailPanel line={line} stream="backend" onClose={jest.fn()} />,
    )

    await user.click(screen.getByRole('button', { name: /close/i }))
    rerender(
      <LogDetailPanel line={null} stream="backend" onClose={jest.fn()} />,
    )

    expect(document.activeElement).toBe(trigger)

    document.body.removeChild(trigger)
  })
})

describe('LogDetailPanel — copy affordance', () => {
  it('shows transient "Copied" feedback after a successful copy', async () => {
    const user = userEvent.setup()
    installClipboardStub()
    const line = makeLine({ level: 30, time: 1, msg: 'hi' })

    render(<LogDetailPanel line={line} stream="backend" onClose={jest.fn()} />)

    await user.click(screen.getByRole('button', { name: /^copy$/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^copied$/i }),
      ).toBeInTheDocument(),
    )
  })

  it('does not throw when navigator.clipboard is unavailable, and shows an unavailable affordance instead of a silent failure', async () => {
    const user = userEvent.setup()
    // Must come AFTER userEvent.setup() — see installClipboardStub's header
    // comment: setup() unconditionally installs its own navigator.clipboard
    // getter, so an override made before setup() would be silently replaced
    // by a WORKING clipboard stub, defeating the point of this test.
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    const line = makeLine({ level: 30, time: 1, msg: 'hi' })

    render(<LogDetailPanel line={line} stream="backend" onClose={jest.fn()} />)

    await expect(
      user.click(screen.getByRole('button', { name: /^copy$/i })),
    ).resolves.not.toThrow()

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /copy unavailable/i }),
      ).toBeInTheDocument(),
    )
  })
})
