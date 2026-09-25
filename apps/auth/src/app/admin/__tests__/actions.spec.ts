import { headers } from 'next/headers'

import { linkDiscordAccount, unlinkDiscordAccount } from 'src/app/admin/actions'

process.env.BACKEND_PORT = '8081'

jest.mock('next/headers', () => ({
  headers: jest.fn(),
}))

function mockIncomingCookie(cookie: string): void {
  ;(headers as jest.Mock).mockResolvedValue({
    get: (name: string) => (name === 'cookie' ? cookie : null),
  })
}

function mockBackend(response: Response): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValue(response)
}

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), { status: 200 })
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ statusCode: status, message }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// A real 18-digit snowflake, written as a STRING literal on purpose: an
// 18-digit NUMERIC literal is past Number.MAX_SAFE_INTEGER and eslint's
// no-loss-of-precision rule rejects it outright — which is the same fact
// about snowflakes that requireDiscordUserId() exists to enforce at
// runtime.
const SNOWFLAKE = '123456789012345678'

// ──────────────────────────────────────────────────────────────────────────────
// D2 (plan 017): requireDiscordUserId()'s narrowing, exercised through the
// Server Actions that use it rather than directly. The helper is
// deliberately NOT exported — this file carries the 'use server' directive,
// and Next.js only permits async function exports from such a module, so
// exporting a synchronous validator purely to unit-test it would be a build
// error. Driving it through linkDiscordAccount() also tests the property
// that actually matters: a rejected argument means NO request reaches the
// backend at all, which a direct call to the helper could never show.
// ──────────────────────────────────────────────────────────────────────────────
describe('linkDiscordAccount — discordUserId narrowing', () => {
  beforeEach(() => {
    mockIncomingCookie('better-auth.session_token=abc123')
  })

  it.each([
    ['too short (16 digits)', '1234567890123456'],
    ['too long (21 digits)', '123456789012345678901'],
    ['empty', ''],
    ['non-numeric', 'not-a-snowflake'],
    ['digits with a leading plus', '+123456789012345678'],
    ['digits with surrounding whitespace', ' 123456789012345678 '],
    // JS's `$` (without the `m` flag) matches only the end of input, never
    // before a trailing newline the way Python's does — asserted rather
    // than assumed, because the opposite behavior would let a snowflake
    // with an appended line smuggle itself through.
    ['digits with a trailing newline', '123456789012345678\n'],
    ['a full-width unicode digit', '12345678901234567１'],
  ])('rejects %s without calling the backend', async (_label, candidate) => {
    const fetchSpy = mockBackend(okResponse())

    await expect(linkDiscordAccount('user_1', candidate)).rejects.toThrow(
      'lilnas-auth: invalid discord user id',
    )
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  // Server Actions compile to public POST endpoints and the `string`
  // parameter type is erased at runtime, so a crafted call really can
  // deliver a non-string here. The numeric case is built through
  // JSON.parse rather than written as a literal for the eslint reason
  // noted on SNOWFLAKE above — and note what JSON.parse does to it: the
  // value has ALREADY lost its low digits by the time it arrives, which is
  // exactly why a number is rejected instead of being String()-ed into
  // something that still looks like a snowflake.
  it.each([
    ['a number', JSON.parse(SNOWFLAKE) as unknown],
    ['null', null],
    ['undefined', undefined],
    ['an object', { toString: () => SNOWFLAKE }],
    ['an array', [SNOWFLAKE]],
  ])(
    'rejects %s (the type annotation is erased at runtime)',
    async (_label, candidate) => {
      const fetchSpy = mockBackend(okResponse())

      await expect(
        linkDiscordAccount('user_1', candidate as string),
      ).rejects.toThrow('lilnas-auth: invalid discord user id')
      expect(fetchSpy).not.toHaveBeenCalled()

      fetchSpy.mockRestore()
    },
  )

  it.each([
    ['17 digits (lower bound)', '12345678901234567'],
    ['18 digits (a typical snowflake)', SNOWFLAKE],
    ['20 digits (upper bound)', '12345678901234567890'],
  ])('accepts %s', async (_label, candidate) => {
    const fetchSpy = mockBackend(okResponse())

    await expect(
      linkDiscordAccount('user_1', candidate),
    ).resolves.toBeUndefined()
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    fetchSpy.mockRestore()
  })

  it.each([
    ['empty', ''],
    ['containing a path separator', '../../admin/users'],
  ])('rejects a userId that is %s', async (_label, candidate) => {
    const fetchSpy = mockBackend(okResponse())

    await expect(linkDiscordAccount(candidate, SNOWFLAKE)).rejects.toThrow(
      'lilnas-auth: invalid user id',
    )
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})

describe('linkDiscordAccount', () => {
  beforeEach(() => {
    mockIncomingCookie('better-auth.session_token=abc123')
  })

  // Both ids go in the BODY, not the path — see the action's own comment
  // and AdminController.linkDiscord() for why the identifying PAIR stays
  // together.
  it('POSTs both ids in the body and forwards the incoming cookie', async () => {
    const fetchSpy = mockBackend(okResponse())

    await linkDiscordAccount('user_1', SNOWFLAKE)

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8081/admin/discord/link',
      expect.objectContaining({
        method: 'POST',
        headers: {
          cookie: 'better-auth.session_token=abc123',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ userId: 'user_1', discordUserId: SNOWFLAKE }),
      }),
    )

    fetchSpy.mockRestore()
  })

  // Every one of these messages is written for a human to read and is what
  // D3's panel renders — callBackend() appends the backend's own `message`
  // to the thrown Error rather than replacing it with a generic one.
  it.each([
    [404, 'user user_ghost not found'],
    [
      404,
      'Discord account 123456789012345678 has never been seen by this system — it can only be linked after it has actually used a Discord command',
    ],
    [400, 'Discord account already linked to someone@example.com'],
    [
      400,
      'That person is already linked to a different Discord account — unlink them first, then link the new one',
    ],
    [400, 'discordUserId must be a Discord snowflake (17-20 digits)'],
  ])('surfaces the backend %i message verbatim', async (status, message) => {
    const fetchSpy = mockBackend(errorResponse(status, message))

    await expect(linkDiscordAccount('user_1', SNOWFLAKE)).rejects.toThrow(
      `lilnas-auth: /admin/discord/link returned ${status}: ${message}`,
    )

    fetchSpy.mockRestore()
  })
})

describe('unlinkDiscordAccount', () => {
  beforeEach(() => {
    mockIncomingCookie('better-auth.session_token=abc123')
  })

  it('POSTs only the userId in the body', async () => {
    const fetchSpy = mockBackend(okResponse())

    await expect(unlinkDiscordAccount('user_1')).resolves.toBeUndefined()

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8081/admin/discord/unlink',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userId: 'user_1' }),
      }),
    )

    fetchSpy.mockRestore()
  })

  it.each([
    ['empty', ''],
    ['containing a path separator', 'user_1/../../admin/queue'],
  ])('rejects a userId that is %s', async (_label, candidate) => {
    const fetchSpy = mockBackend(okResponse())

    await expect(unlinkDiscordAccount(candidate)).rejects.toThrow(
      'lilnas-auth: invalid user id',
    )
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  // The load-bearing one: a 404 here is NOT an idempotent success. The
  // Unlink control only renders on a row of the LINKED list, so reaching
  // this call with nothing to delete means the admin acted on a stale
  // view — see the action's own comment. A future "simplification" that
  // treats 404 as ok would leave a phantom row on screen; this test is
  // what stops it.
  it('does NOT swallow a 404 into a success', async () => {
    const fetchSpy = mockBackend(
      errorResponse(404, 'user user_1 has no Discord link'),
    )

    await expect(unlinkDiscordAccount('user_1')).rejects.toThrow(
      'lilnas-auth: /admin/discord/unlink returned 404: user user_1 has no Discord link',
    )

    fetchSpy.mockRestore()
  })
})
