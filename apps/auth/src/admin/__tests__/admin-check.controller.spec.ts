import { AdminCheckController } from 'src/admin/admin-check.controller'

const ORIGINAL_ENV = process.env.ADMIN_EMAILS

describe('AdminCheckController', () => {
  afterEach(() => {
    process.env.ADMIN_EMAILS = ORIGINAL_ENV
  })

  it('returns isAdmin: true for an address on the ADMIN_EMAILS allowlist', () => {
    process.env.ADMIN_EMAILS = 'admin@example.com'

    expect(new AdminCheckController().check('admin@example.com')).toEqual({
      isAdmin: true,
    })
  })

  it('returns isAdmin: false for an address not on the allowlist', () => {
    process.env.ADMIN_EMAILS = 'admin@example.com'

    expect(new AdminCheckController().check('nobody@example.com')).toEqual({
      isAdmin: false,
    })
  })

  it('is case/whitespace-insensitive, matching isAdminEmail()', () => {
    process.env.ADMIN_EMAILS = 'admin@example.com'

    expect(new AdminCheckController().check(' Admin@Example.com ')).toEqual({
      isAdmin: true,
    })
  })

  it('returns isAdmin: false when email is omitted', () => {
    process.env.ADMIN_EMAILS = 'admin@example.com'

    expect(new AdminCheckController().check(undefined)).toEqual({
      isAdmin: false,
    })
  })
})
