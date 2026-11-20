import { ImmichClient } from 'src/immich/immich.client'
import { ImmichError } from 'src/immich/immich.errors'

import { API_KEY, FakeImmich, only } from './helpers/fake-immich'

describe('ImmichClient', () => {
  const fake = new FakeImmich()
  let client: ImmichClient

  beforeAll(() => fake.start())
  afterAll(() => fake.stop())
  beforeEach(() => {
    fake.reset()
    client = new ImmichClient({
      baseUrl: fake.url,
      apiKey: API_KEY,
      importRoot: '/icloud-users',
      timeoutMs: 500,
    })
  })

  const last = () => only(fake.requests.slice(-1))

  it('listUsers sends GET /api/admin/users with the key', async () => {
    fake.users.push({ id: 'u1', email: 'a@b.c', name: 'A', password: 'x' })

    await expect(client.listUsers()).resolves.toEqual([
      { id: 'u1', email: 'a@b.c', name: 'A' },
    ])
    expect(last().method).toBe('GET')
    expect(last().path).toBe('/api/admin/users')
    expect(last().headers['x-api-key']).toBe(API_KEY)
  })

  it('createUser posts the fixed flags', async () => {
    const user = await client.createUser({
      email: 'a@b.c',
      name: 'A',
      password: 'pw-123456',
    })

    expect(user).toMatchObject({ email: 'a@b.c', name: 'A' })
    expect(last().method).toBe('POST')
    expect(last().path).toBe('/api/admin/users')
    expect(last().headers['x-api-key']).toBe(API_KEY)
    expect(last().headers['content-type']).toBe('application/json')
    expect(last().body).toEqual({
      email: 'a@b.c',
      password: 'pw-123456',
      name: 'A',
      shouldChangePassword: true,
      notify: false,
    })
  })

  it('resetPassword puts the password and forces a change', async () => {
    const user = await client.createUser({
      email: 'a@b.c',
      name: 'A',
      password: 'old-password',
    })

    await client.resetPassword(user.id, 'new-password')

    expect(last().method).toBe('PUT')
    expect(last().path).toBe(`/api/admin/users/${user.id}`)
    expect(last().headers['x-api-key']).toBe(API_KEY)
    expect(last().body).toEqual({
      password: 'new-password',
      shouldChangePassword: true,
    })
  })

  it('listLibraries sends GET /api/libraries', async () => {
    const user = await client.createUser({
      email: 'a@b.c',
      name: 'A',
      password: 'pw-123456',
    })
    fake.libraries.push({
      id: 'l1',
      ownerId: user.id,
      name: 'iCloud',
      importPaths: ['/icloud-users/a'],
    })

    await expect(client.listLibraries()).resolves.toEqual(fake.libraries)
    expect(last().method).toBe('GET')
    expect(last().path).toBe('/api/libraries')
    expect(last().headers['x-api-key']).toBe(API_KEY)
  })

  it('createLibrary posts one import path', async () => {
    const user = await client.createUser({
      email: 'a@b.c',
      name: 'A',
      password: 'pw-123456',
    })

    const library = await client.createLibrary({
      ownerId: user.id,
      name: 'iCloud',
      importPath: '/icloud-users/a',
    })

    expect(library.importPaths).toEqual(['/icloud-users/a'])
    expect(last().method).toBe('POST')
    expect(last().path).toBe('/api/libraries')
    expect(last().headers['x-api-key']).toBe(API_KEY)
    expect(last().body).toEqual({
      ownerId: user.id,
      name: 'iCloud',
      importPaths: ['/icloud-users/a'],
    })
  })

  it('validateLibrary posts the path and unwraps the result', async () => {
    fake.invalidPaths.add('/icloud-users/bad')

    await expect(
      client.validateLibrary('lib-1', '/icloud-users/ok'),
    ).resolves.toEqual({ isValid: true })
    expect(last().method).toBe('POST')
    expect(last().path).toBe('/api/libraries/lib-1/validate')
    expect(last().headers['x-api-key']).toBe(API_KEY)
    expect(last().body).toEqual({ importPaths: ['/icloud-users/ok'] })

    await expect(
      client.validateLibrary('lib-1', '/icloud-users/bad'),
    ).resolves.toEqual({ isValid: false, message: 'Path does not exist' })
  })

  it('scanLibrary posts with no body', async () => {
    await client.scanLibrary('lib-1')

    expect(last().method).toBe('POST')
    expect(last().path).toBe('/api/libraries/lib-1/scan')
    expect(last().headers['x-api-key']).toBe(API_KEY)
    expect(last().body).toBeUndefined()
    expect(fake.scans).toEqual(['lib-1'])
  })

  it('turns a 401 into an ImmichError without the key', async () => {
    const bad = new ImmichClient({
      baseUrl: fake.url,
      apiKey: 'wrong-key-value',
      importRoot: '/icloud-users',
    })

    const error = await bad.listUsers().then(
      () => undefined,
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(ImmichError)
    const immichError = error as ImmichError
    expect(immichError.status).toBe(401)
    expect(immichError.message).toContain('401')
    expect(immichError.message).toContain('Invalid API key')
    expect(immichError.message).not.toContain('wrong-key-value')
    expect(immichError.message).not.toContain(API_KEY)
  })

  it('keeps the request body out of an error', async () => {
    const error = await client
      .createLibrary({
        ownerId: 'not-a-user',
        name: 'iCloud',
        importPath: '/icloud-users/secret-folder',
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      )

    expect(error).toBeInstanceOf(ImmichError)
    expect((error as ImmichError).message).toContain('ownerId must be a UUID')
    expect((error as ImmichError).message).not.toContain('secret-folder')
  })

  it('gives up after the timeout', async () => {
    fake.delayMs = 1500

    await expect(client.listUsers()).rejects.toMatchObject({
      name: 'ImmichError',
      code: 'timeout',
    })
  })

  it('refuses to call Immich without a key', async () => {
    const keyless = new ImmichClient({
      baseUrl: fake.url,
      apiKey: '',
      importRoot: '/icloud-users',
    })

    await expect(keyless.listUsers()).rejects.toMatchObject({
      code: 'not_configured',
    })
    expect(fake.requests).toHaveLength(0)
  })
})
