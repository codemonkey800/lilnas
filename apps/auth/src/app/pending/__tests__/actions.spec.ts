import { headers } from 'next/headers'

import { checkRequestStatus, submitReRequest } from 'src/app/pending/actions'

process.env.BACKEND_PORT = '8081'

jest.mock('next/headers', () => ({
  headers: jest.fn(),
}))

const REDIRECT = 'https://swole.lilnas.io/x'
const ENCODED = encodeURIComponent(REDIRECT)

describe('pending actions backend origin', () => {
  beforeEach(() => {
    ;(headers as jest.Mock).mockResolvedValue({
      get: (name: string) =>
        name === 'cookie' ? 'lilnas-auth.session_token=abc123' : null,
    })
  })

  afterEach(() => {
    delete process.env.AUTH_BACKEND_URL
  })

  it('checkRequestStatus GETs the default origin, and AUTH_BACKEND_URL when set', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify({ outcome: 'pending' })),
      )

    await checkRequestStatus(REDIRECT)
    process.env.AUTH_BACKEND_URL = 'http://auth:8081'
    await checkRequestStatus(REDIRECT)

    expect(fetchSpy.mock.calls.map(call => call[0])).toEqual([
      `http://localhost:8081/requests/status?redirect=${ENCODED}`,
      `http://auth:8081/requests/status?redirect=${ENCODED}`,
    ])
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'GET',
        headers: { cookie: 'lilnas-auth.session_token=abc123' },
      }),
    )

    fetchSpy.mockRestore()
  })

  it('submitReRequest POSTs the default origin, and AUTH_BACKEND_URL when set', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify({ ok: true })),
      )

    await submitReRequest(REDIRECT)
    process.env.AUTH_BACKEND_URL = 'http://auth:8081'
    await submitReRequest(REDIRECT)

    expect(fetchSpy.mock.calls.map(call => call[0])).toEqual([
      `http://localhost:8081/requests/re-request?redirect=${ENCODED}`,
      `http://auth:8081/requests/re-request?redirect=${ENCODED}`,
    ])
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: 'POST' }),
    )

    fetchSpy.mockRestore()
  })
})
