import {
  BulkRejectBodySchema,
  PreAuthorizeBodySchema,
  SetUserServiceBodySchema,
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
  it('accepts a valid email and non-empty serviceHost', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 'person@example.com',
        serviceHost: 'swole.lilnas.io',
      }).success,
    ).toBe(true)
  })

  it('rejects a malformed email', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 'not-an-email',
        serviceHost: 'swole.lilnas.io',
      }).success,
    ).toBe(false)
  })

  it('rejects an empty serviceHost', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 'person@example.com',
        serviceHost: '',
      }).success,
    ).toBe(false)
  })

  // S3's other fix: normalizeEmail(123 | null | {}) used to 500 — email is
  // now type-checked before it ever reaches normalizeEmail()'s .trim().
  it('rejects a non-string email (number, null, object) rather than letting it reach normalizeEmail()', () => {
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: 123,
        serviceHost: 'swole.lilnas.io',
      }).success,
    ).toBe(false)
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: null,
        serviceHost: 'swole.lilnas.io',
      }).success,
    ).toBe(false)
    expect(
      PreAuthorizeBodySchema.safeParse({
        email: {},
        serviceHost: 'swole.lilnas.io',
      }).success,
    ).toBe(false)
  })
})

describe('SetUserServiceBodySchema', () => {
  it('accepts a real boolean grant value', () => {
    expect(
      SetUserServiceBodySchema.safeParse({
        serviceHost: 'swole.lilnas.io',
        grant: true,
      }).success,
    ).toBe(true)
    expect(
      SetUserServiceBodySchema.safeParse({
        serviceHost: 'swole.lilnas.io',
        grant: false,
      }).success,
    ).toBe(true)
  })

  // The actual bug this schema fixes: admin.controller.ts's setUserService()
  // used to do `if (body.grant)`, and a JSON body of `{"grant": "false"}`
  // deserializes `grant` to the STRING "false" — a non-empty string, so the
  // old truthy check silently granted when the caller meant to revoke.
  // z.boolean() rejects the string outright instead of coercing/truthily
  // testing it.
  it('rejects the string "false" (and "true") for grant, closing the truthy-string bug', () => {
    expect(
      SetUserServiceBodySchema.safeParse({
        serviceHost: 'swole.lilnas.io',
        grant: 'false',
      }).success,
    ).toBe(false)
    expect(
      SetUserServiceBodySchema.safeParse({
        serviceHost: 'swole.lilnas.io',
        grant: 'true',
      }).success,
    ).toBe(false)
  })

  it('rejects a missing grant field', () => {
    expect(
      SetUserServiceBodySchema.safeParse({ serviceHost: 'swole.lilnas.io' })
        .success,
    ).toBe(false)
  })

  it('rejects an empty serviceHost', () => {
    expect(
      SetUserServiceBodySchema.safeParse({ serviceHost: '', grant: true })
        .success,
    ).toBe(false)
  })
})
