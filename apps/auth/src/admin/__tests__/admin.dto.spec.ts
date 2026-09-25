import {
  BulkRejectBodySchema,
  LinkDiscordBodySchema,
  PreAuthorizeBodySchema,
  SetUserServicesBodySchema,
  UnlinkDiscordBodySchema,
} from 'src/admin/admin.dto'

describe('BulkRejectBodySchema', () => {
  it('accepts a non-empty array of positive integer ids', () => {
    expect(BulkRejectBodySchema.safeParse({ ids: [1, 2, 3] }).success).toBe(
      true,
    )
  })

  it('rejects an empty array', () => {
    expect(BulkRejectBodySchema.safeParse({ ids: [] }).success).toBe(false)
  })

  it('rejects a non-integer id', () => {
    expect(BulkRejectBodySchema.safeParse({ ids: [1.5] }).success).toBe(false)
  })

  it('rejects a non-positive id', () => {
    expect(BulkRejectBodySchema.safeParse({ ids: [0, -1] }).success).toBe(false)
  })

  it('rejects a missing ids field entirely', () => {
    expect(BulkRejectBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects a body that is not an object at all', () => {
    expect(BulkRejectBodySchema.safeParse('not-an-object').success).toBe(false)
    expect(BulkRejectBodySchema.safeParse(null).success).toBe(false)
    expect(BulkRejectBodySchema.safeParse(undefined).success).toBe(false)
  })
})

describe('PreAuthorizeBodySchema', () => {
  it('accepts a valid email and a non-empty serviceHosts array', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 'person@example.com',
        serviceHosts: ['swole.lilnas.io'],
      }).success,
    ).toBe(true)
  })

  // M3: the whole point of batching — one request can carry every host the
  // admin checked, not just one.
  it('accepts multiple serviceHosts in one request', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 'person@example.com',
        serviceHosts: ['swole.lilnas.io', 'tdr.lilnas.io'],
      }).success,
    ).toBe(true)
  })

  it('rejects a malformed email', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 'not-an-email',
        serviceHosts: ['swole.lilnas.io'],
      }).success,
    ).toBe(false)
  })

  it('rejects an empty serviceHosts array', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 'person@example.com',
        serviceHosts: [],
      }).success,
    ).toBe(false)
  })

  it('rejects a serviceHosts array containing an empty string', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 'person@example.com',
        serviceHosts: ['swole.lilnas.io', ''],
      }).success,
    ).toBe(false)
  })

  it('rejects the old single-serviceHost shape (a string, not an array)', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 'person@example.com',
        serviceHost: 'swole.lilnas.io',
      }).success,
    ).toBe(false)
  })

  // S3's other fix: normalizeEmail(123 | null | {}) used to 500 — email is
  // now type-checked before it ever reaches normalizeEmail()'s .trim().
  it('rejects a non-string email (number, null, object) rather than letting it reach normalizeEmail()', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 123,
        serviceHosts: ['swole.lilnas.io'],
      }).success,
    ).toBe(false)
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: null,
        serviceHosts: ['swole.lilnas.io'],
      }).success,
    ).toBe(false)
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: {},
        serviceHosts: ['swole.lilnas.io'],
      }).success,
    ).toBe(false)
  })
})

describe('SetUserServicesBodySchema', () => {
  it('accepts a single change with a real boolean grant value', () => {
    expect(
      SetUserServicesBodySchema.safeParse({
        changes: [{ serviceHost: 'swole.lilnas.io', grant: true }],
      }).success,
    ).toBe(true)
    expect(
      SetUserServicesBodySchema.safeParse({
        changes: [{ serviceHost: 'swole.lilnas.io', grant: false }],
      }).success,
    ).toBe(true)
  })

  // M3: the whole point of batching — one request can carry a grant AND a
  // revoke (or any mix) for the same user in one call.
  it('accepts multiple changes, mixing grants and revokes, in one request', () => {
    expect(
      SetUserServicesBodySchema.safeParse({
        changes: [
          { serviceHost: 'swole.lilnas.io', grant: true },
          { serviceHost: 'tdr.lilnas.io', grant: false },
        ],
      }).success,
    ).toBe(true)
  })

  // The actual bug this schema fixes: admin.controller.ts's setUserService()
  // used to do `if (body.grant)`, and a JSON body of `{"grant": "false"}`
  // deserializes `grant` to the STRING "false" — a non-empty string, so the
  // old truthy check silently granted when the caller meant to revoke.
  // z.boolean() rejects the string outright instead of coercing/truthily
  // testing it. Still enforced per-entry now that grant lives inside the
  // changes array.
  it('rejects the string "false" (and "true") for any entry\'s grant, closing the truthy-string bug', () => {
    expect(
      SetUserServicesBodySchema.safeParse({
        changes: [{ serviceHost: 'swole.lilnas.io', grant: 'false' }],
      }).success,
    ).toBe(false)
    expect(
      SetUserServicesBodySchema.safeParse({
        changes: [{ serviceHost: 'swole.lilnas.io', grant: 'true' }],
      }).success,
    ).toBe(false)
  })

  it('rejects a missing grant field on an entry', () => {
    expect(
      SetUserServicesBodySchema.safeParse({
        changes: [{ serviceHost: 'swole.lilnas.io' }],
      }).success,
    ).toBe(false)
  })

  it('rejects an empty serviceHost on an entry', () => {
    expect(
      SetUserServicesBodySchema.safeParse({
        changes: [{ serviceHost: '', grant: true }],
      }).success,
    ).toBe(false)
  })

  it('rejects an empty changes array', () => {
    expect(SetUserServicesBodySchema.safeParse({ changes: [] }).success).toBe(
      false,
    )
  })

  it('rejects the old single-change shape (serviceHost/grant at the top level, not inside changes)', () => {
    expect(
      SetUserServicesBodySchema.safeParse({
        serviceHost: 'swole.lilnas.io',
        grant: true,
      }).success,
    ).toBe(false)
  })
})

describe('LinkDiscordBodySchema', () => {
  // String literals throughout: a Discord snowflake exceeds
  // Number.MAX_SAFE_INTEGER, so a numeric literal here would be both a lint
  // error and a silently different account.
  it('accepts a userId and an 18-digit snowflake', () => {
    expect(
      LinkDiscordBodySchema.safeParse({
        userId: 'user_1',
        discordUserId: '111111111111111111',
      }).success,
    ).toBe(true)
  })

  it('accepts the 17- and 20-digit bounds of the snowflake range', () => {
    expect(
      LinkDiscordBodySchema.safeParse({
        userId: 'user_1',
        discordUserId: '11111111111111111',
      }).success,
    ).toBe(true)
    expect(
      LinkDiscordBodySchema.safeParse({
        userId: 'user_1',
        discordUserId: '11111111111111111111',
      }).success,
    ).toBe(true)
  })

  it('rejects a snowflake outside that digit range', () => {
    expect(
      LinkDiscordBodySchema.safeParse({
        userId: 'user_1',
        discordUserId: '1234567890123456',
      }).success,
    ).toBe(false)
    expect(
      LinkDiscordBodySchema.safeParse({
        userId: 'user_1',
        discordUserId: '111111111111111111111',
      }).success,
    ).toBe(false)
  })

  // What the pattern is really for: a hand-typed HANDLE is the mistake the
  // two-table schema exists to prevent, and it never even reaches the
  // service.
  it('rejects a Discord handle in the snowflake slot', () => {
    expect(
      LinkDiscordBodySchema.safeParse({
        userId: 'user_1',
        discordUserId: 'ada',
      }).success,
    ).toBe(false)
    expect(
      LinkDiscordBodySchema.safeParse({
        userId: 'user_1',
        discordUserId: 'ada#1234',
      }).success,
    ).toBe(false)
  })

  // Built through Number() rather than written as a numeric literal: the
  // literal form is itself an eslint error (no-loss-of-precision), which is
  // precisely the hazard this assertion exists to keep out of the wire
  // format — a snowflake that arrives as JSON number has ALREADY been
  // rounded by JSON.parse before any schema sees it.
  it('rejects a numeric snowflake — it must stay a string end to end', () => {
    expect(
      LinkDiscordBodySchema.safeParse({
        userId: 'user_1',
        discordUserId: Number('111111111111111111'),
      }).success,
    ).toBe(false)
  })

  it('rejects an empty userId, a missing userId, and a non-object body', () => {
    expect(
      LinkDiscordBodySchema.safeParse({
        userId: '',
        discordUserId: '111111111111111111',
      }).success,
    ).toBe(false)
    expect(
      LinkDiscordBodySchema.safeParse({ discordUserId: '111111111111111111' })
        .success,
    ).toBe(false)
    expect(LinkDiscordBodySchema.safeParse(null).success).toBe(false)
  })

  // A handle is NEVER admin-entered — see the schema's own comment. An
  // extra field is stripped by zod rather than carried through, so no call
  // site can ever read one.
  it('strips any username a caller tries to send', () => {
    const parsed = LinkDiscordBodySchema.safeParse({
      userId: 'user_1',
      discordUserId: '111111111111111111',
      username: 'typed-by-hand',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({
      userId: 'user_1',
      discordUserId: '111111111111111111',
    })
  })

  it("surfaces a human-readable message for a bad snowflake, not zod's raw regex text", () => {
    const parsed = LinkDiscordBodySchema.safeParse({
      userId: 'user_1',
      discordUserId: 'ada',
    })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues[0]?.message).toBe(
      'discordUserId must be a Discord snowflake (17-20 digits)',
    )
  })
})

describe('UnlinkDiscordBodySchema', () => {
  it('accepts a bare userId', () => {
    expect(
      UnlinkDiscordBodySchema.safeParse({ userId: 'user_1' }).success,
    ).toBe(true)
  })

  it('rejects an empty or missing userId', () => {
    expect(UnlinkDiscordBodySchema.safeParse({ userId: '' }).success).toBe(
      false,
    )
    expect(UnlinkDiscordBodySchema.safeParse({}).success).toBe(false)
  })
})
