import { fireEvent, render } from '@testing-library/react'

import { ClickTracker } from 'src/app/lib/click-tracker'

// logToServer only ever calls .catch() on fetch's return value — see
// browser-logger.spec.tsx's identical mock/rationale.
const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
})

describe('ClickTracker', () => {
  it('logs a button-click event when an element with data-track-id is clicked (AE4)', () => {
    render(
      <>
        <ClickTracker />
        <button data-track-id="do-thing">Click</button>
      </>,
    )

    fireEvent.click(document.querySelector('[data-track-id="do-thing"]')!)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]!
    expect(init?.keepalive).toBe(true)
    const body = JSON.parse(init?.body as string)
    expect(body.level).toBe('info')
    expect(body.event).toBe('button-click')
    expect(body.message).toBe('button-click')
    expect(body.context).toEqual({ id: 'do-thing' })
  })

  it('finds a tracked ancestor when a nested element is clicked (delegation via closest)', () => {
    render(
      <>
        <ClickTracker />
        <button data-track-id="do-thing">
          <span>nested icon</span>
        </button>
      </>,
    )

    fireEvent.click(document.querySelector('span')!)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.context).toEqual({ id: 'do-thing' })
  })

  it('does not log a click with no tracked ancestor', () => {
    render(
      <>
        <ClickTracker />
        <button>untracked</button>
      </>,
    )

    fireEvent.click(document.querySelector('button')!)

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('removes the document click listener on unmount', () => {
    const removeSpy = jest.spyOn(document, 'removeEventListener')
    const { unmount } = render(<ClickTracker />)

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function))
    removeSpy.mockRestore()
  })
})
