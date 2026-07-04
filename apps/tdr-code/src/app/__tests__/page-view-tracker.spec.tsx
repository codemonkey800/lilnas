import { render } from '@testing-library/react'

import { PageViewTracker } from 'src/app/lib/page-view-tracker'

// next/navigation's usePathname throws outside a real Next router context —
// see login.spec.tsx's identical mock for the established pattern here.
const mockPathname = jest.fn<string, []>()
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

// logToServer only ever calls .catch() on fetch's return value — see
// browser-logger.spec.tsx's identical mock/rationale.
const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
  mockPathname.mockReset().mockReturnValue('/')
})

describe('PageViewTracker', () => {
  it('logs a page-view event with the current pathname on mount', () => {
    mockPathname.mockReturnValue('/sessions')
    render(<PageViewTracker />)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.level).toBe('info')
    expect(body.event).toBe('page-view')
    expect(body.message).toBe('page-view')
    expect(body.context).toEqual({ path: '/sessions' })
  })

  it('logs again when the pathname changes', () => {
    mockPathname.mockReturnValue('/sessions')
    const { rerender } = render(<PageViewTracker />)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    mockPathname.mockReturnValue('/sessions/1')
    rerender(<PageViewTracker />)

    expect(mockFetch).toHaveBeenCalledTimes(2)
    const [, init] = mockFetch.mock.calls[1]!
    const body = JSON.parse(init?.body as string)
    expect(body.context).toEqual({ path: '/sessions/1' })
  })

  it('does not re-log on a re-render with an unchanged pathname', () => {
    mockPathname.mockReturnValue('/sessions')
    const { rerender } = render(<PageViewTracker />)
    expect(mockFetch).toHaveBeenCalledTimes(1)

    rerender(<PageViewTracker />)

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
