import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import PageError from 'src/app/error'
import { capStack } from 'src/app/lib/browser-logger'

// logToServer only ever calls .catch() on fetch's return value — see
// browser-logger.spec.tsx's identical mock/rationale.
const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
})

describe('PageError (error.tsx)', () => {
  it('logs the error once on mount, including digest and stack', () => {
    const error = new Error('boom') as Error & { digest?: string }
    error.digest = 'abc123'
    render(<PageError error={error} reset={jest.fn()} />)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.level).toBe('error')
    expect(body.event).toBe('error-boundary-caught')
    expect(body.message).toBe('boom')
    // capStack (2000 chars) may truncate error.stack in this environment —
    // the raw jest/jsdom-generated stack for a freshly-thrown Error can
    // exceed the cap on its own, so compare against the capped value
    // (the module under test's own dependency) rather than the raw one.
    expect(body.context).toEqual({
      digest: 'abc123',
      stack: capStack(error.stack),
    })
  })

  it('renders the error message via ErrorState and calls reset on retry', async () => {
    const user = userEvent.setup()
    const reset = jest.fn()
    render(<PageError error={new Error('boom')} reset={reset} />)

    expect(screen.getByText('boom')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
