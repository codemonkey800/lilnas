import { logBoundaryError } from 'src/app/lib/error-boundary-logging'

// Shared by error.tsx and global-error.tsx — tested directly here rather
// than through a full render of GlobalError, which emits its own
// <html>/<body> and conflicts with RTL's mount-into-document.body
// assumption (error.spec.tsx covers PageError's own useEffect wiring; this
// file covers the shared helper both boundaries rely on).
const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
})

describe('logBoundaryError', () => {
  it('logs the error message, digest, and stack at error level', () => {
    const error = new Error('boom') as Error & { digest?: string }
    error.digest = 'xyz'

    logBoundaryError(error)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.level).toBe('error')
    expect(body.message).toBe('boom')
    expect(body.context).toEqual({ digest: 'xyz', stack: error.stack })
  })

  it('logs with an undefined digest when the error has none', () => {
    logBoundaryError(new Error('boom'))

    const [, init] = mockFetch.mock.calls[0]!
    const body = JSON.parse(init?.body as string)
    expect(body.context.digest).toBeUndefined()
  })
})
