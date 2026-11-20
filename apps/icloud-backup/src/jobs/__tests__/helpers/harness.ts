import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { Logger } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import type { Database } from 'src/db/database'
import { AccountsRepo } from 'src/db/repos/accounts.repo'
import { JobEventsRepo } from 'src/db/repos/job-events.repo'
import { JobsRepo } from 'src/db/repos/jobs.repo'
import { type Account, accounts, jobEvents, jobs } from 'src/db/schema'
import { slugFromEmail } from 'src/db/slug'
import { LogParser } from 'src/icloudpd/log-parser'
import type {
  IcloudpdExit,
  IcloudpdProcess,
  ProcessService,
  SpawnOptions,
} from 'src/icloudpd/process.service'
import type {
  FormStep,
  SubmitResult,
  WebuiClient,
} from 'src/icloudpd/webui.client'
import type { ImmichClient } from 'src/immich/immich.client'
import type {
  EnsuredImmichAccount,
  ImmichProvisioner,
} from 'src/immich/immich.provisioner'
import { JobsService } from 'src/jobs/jobs.service'
import type { Clock, JobUser } from 'src/jobs/jobs.types'
import type { BackupState, BackupView } from 'src/shared/contract'

export const PASSWORD = 'hunter2-Secret!pw'
export const CODE = '482913'
export const TEMP_PASSWORD = 'Temp-Immich-Pass-1'

export const alice: JobUser = {
  email: 'alice@example.com',
  userId: 'user-alice',
  isAdmin: false,
}
export const bob: JobUser = {
  email: 'bob@example.com',
  userId: 'user-bob',
  isAdmin: false,
}
export const carol: JobUser = {
  email: 'carol@example.com',
  userId: 'user-carol',
  isAdmin: false,
}

export const APPLE = {
  alice: 'alice.icloud@example.com',
  bob: 'bob.icloud@example.com',
  carol: 'carol.icloud@example.com',
}

/** Lets promise chains and the database catch up. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>(resolve => setImmediate(resolve))
  }
}

export async function until(
  check: () => Promise<boolean> | boolean,
  what: string,
  timeoutMs = 4000,
): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await check()) return
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${what}`)
    }
    await new Promise<void>(resolve => setTimeout(resolve, 2))
  }
}

// --- clock ---

export class FakeClock implements Clock {
  private time = 1_700_000_000_000
  private seq = 0
  private readonly timers = new Map<
    number,
    { at: number; fn: () => void; every: number | null }
  >()

  now(): number {
    return this.time
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq
    this.timers.set(id, { at: this.time + ms, fn, every: null })
    return id
  }

  setInterval(fn: () => void, ms: number): unknown {
    const id = ++this.seq
    this.timers.set(id, { at: this.time + ms, fn, every: ms })
    return id
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === 'number') this.timers.delete(handle)
  }

  clearInterval(handle: unknown): void {
    this.clearTimeout(handle)
  }

  get pending(): number {
    return this.timers.size
  }

  /** Moves time forward, firing due timers in order and letting work run. */
  async advance(ms: number): Promise<void> {
    const target = this.time + ms
    for (;;) {
      let nextId: number | null = null
      let nextAt = Number.POSITIVE_INFINITY
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextId = id
          nextAt = timer.at
        }
      }
      if (nextId === null) break
      const timer = this.timers.get(nextId)
      if (!timer) break
      this.time = Math.max(this.time, timer.at)
      if (timer.every === null) this.timers.delete(nextId)
      else timer.at += timer.every
      timer.fn()
      await settle(3)
    }
    this.time = target
    await settle(3)
  }
}

// --- icloudpd ---

export class FakeProc implements IcloudpdProcess {
  readonly pid: number
  readonly exited: Promise<IcloudpdExit>
  stopCalls = 0
  finished = false
  private resolveExit: (exit: IcloudpdExit) => void = () => undefined

  constructor(
    pid: number,
    readonly args: string[],
    private readonly onLine: (line: string) => void,
  ) {
    this.pid = pid
    this.exited = new Promise<IcloudpdExit>(resolve => {
      this.resolveExit = resolve
    })
  }

  get isAuth(): boolean {
    return this.args.includes('--auth-only')
  }

  emit(...lines: string[]): void {
    for (const line of lines) this.onLine(line)
  }

  exit(code: number | null = 0, signal: string | null = null): void {
    if (this.finished) return
    this.finished = true
    this.resolveExit({ code, signal })
  }

  async stop(): Promise<void> {
    if (this.finished) return
    this.stopCalls++
    this.exit(null, 'SIGTERM')
  }
}

export class FakeProcessService {
  readonly procs: FakeProc[] = []
  failNext = false

  spawnIcloudpd(args: string[], opts: SpawnOptions): IcloudpdProcess {
    if (this.failNext) {
      this.failNext = false
      throw new Error('could not start icloudpd at /nowhere')
    }
    const proc = new FakeProc(1000 + this.procs.length, args, opts.onLine)
    this.procs.push(proc)
    return proc
  }

  get auth(): FakeProc[] {
    return this.procs.filter(p => p.isAuth)
  }

  get downloads(): FakeProc[] {
    return this.procs.filter(p => !p.isAuth)
  }
}

export class FakeWebui {
  step: FormStep = { step: 'unreachable' }
  readonly received: Array<{ kind: 'password' | 'code'; value: string }> = []
  /** Forces the answer of the next relay. */
  nextResult: SubmitResult | null = null

  async getStep(): Promise<FormStep> {
    return this.step
  }

  async submitPassword(value: string): Promise<SubmitResult> {
    return this.relay('need_password', 'password', value)
  }

  async submitCode(value: string): Promise<SubmitResult> {
    return this.relay('need_code', 'code', value)
  }

  async cancel(): Promise<void> {
    // nothing
  }

  private relay(
    expected: FormStep['step'],
    kind: 'password' | 'code',
    value: string,
  ): SubmitResult {
    if (this.step.step !== expected) return 'wrong_step'
    this.received.push({ kind, value })
    const result = this.nextResult ?? 'accepted'
    this.nextResult = null
    return result
  }
}

// --- immich ---

export class FakeProvisioner {
  readonly ensured: Array<{ email: string; slug: string }> = []
  readonly resets: string[] = []
  link: EnsuredImmichAccount = {
    userId: 'immich-user-1',
    libraryId: 'immich-library-1',
    email: 'alice@example.com',
    createdByUs: true,
  }
  failWith: Error | null = null
  /** When set, `ensure` waits for it: holds a job in `provisioning`. */
  hold: Promise<void> | null = null

  async ensure(input: {
    email: string
    slug: string
  }): Promise<EnsuredImmichAccount> {
    this.ensured.push(input)
    if (this.hold) await this.hold
    if (this.failWith) throw this.failWith
    return { ...this.link, email: input.email }
  }

  async newTemporaryPassword(userId: string): Promise<string> {
    this.resets.push(userId)
    return TEMP_PASSWORD
  }
}

export class FakeImmichClient {
  readonly scans: string[] = []
  failWith: Error | null = null

  async scanLibrary(id: string): Promise<void> {
    this.scans.push(id)
    if (this.failWith) throw this.failWith
  }
}

// --- logs ---

/** Captures every Nest Logger call so a spec can search them. */
export function captureLogs(): () => string {
  const spies = (
    ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const
  ).map(level => jest.spyOn(Logger.prototype, level).mockImplementation())
  return () => JSON.stringify(spies.map(spy => spy.mock.calls))
}

// --- the harness ---

const ENV_KEYS = [
  'PHOTOS_ROOT',
  'STATE_ROOT',
  'MIN_FREE_BYTES',
  'MAX_DOWNLOADS',
  'ICLOUDPD_RECENT',
  'IMMICH_EMAIL_PLUS_TAG',
  'ACCOUNT_SLUG_PREFIX',
] as const

export interface Harness {
  service: JobsService
  clock: FakeClock
  procs: FakeProcessService
  webui: FakeWebui
  provisioner: FakeProvisioner
  immichClient: FakeImmichClient
  accounts: AccountsRepo
  jobsRepo: JobsRepo
  events: JobEventsRepo
  db: Database
  photosRoot: string
  stateRoot: string
  /** Free bytes `statfs` reports. */
  disk: { free: number }
  changes: string[]
  view(user: JobUser): Promise<BackupView>
  untilState(user: JobUser, state: BackupState): Promise<BackupView>
  untilProcs(count: number, kind: 'auth' | 'download'): Promise<void>
  seedAccount(user: JobUser, appleId: string): Promise<Account>
  eventMessages(user: JobUser): Promise<string[]>
  /** Everything stored about every account, job and event, as one string. */
  dump(): Promise<string>
  /** Puts a person's first sign-in through to the start of the download. */
  signIn(user: JobUser, appleId: string, mfa?: boolean): Promise<void>
  /** A file on disk under a person's folder, as icloudpd would leave it. */
  file(slug: string, relativePath: string, size: number): Promise<string>
  close(): Promise<void>
}

export async function createHarness(
  db: Database,
  env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'icloud-jobs-'))
  const photosRoot = join(root, 'photos')
  const stateRoot = join(root, 'state')
  await mkdir(photosRoot, { recursive: true })

  const saved: Record<string, string | undefined> = {}
  for (const key of ENV_KEYS) saved[key] = process.env[key]
  const values: Record<string, string> = {
    PHOTOS_ROOT: photosRoot,
    STATE_ROOT: stateRoot,
    MIN_FREE_BYTES: '1000',
    MAX_DOWNLOADS: '2',
    ...env,
  }
  for (const key of ENV_KEYS) {
    const value = values[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  const clock = new FakeClock()
  const procs = new FakeProcessService()
  const webui = new FakeWebui()
  const provisioner = new FakeProvisioner()
  const immichClient = new FakeImmichClient()
  const accountsRepo = new AccountsRepo(db)
  const jobsRepo = new JobsRepo(db)
  const events = new JobEventsRepo(db)
  const disk = { free: 1_000_000 }

  const service = new JobsService(
    accountsRepo,
    jobsRepo,
    events,
    db,
    procs as unknown as ProcessService,
    webui as unknown as WebuiClient,
    new LogParser(),
    provisioner as unknown as ImmichProvisioner,
    immichClient as unknown as ImmichClient,
    clock,
    async () => ({ bavail: disk.free, bsize: 1 }),
  )
  const changes: string[] = []
  service.onChange(id => changes.push(id))

  const harness: Harness = {
    service,
    clock,
    procs,
    webui,
    provisioner,
    immichClient,
    accounts: accountsRepo,
    jobsRepo,
    events,
    db,
    photosRoot,
    stateRoot,
    disk,
    changes,

    view: user => service.getView(user),

    async untilState(user, state) {
      let last: BackupView | null = null
      await until(
        async () => {
          last = await service.getView(user)
          return last.job?.state === state
        },
        `${user.userId} to reach ${state} (last: ${last ? (last as BackupView).job?.state : 'none'})`,
      )
      return service.getView(user)
    },

    async untilProcs(count, kind) {
      await until(
        () => (kind === 'auth' ? procs.auth : procs.downloads).length >= count,
        `${count} ${kind} process(es)`,
      )
    },

    async seedAccount(user, appleId) {
      const account = await accountsRepo.create({
        lilnasUserId: user.userId,
        lilnasEmail: user.email,
        slug: slugFromEmail(user.email),
      })
      await accountsRepo.setAppleId(account.id, appleId)
      return (await accountsRepo.findById(account.id)) ?? account
    },

    async eventMessages(user) {
      const account = await accountsRepo.findByLilnasUserId(user.userId)
      if (!account) return []
      const rows = await db
        .select()
        .from(jobs)
        .where(eq(jobs.accountId, account.id))
      const out: string[] = []
      for (const row of rows) {
        for (const event of await events.tail(row.id, 1000)) {
          out.push(`${event.type}: ${event.message}`)
        }
      }
      return out
    },

    async dump() {
      return JSON.stringify([
        await db.select().from(accounts),
        await db.select().from(jobs),
        await db.select().from(jobEvents),
      ])
    },

    async signIn(user, appleId, mfa = true) {
      const before = procs.auth.length
      await service.start(user, appleId)
      await harness.untilProcs(before + 1, 'auth')
      const proc = procs.auth[before]
      if (!proc) throw new Error('no auth process')
      webui.step = { step: 'need_password', error: null }
      await clock.advance(1000)
      await harness.untilState(user, 'need_password')
      await service.submitPassword(user, PASSWORD)
      if (mfa) {
        webui.step = { step: 'need_code', error: null }
        await clock.advance(1000)
        await harness.untilState(user, 'need_code')
        await service.submitCode(user, CODE)
      }
      proc.emit("INFO     Great, you're all set up.")
      proc.exit(0)
    },

    async file(slug, relativePath, size) {
      const path = join(photosRoot, slug, relativePath)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.alloc(size))
      return path
    },

    async close() {
      await service.onApplicationShutdown()
      for (const key of ENV_KEYS) {
        const value = saved[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      await rm(root, { recursive: true, force: true })
    },
  }
  return harness
}

/** Log lines as icloudpd prints them. */
export const LOG = {
  total: (n: number) =>
    `INFO     Downloading ${n} original photos and videos to /photos ...`,
  downloaded: (path: string) => `INFO     Downloaded ${path}`,
  skipped: (path: string) => `INFO     ${path} already exists`,
  allDone: 'INFO     All photos and videos have been downloaded',
  indexing: 'ERROR    iCloud Photo Library has not finished indexing yet',
  expired:
    'getpass.py:150: GetPassWarning: Can not control echo on the terminal.',
  denied: 'ERROR    Access denied: ACCESS_DENIED',
}

/** The error a promise rejects with, for asserting on its status and body. */
export async function rejection(promise: Promise<unknown>): Promise<{
  status: number
  body: Record<string, unknown>
}> {
  try {
    await promise
  } catch (err) {
    const http = err as {
      getStatus?: () => number
      getResponse?: () => unknown
    }
    if (http.getStatus && http.getResponse) {
      const body = http.getResponse()
      return {
        status: http.getStatus(),
        body:
          typeof body === 'object' && body !== null
            ? (body as Record<string, unknown>)
            : { message: String(body) },
      }
    }
    throw err
  }
  throw new Error('expected the call to be rejected')
}
