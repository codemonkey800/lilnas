/**
 * Live contract check of src/immich against a throwaway Immich v3.3.4.
 *
 *   pnpm exec tsx --tsconfig apps/icloud-backup/tsconfig.json apps/icloud-backup/scripts/immich-contract/run.ts
 *
 * Creates a temp folder with alice/ (three JPEGs made by ffmpeg) and an empty
 * admin/, starts scripts/immich-contract/compose.yml as project
 * `icloud-backup-immich-test`, runs every step, then always tears the project
 * down (`down -v`) and deletes the temp folder. It talks to the server by its
 * container IP and refuses anything that looks like the production host.
 * Nothing secret is printed: only ids, statuses and counts.
 */
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { Logger } from '@nestjs/common'

import { ImmichClient } from '../../src/immich/immich.client'
import { ImmichError } from '../../src/immich/immich.errors'
import { ImmichProvisioner } from '../../src/immich/immich.provisioner'
import type { ImmichOptions } from '../../src/immich/immich.types'

const run = promisify(execFile)

const PROJECT = 'icloud-backup-immich-test'
const COMPOSE_FILE = join(__dirname, 'compose.yml')
const PORT = 2283
const IMPORT_ROOT = '/icloud-users'
const EXACT_PERMISSIONS = [
  'adminUser.create',
  'adminUser.read',
  'adminUser.update',
  'library.create',
  'library.read',
  'library.update',
  'library.statistics',
]
// Diagnostic only: `--with-all` adds `all` to the key, to see which later steps
// work once POST /libraries/:id/validate (which accepts no narrower
// permission in v3.3.4) is allowed. Production's key must not have it.
const WITH_ALL = process.argv.includes('--with-all')
const PERMISSIONS = WITH_ALL ? [...EXACT_PERMISSIONS, 'all'] : EXACT_PERMISSIONS
const PING_TIMEOUT_MS = 240_000
const ASSETS_TIMEOUT_MS = 120_000

const ADMIN_EMAIL = 'admin@immich-contract.test'
const ALICE_EMAIL = 'alice@immich-contract.test'
// Test-only credentials for a server that lives for a few minutes.
const ADMIN_PASSWORD = randomBytes(18).toString('base64url')

let failures = 0

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const out = await fn()
    console.log(`PASS  ${name}`)
    return out
  } catch (err) {
    failures++
    const message = err instanceof Error ? err.message : String(err)
    console.log(`FAIL  ${name}: ${message}`)
    return null
  }
}

function note(text: string): void {
  console.log(`      ${text}`)
}

function expect(cond: boolean, message: string): void {
  if (!cond) throw new Error(message)
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Every compose call needs the variable, even `ps` and `down`.
let usersDir = ''

async function compose(args: string[]): Promise<string> {
  const { stdout } = await run(
    'docker',
    ['compose', '-p', PROJECT, '-f', COMPOSE_FILE, ...args],
    { env: { ...process.env, ICLOUD_USERS_DIR: usersDir } },
  )
  return stdout
}

async function makeFolders(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'icloud-users-'))
  await chmod(dir, 0o755)
  await mkdir(join(dir, 'alice'), { mode: 0o755 })
  await mkdir(join(dir, 'admin'), { mode: 0o755 })
  const sources = ['testsrc', 'testsrc2', 'smptebars']
  for (const [i, src] of sources.entries()) {
    await run('ffmpeg', [
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `${src}=size=320x240:rate=1`,
      '-frames:v',
      '1',
      '-y',
      join(dir, 'alice', `photo-${i + 1}.jpg`),
    ])
  }
  return dir
}

async function containerIp(): Promise<string> {
  const id = (await compose(['ps', '-q', 'immich'])).trim()
  expect(id !== '', 'immich container is not running')
  const { stdout } = await run('docker', [
    'inspect',
    '-f',
    '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
    id,
  ])
  const ip = stdout.trim()
  expect(/^\d+\.\d+\.\d+\.\d+$/.test(ip), 'no container IP')
  return ip
}

async function json(
  base: string,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${base}/api${path}`, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(init.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null) {
      body = parsed as Record<string, unknown>
    }
  } catch {
    // leave empty
  }
  return { status: res.status, body }
}

async function login(
  base: string,
  email: string,
  password: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return json(base, '/auth/login', {
    method: 'POST',
    body: { email, password },
  })
}

async function waitForPing(base: string): Promise<number> {
  const start = Date.now()
  while (Date.now() - start < PING_TIMEOUT_MS) {
    try {
      const { status, body } = await json(base, '/server/ping', {})
      if (status === 200 && body.res === 'pong') return Date.now() - start
    } catch {
      // not up yet
    }
    await sleep(3000)
  }
  throw new Error(`no pong within ${PING_TIMEOUT_MS / 1000} s`)
}

async function waitForAssets(
  base: string,
  libraryId: string,
  apiKey: string,
  want: number,
): Promise<{ total: number; ms: number }> {
  const start = Date.now()
  let total = 0
  while (Date.now() - start < ASSETS_TIMEOUT_MS) {
    const { status, body } = await json(
      base,
      `/libraries/${libraryId}/statistics`,
      { headers: { 'x-api-key': apiKey } },
    )
    expect(status === 200, `statistics returned ${status}`)
    total = typeof body.total === 'number' ? body.total : 0
    if (total >= want) return { total, ms: Date.now() - start }
    await sleep(3000)
  }
  throw new Error(`only ${total}/${want} assets after ${ASSETS_TIMEOUT_MS} ms`)
}

async function main(): Promise<void> {
  Logger.overrideLogger(['warn', 'error'])
  const dir = await makeFolders()
  usersDir = dir
  console.log(`temp folder ${dir}`)
  try {
    await compose(['up', '-d'])
    const ip = await containerIp()
    const base = `http://${ip}:${PORT}`
    expect(!/immich(:|$)/.test(new URL(base).hostname), 'refusing prod host')
    console.log(`server ${base}`)

    const ping = await step('GET /api/server/ping answers pong', async () => {
      const ms = await waitForPing(base)
      note(`pong after ${Math.round(ms / 1000)} s`)
      return ms
    })
    if (ping === null) return

    const key = await step('admin sign-up, login, API key', async () => {
      const signUp = await json(base, '/auth/admin-sign-up', {
        method: 'POST',
        body: { email: ADMIN_EMAIL, name: 'Admin', password: ADMIN_PASSWORD },
      })
      expect(signUp.status === 201, `admin-sign-up returned ${signUp.status}`)
      const li = await login(base, ADMIN_EMAIL, ADMIN_PASSWORD)
      expect(li.status === 201, `login returned ${li.status}`)
      const token = String(li.body.accessToken ?? '')
      expect(token !== '', 'no accessToken')
      const created = await json(base, '/api-keys', {
        method: 'POST',
        body: { name: 'icloud-backup-contract', permissions: PERMISSIONS },
        headers: { authorization: `Bearer ${token}` },
      })
      expect(created.status === 201, `api-keys returned ${created.status}`)
      const secret = String(created.body.secret ?? '')
      expect(secret !== '', 'no key secret')
      note(`admin user id ${String(li.body.userId)}`)
      note(`key permissions: ${PERMISSIONS.join(', ')}`)
      return { apiKey: secret, adminId: String(li.body.userId) }
    })
    if (key === null) return

    const options: ImmichOptions = {
      baseUrl: base,
      apiKey: key.apiKey,
      importRoot: IMPORT_ROOT,
      timeoutMs: 30_000,
    }
    const client = new ImmichClient(options)
    const provisioner = new ImmichProvisioner(client, options)

    const first = await step(
      'ensure({ alice }) creates a user and a library',
      async () => {
        const r = await provisioner.ensure({
          email: ALICE_EMAIL,
          slug: 'alice',
        })
        expect(r.createdByUs, 'createdByUs is false')
        const users = await client.listUsers()
        const libs = await client.listLibraries()
        expect(
          users.some(u => u.id === r.userId),
          'user not listed',
        )
        const lib = libs.find(l => l.id === r.libraryId)
        expect(lib?.ownerId === r.userId, 'library not owned by alice')
        expect(
          lib?.importPaths.join() === `${IMPORT_ROOT}/alice`,
          `importPaths ${lib?.importPaths.join()}`,
        )
        note(
          `user ${r.userId}, library ${r.libraryId}, createdByUs ${r.createdByUs}`,
        )
        note(`users ${users.length}, libraries ${libs.length}`)
        return { ...r, users: users.length, libs: libs.length }
      },
    )

    if (first) {
      await step('second ensure({ alice }) creates nothing', async () => {
        const r = await provisioner.ensure({
          email: ALICE_EMAIL,
          slug: 'alice',
        })
        const users = await client.listUsers()
        const libs = await client.listLibraries()
        expect(!r.createdByUs, 'createdByUs is true')
        expect(r.userId === first.userId, 'different user id')
        expect(r.libraryId === first.libraryId, 'different library id')
        expect(users.length === first.users, `users ${users.length}`)
        expect(libs.length === first.libs, `libraries ${libs.length}`)
        note(`same ids; users ${users.length}, libraries ${libs.length}`)
      })

      await step('validateLibrary says the import path is valid', async () => {
        const v = await client.validateLibrary(
          first.libraryId,
          `${IMPORT_ROOT}/alice`,
        )
        expect(v.isValid, `invalid: ${v.message ?? ''}`)
        note(`isValid ${v.isValid}`)
      })

      await step('statistics reach 3 assets after the scan', async () => {
        const r = await waitForAssets(base, first.libraryId, key.apiKey, 3)
        note(`${r.total} assets after ${Math.round(r.ms / 1000)} s`)
      })
    }

    if (!WITH_ALL) {
      // The exact list cannot get through validate, so exercise the other
      // routes directly to show which ones it does cover.
      await step('exact list: scan, statistics, password reset', async () => {
        const [lib] = await client.listLibraries()
        const [user] = (await client.listUsers()).filter(
          u => u.id !== key.adminId,
        )
        expect(!!lib && !!user, 'nothing to exercise')
        await client.scanLibrary(lib.id)
        const stats = await json(base, `/libraries/${lib.id}/statistics`, {
          headers: { 'x-api-key': key.apiKey },
        })
        expect(stats.status === 200, `statistics ${stats.status}`)
        await client.resetPassword(user.id, randomBytes(12).toString('hex'))
        note('scan, statistics and PUT /admin/users/:id all succeeded')
      })
    }

    await step(
      'ensure for a slug with no folder throws import_path_invalid',
      async () => {
        try {
          await provisioner.ensure({
            email: 'nobody@immich-contract.test',
            slug: 'missing',
          })
        } catch (err) {
          expect(err instanceof ImmichError, 'not an ImmichError')
          const e = err as ImmichError
          expect(e.code === 'import_path_invalid', `code ${e.code}`)
          note(`code ${e.code}; message: ${e.message}`)
          return
        }
        throw new Error('did not throw')
      },
    )

    if (first) {
      await step(
        'newTemporaryPassword logs in and demands a password change',
        async () => {
          const password = await provisioner.newTemporaryPassword(first.userId)
          const li = await login(base, ALICE_EMAIL, password)
          expect(li.status === 201, `login returned ${li.status}`)
          expect(
            li.body.shouldChangePassword === true,
            `shouldChangePassword ${String(li.body.shouldChangePassword)}`,
          )
          note(
            `login ${li.status}, shouldChangePassword ${String(li.body.shouldChangePassword)}`,
          )
        },
      )
    }

    await step(
      "ensure with the admin's own email reuses that user",
      async () => {
        const r = await provisioner.ensure({
          email: ADMIN_EMAIL,
          slug: 'admin',
        })
        expect(!r.createdByUs, 'createdByUs is true')
        expect(r.userId === key.adminId, 'not the admin user')
        note(
          `userId matches admin, createdByUs ${r.createdByUs}, library ${r.libraryId}`,
        )
      },
    )

    await step(
      'extra: admin email on alice slug throws import_path_taken',
      async () => {
        try {
          await provisioner.ensure({ email: ADMIN_EMAIL, slug: 'alice' })
        } catch (err) {
          const code = err instanceof ImmichError ? err.code : 'other'
          expect(code === 'import_path_taken', `code ${code}`)
          note(`code ${code}`)
          return
        }
        throw new Error('did not throw')
      },
    )
  } finally {
    await compose(['down', '-v']).catch(e =>
      console.log(`teardown: compose down failed: ${String(e)}`),
    )
    await rm(dir, { recursive: true, force: true })
    console.log(`removed ${dir} and project ${PROJECT}`)
  }
}

main()
  .then(() => {
    console.log(
      failures === 0 ? 'ALL STEPS PASSED' : `${failures} STEP(S) FAILED`,
    )
    process.exitCode = failures === 0 ? 0 : 1
  })
  .catch(err => {
    console.log(`ABORTED: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
