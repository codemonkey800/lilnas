import { backendUrl } from 'src/app/lib/backend-url'

describe('backendUrl', () => {
  const saved = {
    AUTH_BACKEND_URL: process.env.AUTH_BACKEND_URL,
    BACKEND_PORT: process.env.BACKEND_PORT,
  }

  beforeEach(() => {
    delete process.env.AUTH_BACKEND_URL
    delete process.env.BACKEND_PORT
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('defaults to http://localhost:${BACKEND_PORT}', () => {
    process.env.BACKEND_PORT = '8081'

    expect(backendUrl('/me')).toBe('http://localhost:8081/me')
  })

  it('keeps the query string of the path', () => {
    process.env.BACKEND_PORT = '8081'

    expect(backendUrl('/requests/status?redirect=https%3A%2F%2Fa.b%2F')).toBe(
      'http://localhost:8081/requests/status?redirect=https%3A%2F%2Fa.b%2F',
    )
  })

  it('AUTH_BACKEND_URL wins over BACKEND_PORT', () => {
    process.env.BACKEND_PORT = '8081'
    process.env.AUTH_BACKEND_URL = 'http://auth:9000'

    expect(backendUrl('/me')).toBe('http://auth:9000/me')
  })

  it('does not need BACKEND_PORT when AUTH_BACKEND_URL is set', () => {
    process.env.AUTH_BACKEND_URL = 'https://backend.internal'

    expect(backendUrl('/admin/queue')).toBe(
      'https://backend.internal/admin/queue',
    )
  })

  it('tolerates one trailing slash', () => {
    process.env.AUTH_BACKEND_URL = 'http://auth:8081/'

    expect(backendUrl('/me')).toBe('http://auth:8081/me')
  })

  it.each([
    ['a path', 'http://auth:8081/api'],
    ['a path after a trailing slash', 'http://auth:8081//'],
    ['a query', 'http://auth:8081?x=1'],
    ['an empty query', 'http://auth:8081?'],
    ['a query after a slash', 'http://auth:8081/?x=1'],
    ['a fragment', 'http://auth:8081#frag'],
    ['an empty fragment', 'http://auth:8081#'],
    ['credentials', 'http://user:pw@auth:8081'],
    ['a username only', 'http://user@auth:8081'],
    ['a non-http scheme', 'ftp://auth:8081'],
    ['a scheme-less host', 'auth:8081'],
    ['a bare host', 'auth'],
    ['a backslash path', 'http://auth:8081\\admin'],
    ['an invalid port', 'http://auth:abc'],
    ['surrounding whitespace', ' http://auth:8081 '],
  ])('rejects AUTH_BACKEND_URL with %s, naming the variable', (_label, raw) => {
    process.env.BACKEND_PORT = '8081'
    process.env.AUTH_BACKEND_URL = raw

    expect(() => backendUrl('/me')).toThrow(/AUTH_BACKEND_URL/)
  })

  it('never echoes a credential-bearing value in the error', () => {
    process.env.AUTH_BACKEND_URL = 'http://user:s3cret@auth:8081'

    expect(() => backendUrl('/me')).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('s3cret'),
      }),
    )
  })

  it('throws like env() when both variables are unset', () => {
    expect(() => backendUrl('/me')).toThrow('BACKEND_PORT not defined')
  })

  it('reads the environment on every call', () => {
    process.env.BACKEND_PORT = '8081'
    expect(backendUrl('/me')).toBe('http://localhost:8081/me')

    process.env.BACKEND_PORT = '9090'
    expect(backendUrl('/me')).toBe('http://localhost:9090/me')

    process.env.AUTH_BACKEND_URL = 'http://auth:8081'
    expect(backendUrl('/me')).toBe('http://auth:8081/me')

    delete process.env.AUTH_BACKEND_URL
    expect(backendUrl('/me')).toBe('http://localhost:9090/me')
  })
})
