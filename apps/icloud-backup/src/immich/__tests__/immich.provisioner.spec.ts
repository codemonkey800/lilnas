import { Logger } from '@nestjs/common'

import { ImmichClient } from 'src/immich/immich.client'
import { ImmichError } from 'src/immich/immich.errors'
import { ImmichProvisioner } from 'src/immich/immich.provisioner'

import { API_KEY, FakeImmich, only } from './helpers/fake-immich'

const IMPORT_ROOT = '/icloud-users'
const PATH = `${IMPORT_ROOT}/alice`

describe('ImmichProvisioner', () => {
  const fake = new FakeImmich()
  let provisioner: ImmichProvisioner
  const logSpies: jest.SpyInstance[] = []

  beforeAll(() => fake.start())
  afterAll(() => fake.stop())
  beforeEach(() => {
    fake.reset()
    const options = {
      baseUrl: fake.url,
      apiKey: API_KEY,
      importRoot: IMPORT_ROOT,
      timeoutMs: 2000,
    }
    provisioner = new ImmichProvisioner(new ImmichClient(options), options)
    logSpies.length = 0
    for (const level of [
      'log',
      'warn',
      'error',
      'debug',
      'verbose',
      'fatal',
    ] as const) {
      logSpies.push(jest.spyOn(Logger.prototype, level).mockImplementation())
    }
  })

  const creates = () => [
    ...fake.calls('POST', '/api/admin/users'),
    ...fake.calls('POST', '/api/libraries'),
  ]

  describe('ensure', () => {
    it('creates the user, the library, validates and scans', async () => {
      const result = await provisioner.ensure({
        email: 'alice@example.com',
        slug: 'alice',
      })

      expect(fake.users).toHaveLength(1)
      expect(fake.libraries).toHaveLength(1)
      expect(result).toEqual({
        userId: only(fake.users).id,
        libraryId: only(fake.libraries).id,
        email: 'alice@example.com',
        createdByUs: true,
      })
      expect(only(fake.libraries)).toMatchObject({
        ownerId: only(fake.users).id,
        name: 'iCloud',
        importPaths: [PATH],
      })
      expect(
        fake.calls('POST', `/api/libraries/${result.libraryId}/validate`),
      ).toHaveLength(1)
      expect(fake.scans).toEqual([result.libraryId])

      // A random 32-character password, with the change forced and no mail.
      const body = only(fake.calls('POST', '/api/admin/users')).body as {
        password: string
        shouldChangePassword: boolean
        notify: boolean
      }
      expect(body.password).toHaveLength(32)
      expect(body.shouldChangePassword).toBe(true)
      expect(body.notify).toBe(false)
    })

    it('reuses an existing user without creating one', async () => {
      fake.users.push({ id: 'u-1', email: 'alice@example.com', name: 'Alice' })
      fake.libraries.length = 0
      only(fake.users).id = 'b1b1b1b1-0000-4000-8000-000000000001'

      const result = await provisioner.ensure({
        email: 'alice@example.com',
        slug: 'alice',
      })

      expect(fake.calls('POST', '/api/admin/users')).toHaveLength(0)
      expect(result.createdByUs).toBe(false)
      expect(result.userId).toBe(only(fake.users).id)
      expect(fake.libraries).toHaveLength(1)
    })

    it('matches the email regardless of case', async () => {
      fake.users.push({
        id: 'b1b1b1b1-0000-4000-8000-000000000002',
        email: 'Alice@Example.com',
        name: 'Alice',
      })

      const result = await provisioner.ensure({
        email: 'alice@example.com',
        slug: 'alice',
      })

      expect(fake.calls('POST', '/api/admin/users')).toHaveLength(0)
      expect(fake.users).toHaveLength(1)
      expect(result).toMatchObject({
        createdByUs: false,
        email: 'Alice@Example.com',
      })
    })

    it('reuses a library on the path, whatever its name', async () => {
      const id = 'b1b1b1b1-0000-4000-8000-000000000003'
      fake.users.push({ id, email: 'alice@example.com', name: 'Alice' })
      fake.libraries.push({
        id: 'lib-existing',
        ownerId: id,
        name: 'Something else',
        importPaths: [PATH],
      })

      const result = await provisioner.ensure({
        email: 'alice@example.com',
        slug: 'alice',
      })

      expect(fake.calls('POST', '/api/libraries')).toHaveLength(0)
      expect(fake.libraries).toHaveLength(1)
      expect(result.libraryId).toBe('lib-existing')
      expect(fake.scans).toEqual(['lib-existing'])
    })

    it('refuses a path another user already has a library on', async () => {
      const bob = 'b1b1b1b1-0000-4000-8000-000000000004'
      fake.users.push({ id: bob, email: 'bob@example.com', name: 'Bob' })
      fake.libraries.push({
        id: 'bobs-lib',
        ownerId: bob,
        name: 'Bob photos',
        importPaths: [PATH],
      })

      await expect(
        provisioner.ensure({ email: 'alice@example.com', slug: 'alice' }),
      ).rejects.toMatchObject({
        name: 'ImmichError',
        code: 'import_path_taken',
      })

      expect(creates()).toHaveLength(0)
      expect(fake.scans).toHaveLength(0)
    })

    it('refuses the taken path for an existing user too', async () => {
      const alice = 'b1b1b1b1-0000-4000-8000-000000000005'
      const bob = 'b1b1b1b1-0000-4000-8000-000000000006'
      fake.users.push(
        { id: alice, email: 'alice@example.com', name: 'Alice' },
        { id: bob, email: 'bob@example.com', name: 'Bob' },
      )
      fake.libraries.push({
        id: 'bobs-lib',
        ownerId: bob,
        name: 'iCloud',
        importPaths: [PATH],
      })

      await expect(
        provisioner.ensure({ email: 'alice@example.com', slug: 'alice' }),
      ).rejects.toBeInstanceOf(ImmichError)
      expect(creates()).toHaveLength(0)
    })

    it('throws import_path_invalid when Immich cannot read the path', async () => {
      fake.invalidPaths.add(PATH)

      const error = await provisioner
        .ensure({ email: 'alice@example.com', slug: 'alice' })
        .then(
          () => undefined,
          (e: unknown) => e,
        )

      expect(error).toBeInstanceOf(ImmichError)
      expect(error).toMatchObject({ code: 'import_path_invalid' })
      expect(fake.scans).toHaveLength(0)
    })

    it('creates one user and one library when called twice', async () => {
      const first = await provisioner.ensure({
        email: 'alice@example.com',
        slug: 'alice',
      })
      const second = await provisioner.ensure({
        email: 'alice@example.com',
        slug: 'alice',
      })

      expect(fake.users).toHaveLength(1)
      expect(fake.libraries).toHaveLength(1)
      expect(first.createdByUs).toBe(true)
      expect(second.createdByUs).toBe(false)
      expect(second.libraryId).toBe(first.libraryId)
      expect(fake.scans).toHaveLength(2)
    })

    it('picks up where a crash left off', async () => {
      // The user was created, then the process died before the library.
      await provisioner.ensure({ email: 'alice@example.com', slug: 'alice' })
      fake.libraries.length = 0
      fake.requests.length = 0

      const result = await provisioner.ensure({
        email: 'alice@example.com',
        slug: 'alice',
      })

      expect(fake.calls('POST', '/api/admin/users')).toHaveLength(0)
      expect(fake.libraries).toHaveLength(1)
      expect(result.libraryId).toBe(only(fake.libraries).id)
    })
  })

  describe('newTemporaryPassword', () => {
    it('resets the password and returns the same one', async () => {
      const { userId } = await provisioner.ensure({
        email: 'alice@example.com',
        slug: 'alice',
      })

      const password = await provisioner.newTemporaryPassword(userId)

      expect(password).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789]{20}$/,
      )
      const put = fake.calls('PUT', `/api/admin/users/${userId}`)
      expect(put).toHaveLength(1)
      expect(only(put).body).toEqual({
        password,
        shouldChangePassword: true,
      })
      expect(only(fake.users).password).toBe(password)
    })

    it('gives a different password each time', async () => {
      const { userId } = await provisioner.ensure({
        email: 'alice@example.com',
        slug: 'alice',
      })

      const a = await provisioner.newTemporaryPassword(userId)
      const b = await provisioner.newTemporaryPassword(userId)

      expect(a).not.toBe(b)
    })
  })

  it('never logs a password', async () => {
    const { userId } = await provisioner.ensure({
      email: 'alice@example.com',
      slug: 'alice',
    })
    const temporary = await provisioner.newTemporaryPassword(userId)
    const generated = (
      only(fake.calls('POST', '/api/admin/users')).body as { password: string }
    ).password

    const logged = JSON.stringify(logSpies.flatMap(spy => spy.mock.calls))
    expect(logSpies.some(spy => spy.mock.calls.length > 0)).toBe(true)
    expect(logged).not.toContain(temporary)
    expect(logged).not.toContain(generated)
    expect(logged).not.toContain(API_KEY)
  })
})
