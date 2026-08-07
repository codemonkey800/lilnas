import {
  BulkRejectBodySchema,
  PreAuthorizeBodySchema,
  SetUserServicesBodySchema,
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
