import { DownloadApiError } from '@lilnas/utils/download/client'

import { getIdentifiedDownloadClient } from 'src/lib/download-client'
import { getViewer } from 'src/lib/viewer'

jest.mock('src/lib/download-client', () => ({
  getIdentifiedDownloadClient: jest.fn(),
}))

const getClient = jest.mocked(getIdentifiedDownloadClient)

function mockWhoami(whoami: jest.Mock): void {
  getClient.mockResolvedValue({ whoami } as unknown as Awaited<
    ReturnType<typeof getIdentifiedDownloadClient>
  >)
}

describe('getViewer', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('returns the identity the backend reports, admin status included', async () => {
    const viewer = { email: 'jeremy@lilnas.io', isAdmin: true, userId: 'u_1' }
    mockWhoami(jest.fn().mockResolvedValue(viewer))

    await expect(getViewer()).resolves.toEqual(viewer)
  })

  it('returns null rather than throwing when whoami rejects', async () => {
    mockWhoami(
      jest
        .fn()
        .mockRejectedValue(new DownloadApiError(401, 'Unauthorized', {})),
    )

    await expect(getViewer()).resolves.toBeNull()
  })

  it('returns null when the request has no forwarded identity at all', async () => {
    // What dev without DEV_USER_EMAIL/DEV_USER_ID actually looks like: the
    // client is built fine, and ForwardedUserGuard answers 401.
    mockWhoami(
      jest
        .fn()
        .mockRejectedValue(new DownloadApiError(401, 'Unauthorized', {})),
    )

    expect(await getViewer()).toBeNull()
  })

  it('returns null when building the client itself throws', async () => {
    // `headers()` throws outside a request scope, so the failure can happen
    // before whoami is ever reached.
    getClient.mockRejectedValue(new Error('headers() outside request scope'))

    await expect(getViewer()).resolves.toBeNull()
  })

  it('logs the failure rather than swallowing it silently', async () => {
    mockWhoami(
      jest
        .fn()
        .mockRejectedValue(new DownloadApiError(401, 'Unauthorized', {})),
    )

    await getViewer()

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('/auth/whoami'),
      expect.any(DownloadApiError),
    )
  })

  it("re-throws next's static-generation bailout instead of eating it", async () => {
    // `headers()` during a prerender throws a DynamicServerError carrying this
    // digest. Swallowing it would prerender the shell with no account link
    // rather than marking the route dynamic.
    const bailout = Object.assign(new Error('Dynamic server usage: headers'), {
      digest: 'DYNAMIC_SERVER_USAGE',
    })
    getClient.mockRejectedValue(bailout)

    await expect(getViewer()).rejects.toBe(bailout)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('re-throws redirect() and notFound() rather than reporting no viewer', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    })
    mockWhoami(jest.fn().mockRejectedValue(redirect))

    await expect(getViewer()).rejects.toBe(redirect)
  })

  it('does not log when the identity resolves', async () => {
    mockWhoami(
      jest
        .fn()
        .mockResolvedValue({ email: 'a@b.io', isAdmin: false, userId: 'u_2' }),
    )

    await getViewer()

    expect(console.warn).not.toHaveBeenCalled()
  })
})
