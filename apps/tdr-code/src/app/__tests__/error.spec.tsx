import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import PageError from 'src/app/error'

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
    expect(body.message).toBe('boom')
    expect(body.context).toEqual({ digest: 'abc123', stack: error.stack })
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
