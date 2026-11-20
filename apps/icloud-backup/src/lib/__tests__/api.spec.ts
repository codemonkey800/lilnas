import {
  ApiError,
  cancelBackup,
  getAdminAccounts,
  getBackup,
  resetImmichPassword,
  startBackup,
  submitCode,
  submitPassword,
  syncBackup,
} from 'src/lib/api'

import { makeView } from './helpers/view'

const fetchMock = jest.fn()

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function lastCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init }
}

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock
})

afterEach(() => {
  // @ts-expect-error jsdom has no fetch; remove the stub again
  delete global.fetch
})

describe('api wrappers', () => {
  it('GET /api/backup sends no request header and no body', async () => {
    const view = makeView('downloading')
    fetchMock.mockResolvedValue(json(view))

    await expect(getBackup()).resolves.toEqual(view)

    const { url, init } = lastCall()
    expect(url).toBe('/api/backup')
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(init.headers).not.toHaveProperty('X-Requested-With')
  })

  it.each([
    [
      'startBackup',
      () => startBackup({ appleId: 'a@b.co' }),
      '/api/backup/start',
      { appleId: 'a@b.co' },
    ],
    ['syncBackup', () => syncBackup(), '/api/backup/sync', undefined],
    [
      'submitPassword',
      () => submitPassword({ password: 'pw' }),
      '/api/backup/password',
      { password: 'pw' },
    ],
    [
      'submitCode',
      () => submitCode({ code: '123456' }),
      '/api/backup/code',
      { code: '123456' },
    ],
    ['cancelBackup', () => cancelBackup(), '/api/backup/cancel', undefined],
    [
      'resetImmichPassword',
      () => resetImmichPassword(),
      '/api/backup/immich-password',
      undefined,
    ],
  ])('%s POSTs with the header', async (_name, call, path, body) => {
    fetchMock.mockResolvedValue(json({ password: 'x' }))

    await call()

    const { url, init } = lastCall()
    expect(url).toBe(path)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'X-Requested-With': 'icloud-backup' })
    if (body) {
      expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
      expect(JSON.parse(init.body as string)).toEqual(body)
    } else {
      expect(init.body).toBeUndefined()
    }
  })

  it('returns the new Immich password', async () => {
    fetchMock.mockResolvedValue(json({ password: 'correct horse' }))
    await expect(resetImmichPassword()).resolves.toEqual({
      password: 'correct horse',
    })
  })

  it('GETs the admin accounts', async () => {
    fetchMock.mockResolvedValue(json([]))
    await expect(getAdminAccounts()).resolves.toEqual([])
    expect(lastCall().url).toBe('/api/admin/accounts')
  })

  it('throws ApiError with the status and message on non-2xx', async () => {
    fetchMock.mockResolvedValue(
      json({ statusCode: 409, message: 'A backup is already running' }, 409),
    )

    const error = await syncBackup().catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 409,
      message: 'A backup is already running',
    })
  })

  it('joins a list of validation messages', async () => {
    fetchMock.mockResolvedValue(json({ message: ['bad id', 'bad code'] }, 400))
    await expect(submitCode({ code: '1' })).rejects.toMatchObject({
      status: 400,
      message: 'bad id, bad code',
    })
  })

  it('falls back to the status text when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>', { status: 502, statusText: 'Bad Gateway' }),
    )
    await expect(getBackup()).rejects.toMatchObject({
      status: 502,
      message: 'Bad Gateway',
    })
  })

  it('turns a network failure into ApiError with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(getBackup()).rejects.toMatchObject({ status: 0 })
  })
})
