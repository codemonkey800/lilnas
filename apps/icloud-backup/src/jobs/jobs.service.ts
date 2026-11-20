import { chmod, mkdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'

import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common'

import { type Database, DB } from 'src/db/database'
import { AccountsRepo } from 'src/db/repos/accounts.repo'
import { JobEventsRepo } from 'src/db/repos/job-events.repo'
import { type JobPatch, JobsRepo } from 'src/db/repos/jobs.repo'
import type { Account, Job } from 'src/db/schema'
import { slugFromEmail } from 'src/db/slug'
import { LogParser } from 'src/icloudpd/log-parser'
import {
  buildAuthArgs,
  buildDownloadArgs,
  type IcloudpdExit,
  type IcloudpdProcess,
  ProcessService,
} from 'src/icloudpd/process.service'
import { type FormStep, WebuiClient } from 'src/icloudpd/webui.client'
import { ImmichClient } from 'src/immich/immich.client'
import { immichEmail } from 'src/immich/immich.email'
import { ImmichError } from 'src/immich/immich.errors'
import { ImmichProvisioner } from 'src/immich/immich.provisioner'
import type { BackupState, BackupView, ErrorCode } from 'src/shared/contract'

import {
  type AttemptSignal,
  type AttemptVerdict,
  judgePasswordAttempt,
} from './auth-failure'
import { FifoGate } from './fifo-gate'
import {
  AUTH_EXIT_GRACE_MS,
  DISK_CHECK_MS,
  ERROR_LADDER_MS,
  ERROR_LOG_LINES,
  INDEXING_LADDER_MS,
  LOGIN_IDLE_MS,
  MAX_PASSWORD_FAILURES,
  POLL_MS,
  PROGRESS_MS,
  readConfig,
} from './jobs.config'
import {
  CLOCK,
  type Clock,
  type JobUser,
  STATFS,
  type StatfsFn,
} from './jobs.types'
import {
  DOWNLOAD_STARTED_EVENT,
  hasStartedDownload,
  toBackupView,
  toJobView,
} from './jobs.view'

const SIGN_IN_STATES: readonly BackupState[] = [
  'queued_login',
  'need_password',
  'checking_password',
  'need_code',
  'checking_code',
]

// What the UI shows in the job's event list. Nothing here, and nothing passed
// to `setState`/`finishRun`, may carry a password, a code or an icloudpd line
// that came after a form submission.
const STATE_MESSAGES: Record<BackupState, string> = {
  queued_login: 'Waiting for a sign-in turn',
  need_password: 'Waiting for the Apple password',
  checking_password: 'Checking the Apple password',
  need_code: 'Waiting for the verification code',
  checking_code: 'Checking the verification code',
  queued_download: 'Waiting to download',
  indexing_wait: 'Waiting for Apple to finish indexing',
  downloading: 'Downloading',
  provisioning: 'Finishing up in Immich',
  done: 'Backup finished',
  needs_login: 'The saved sign-in expired',
  paused_low_disk: 'Paused: not enough free disk space',
  failed: 'Backup failed',
  cancelled: 'Cancelled',
}

/** Polls on the code step, with no error shown, that mean a wrong code. */
const STALE_CODE_POLLS = 3

type StopReason = 'cancel' | 'low_disk' | 'shutdown'

/** Thrown at a checkpoint when the run has been told to stop. */
class StopSignal extends Error {
  constructor(readonly reason: StopReason) {
    super(`stopped: ${reason}`)
    this.name = 'StopSignal'
  }
}

/** One icloudpd sign-in process and what has been seen of it. */
interface AuthAttempt {
  proc: IcloudpdProcess | null
  signals: AttemptSignal[]
  /** A password was relayed and the verdict is still open. */
  judging: boolean
  authenticated: boolean
  accessDenied: boolean
  exit: IcloudpdExit | null
  askedPassword: boolean
  reachedCode: boolean
  /** A code was relayed and the form has not answered yet. */
  awaitingCode: boolean
  /** The form was seen checking the relayed code. */
  checkedCode: boolean
  staleCodePolls: number
  /** A relay is in flight: the poll loop must not touch the state. */
  submitting: boolean
  submitSeq: number
  lastStep: string
}

interface Run {
  jobId: string
  accountId: string
  lilnasUserId: string
  slug: string
  appleId: string
  /** In-memory mirror of the job's state, updated before the database. */
  state: BackupState
  stop: StopReason | null
  finished: boolean
  loginTimedOut: boolean
  passwordFailures: number
  attempt: number
  errorRetries: number
  auth: AuthAttempt | null
  dlProc: IcloudpdProcess | null
  total: number | null
  downloaded: number
  skipped: number
  bytes: number
  currentFile: string | null
  progressDirty: boolean
  lastProgressAt: number
  progressTimer: unknown
  flight: Promise<void>
  idleTimer: unknown
  diskTimer: unknown
  waker: (() => void) | null
  pendingWake: boolean
  done: Promise<void>
  resolveDone: () => void
}

interface DownloadSession {
  allDone: boolean
  indexing: boolean
  needsLogin: boolean
  accessDenied: boolean
  tail: string[]
  chain: Promise<void>
}

type AuthOutcome =
  | { kind: 'signed_in' }
  | { kind: 'wrong_password' }
  | { kind: 'fail'; code: ErrorCode; detail: string | null; message: string }

type DownloadOutcome =
  | { kind: 'success' }
  | { kind: 'indexing' }
  | { kind: 'needs_login' }
  | { kind: 'access_denied' }
  | { kind: 'error'; detail: string }

function describeImmichError(err: unknown): string {
  return err instanceof ImmichError
    ? `${err.code}: ${err.message}`
    : 'Immich could not be reached or refused the request'
}

@Injectable()
export class JobsService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JobsService.name)
  private readonly runs = new Map<string, Run>()
  private readonly listeners = new Set<(lilnasUserId: string) => void>()
  // The place in line each run was last announced at.
  private readonly queuePositions = new Map<string, number | null>()
  // One sign-in at a time for the whole process, and MAX_DOWNLOADS downloads.
  private readonly turn = new FifoGate(() => 1)
  private readonly slots = new FifoGate(() => readConfig().maxDownloads)

  constructor(
    private readonly accounts: AccountsRepo,
    private readonly jobsRepo: JobsRepo,
    private readonly events: JobEventsRepo,
    @Inject(DB) private readonly db: Database,
    private readonly processes: ProcessService,
    private readonly webui: WebuiClient,
    private readonly parser: LogParser,
    private readonly provisioner: ImmichProvisioner,
    private readonly immich: ImmichClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STATFS) private readonly statfs: StatfsFn,
  ) {}

  // --- lifecycle ---

  /**
   * A restart loses the icloudpd processes and the sign-in turn. A sign-in
   * cannot be resumed (the person has to type again); a download can, because
   * icloudpd skips what is already on disk.
   */
  async onApplicationBootstrap(): Promise<void> {
    const rows = await this.jobsRepo.findNonTerminal()
    for (const job of rows) {
      try {
        await this.recover(job)
      } catch (err) {
        this.logger.error(
          { jobId: job.id, error: errorMessage(err) },
          'Could not recover a job',
        )
      }
    }
  }

  /** Stops every child and leaves the rows as they are. */
  async onApplicationShutdown(): Promise<void> {
    const runs = [...this.runs.values()]
    await Promise.all(
      runs.map(run => {
        run.stop = 'shutdown'
        return this.interrupt(run)
      }),
    )
    await Promise.all(runs.map(run => run.done))
    this.listeners.clear()
  }

  private async recover(job: Job): Promise<void> {
    const account = await this.accounts.findById(job.accountId)
    if (!account) return
    const state = job.state as BackupState

    if (SIGN_IN_STATES.includes(state)) {
      await this.jobsRepo.finish(job.id, 'failed', 'interrupted_login')
      await this.events.append(
        job.id,
        'state',
        'The sign-in was interrupted by a restart',
      )
      return
    }

    if (!account.appleId) {
      await this.jobsRepo.finish(job.id, 'failed', 'internal')
      await this.events.append(job.id, 'state', 'Backup failed')
      return
    }
    // A job that had reached Immich already added its totals to the account;
    // the rerun would add them a second time.
    const counters: JobPatch =
      state === 'provisioning' ? { downloadedItems: 0, downloadedBytes: 0 } : {}
    const resumed =
      (await this.jobsRepo.update(job.id, {
        state: 'queued_download',
        retryAt: null,
        ...counters,
      })) ?? job
    await this.events.append(
      job.id,
      'state',
      'Resumed after a restart: waiting to download',
    )
    await this.ensureFolders(account.slug)
    this.launch(this.makeRun(account, resumed), 'download')
  }

  // --- the public surface ---

  async getView(user: JobUser): Promise<BackupView> {
    const account = await this.accounts.findByLilnasUserId(user.userId)
    const lowDiskSpace = await this.belowMinimum()
    if (!account) {
      return toBackupView({
        email: user.email,
        isAdmin: user.isAdmin,
        lowDiskSpace,
        account: null,
        appleIdLocked: false,
        immichUrl: '',
        job: null,
      })
    }
    const job =
      (await this.jobsRepo.findActiveForAccount(account.id)) ??
      (await this.jobsRepo.findLatestForAccount(account.id))
    return toBackupView({
      email: user.email,
      isAdmin: user.isAdmin,
      lowDiskSpace,
      account,
      appleIdLocked: await hasStartedDownload(this.db, account.id),
      immichUrl: readConfig().immichExternalUrl,
      job: job ? toJobView(job, this.turn.positionOf(job.id)) : null,
    })
  }

  /** First sign-in, or sign in again after the saved session expired. */
  async start(user: JobUser, appleIdInput: string): Promise<BackupView> {
    const appleId = appleIdInput.trim().toLowerCase()
    let account = await this.accounts.findByLilnasUserId(user.userId)
    if (account && (await this.jobsRepo.findActiveForAccount(account.id))) {
      return this.getView(user)
    }
    await this.refuseWhenLowDisk(user)

    const owner = (await this.accounts.list()).find(a => a.appleId === appleId)
    if (owner && owner.id !== account?.id) {
      throw this.conflict('That Apple ID is already used by another account.')
    }
    if (
      account?.appleId &&
      account.appleId !== appleId &&
      (await hasStartedDownload(this.db, account.id))
    ) {
      throw this.conflict(
        'The Apple ID cannot be changed after the first download has started.',
      )
    }
    if (!account) account = await this.createAccount(user)
    if (account.appleId !== appleId) {
      try {
        await this.accounts.setAppleId(account.id, appleId)
      } catch {
        // The unique index caught a race with another account.
        throw this.conflict('That Apple ID is already used by another account.')
      }
    }

    await this.ensureFolders(account.slug)
    const job = await this.createJob(
      account,
      account.lastBackupAt ? 'sync' : 'first_backup',
      'queued_login',
    )
    if (!job) return this.getView(user)
    this.launch(this.makeRun(account, job, appleId), 'signin')
    return this.getView(user)
  }

  /** Runs again with the saved session; no password is asked for. */
  async sync(user: JobUser): Promise<BackupView> {
    const account = await this.accounts.findByLilnasUserId(user.userId)
    if (!account?.appleId) {
      throw this.conflict('Set up the backup with an Apple ID first.')
    }
    if (await this.jobsRepo.findActiveForAccount(account.id)) {
      return this.getView(user)
    }
    await this.refuseWhenLowDisk(user)

    await this.ensureFolders(account.slug)
    const job = await this.createJob(account, 'sync', 'queued_download')
    if (!job) return this.getView(user)
    this.launch(this.makeRun(account, job), 'download')
    return this.getView(user)
  }

  /** The password lives in this call's stack frame and nowhere else. */
  async submitPassword(user: JobUser, password: string): Promise<BackupView> {
    const run = await this.runFor(user)
    const attempt = run.auth
    if (run.state !== 'need_password' || !attempt || attempt.submitting) {
      throw this.conflict('The backup is not asking for a password right now.')
    }
    attempt.submitting = true
    attempt.submitSeq++
    try {
      const result = await this.webui.submitPassword(password)
      this.checkRelay(result)
      attempt.signals = []
      attempt.judging = true
      await this.enterSignInState(run, 'checking_password', {
        authError: null,
      })
    } finally {
      attempt.submitting = false
      attempt.submitSeq++
    }
    return this.getView(user)
  }

  /** Same as `submitPassword`: relayed once, then forgotten. */
  async submitCode(user: JobUser, code: string): Promise<BackupView> {
    const run = await this.runFor(user)
    const attempt = run.auth
    if (run.state !== 'need_code' || !attempt || attempt.submitting) {
      throw this.conflict('The backup is not asking for a code right now.')
    }
    attempt.submitting = true
    attempt.submitSeq++
    try {
      const result = await this.webui.submitCode(code)
      this.checkRelay(result)
      attempt.awaitingCode = true
      attempt.checkedCode = false
      attempt.staleCodePolls = 0
      await this.enterSignInState(run, 'checking_code', { authError: null })
    } finally {
      attempt.submitting = false
      attempt.submitSeq++
    }
    return this.getView(user)
  }

  /** Stops the job wherever it is and marks it cancelled. */
  async cancel(user: JobUser): Promise<BackupView> {
    const account = await this.accounts.findByLilnasUserId(user.userId)
    const run = account ? this.runs.get(account.id) : undefined
    if (run) {
      run.stop ??= 'cancel'
      await this.interrupt(run)
      await run.done
    }
    return this.getView(user)
  }

  /**
   * A new password for the Immich user, for people whose user this service
   * created. Nothing is stored: it is returned once.
   */
  async newImmichPassword(user: JobUser): Promise<{ password: string }> {
    const account = await this.accounts.findByLilnasUserId(user.userId)
    if (!account?.immichUserId) {
      throw this.conflict('There is no Immich account for you yet.')
    }
    if (!account.immichCreatedByUs) {
      throw new ForbiddenException(
        'This Immich account was not created by the backup, so its password cannot be reset here.',
      )
    }
    try {
      return {
        password: await this.provisioner.newTemporaryPassword(
          account.immichUserId,
        ),
      }
    } catch (err) {
      this.logger.warn(
        { accountId: account.id, error: errorMessage(err) },
        'Could not reset the Immich password',
      )
      throw new BadGatewayException('Immich could not reset the password.')
    }
  }

  onChange(listener: (lilnasUserId: string) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // --- setup helpers ---

  private conflict(message: string, view?: BackupView): ConflictException {
    return new ConflictException({
      statusCode: 409,
      message,
      error: 'Conflict',
      ...(view ? { view } : {}),
    })
  }

  private checkRelay(result: 'accepted' | 'wrong_step' | 'rejected'): void {
    if (result === 'wrong_step') {
      throw this.conflict('The sign-in form is not ready for that yet.')
    }
    if (result === 'rejected') {
      throw new BadGatewayException('icloudpd did not accept the input.')
    }
  }

  private async runFor(user: JobUser): Promise<Run> {
    const account = await this.accounts.findByLilnasUserId(user.userId)
    const run = account ? this.runs.get(account.id) : undefined
    if (!run) throw this.conflict('There is no backup in progress.')
    return run
  }

  private async refuseWhenLowDisk(user: JobUser): Promise<void> {
    if (await this.belowMinimum()) {
      const view = await this.getView(user)
      throw this.conflict(
        'There is not enough free disk space to start a backup.',
        { ...view, lowDiskSpace: true },
      )
    }
  }

  private async createAccount(user: JobUser): Promise<Account> {
    try {
      return await this.accounts.create({
        lilnasUserId: user.userId,
        lilnasEmail: user.email,
        slug: slugFromEmail(user.email, readConfig().slugPrefix),
      })
    } catch (err) {
      // Two requests from the same person at once: the other one won.
      const existing = await this.accounts.findByLilnasUserId(user.userId)
      if (existing) return existing
      throw err
    }
  }

  /** Null when another job for the account won the race. */
  private async createJob(
    account: Account,
    kind: 'first_backup' | 'sync',
    state: BackupState,
  ): Promise<Job | null> {
    let job: Job
    try {
      job = await this.jobsRepo.create({ accountId: account.id, kind, state })
    } catch (err) {
      if (await this.jobsRepo.findActiveForAccount(account.id)) return null
      throw err
    }
    await this.events.append(job.id, 'state', STATE_MESSAGES[state])
    return job
  }

  /**
   * The photos folder is used as it is: only a folder that does not exist yet
   * is created (and given its mode); an existing one is never touched.
   */
  private async ensureFolders(slug: string): Promise<void> {
    const config = readConfig()
    await this.makeDir(join(config.photosRoot, slug), 0o755)
    await this.makeDir(join(config.stateRoot, 'cookies', slug), 0o700)
  }

  private async makeDir(dir: string, mode: number): Promise<void> {
    const created = await mkdir(dir, { recursive: true, mode })
    if (created !== undefined) await chmod(dir, mode)
  }

  private makeRun(account: Account, job: Job, appleId?: string): Run {
    let resolveDone: () => void = () => undefined
    const done = new Promise<void>(resolve => {
      resolveDone = resolve
    })
    const run: Run = {
      jobId: job.id,
      accountId: account.id,
      lilnasUserId: account.lilnasUserId,
      slug: account.slug,
      appleId: appleId ?? account.appleId ?? '',
      state: job.state as BackupState,
      stop: null,
      finished: false,
      loginTimedOut: false,
      passwordFailures: 0,
      attempt: job.attempt,
      errorRetries: 0,
      auth: null,
      dlProc: null,
      total: job.totalItems,
      downloaded: job.downloadedItems,
      skipped: job.skippedItems,
      bytes: job.downloadedBytes,
      currentFile: null,
      progressDirty: false,
      lastProgressAt: Number.NEGATIVE_INFINITY,
      progressTimer: null,
      flight: Promise.resolve(),
      idleTimer: null,
      diskTimer: null,
      waker: null,
      pendingWake: false,
      done,
      resolveDone,
    }
    this.runs.set(account.id, run)
    return run
  }

  // --- the run, from the first tick to the last ---

  private launch(run: Run, phase: 'signin' | 'download'): void {
    this.track(this.drive(run, phase))
    this.notifyQueue()
  }

  private track(work: Promise<unknown>): void {
    work.catch(err => {
      this.logger.error({ error: errorMessage(err) }, 'Background work failed')
    })
  }

  private async drive(run: Run, phase: 'signin' | 'download'): Promise<void> {
    try {
      if (phase === 'signin' && !(await this.signIn(run))) return
      await this.download(run)
    } catch (err) {
      await this.handleStop(run, err)
    }
  }

  private async handleStop(run: Run, err: unknown): Promise<void> {
    try {
      if (err instanceof StopSignal) {
        if (err.reason === 'cancel') {
          await this.finishRun(run, 'cancelled', null, null, 'Cancelled')
        } else if (err.reason === 'low_disk') {
          await this.finishRun(
            run,
            'paused_low_disk',
            null,
            null,
            STATE_MESSAGES.paused_low_disk,
          )
        }
      } else if (run.stop !== 'shutdown') {
        this.logger.error(
          { jobId: run.jobId, error: errorMessage(err) },
          'Job failed unexpectedly',
        )
        await this.finishRun(
          run,
          'failed',
          'internal',
          'An unexpected error stopped the backup.',
          'Backup failed: unexpected error',
        )
      }
    } catch (finishErr) {
      this.logger.error(
        { jobId: run.jobId, error: errorMessage(finishErr) },
        'Could not record how the job ended',
      )
    } finally {
      this.cleanup(run)
    }
  }

  /** Throws at a checkpoint once the run has been told to stop. */
  private guard(run: Run): void {
    if (run.stop) throw new StopSignal(run.stop)
  }

  private wake(run: Run): void {
    if (run.waker) run.waker()
    else run.pendingWake = true
  }

  /** Sleeps `ms`, or until something calls `wake`. */
  private waitFor(run: Run, ms: number): Promise<void> {
    if (run.pendingWake) {
      run.pendingWake = false
      return Promise.resolve()
    }
    return new Promise<void>(resolve => {
      const finish = () => {
        this.clock.clearTimeout(timer)
        run.waker = null
        resolve()
      }
      const timer = this.clock.setTimeout(finish, ms)
      run.waker = finish
    })
  }

  /** Asks the run's children and waiters to stop; the run unwinds itself. */
  private async interrupt(run: Run): Promise<void> {
    this.turn.cancel(run.jobId)
    this.slots.cancel(run.jobId)
    this.notifyQueue()
    this.wake(run)
    await Promise.all([run.auth?.proc?.stop(), run.dlProc?.stop()])
  }

  private async setState(
    run: Run,
    state: BackupState,
    patch: JobPatch = {},
    event?: { type: string; message: string },
  ): Promise<void> {
    run.state = state
    await this.jobsRepo.update(run.jobId, { state, retryAt: null, ...patch })
    await this.events.append(
      run.jobId,
      event?.type ?? 'state',
      event?.message ?? STATE_MESSAGES[state],
    )
    this.emit(run.lilnasUserId)
  }

  /** Ends the job in a terminal state. Once only. */
  private async finishRun(
    run: Run,
    state: BackupState,
    code: ErrorCode | null,
    detail: string | null,
    message: string,
  ): Promise<void> {
    if (run.finished) return
    run.finished = true
    run.state = state
    try {
      await run.flight
      await this.jobsRepo.finish(
        run.jobId,
        state,
        code ?? undefined,
        detail ?? undefined,
      )
      await this.events.append(run.jobId, 'state', message)
    } finally {
      this.cleanup(run)
      this.emit(run.lilnasUserId)
    }
  }

  private cleanup(run: Run): void {
    this.clock.clearTimeout(run.idleTimer)
    this.clock.clearTimeout(run.progressTimer)
    this.clock.clearInterval(run.diskTimer)
    run.idleTimer = run.progressTimer = run.diskTimer = null
    this.turn.cancel(run.jobId)
    this.slots.cancel(run.jobId)
    if (this.runs.get(run.accountId) === run) this.runs.delete(run.accountId)
    this.queuePositions.delete(run.jobId)
    run.resolveDone()
    this.notifyQueue()
  }

  // --- announcing changes ---

  private emit(lilnasUserId: string): void {
    for (const listener of this.listeners) {
      try {
        listener(lilnasUserId)
      } catch (err) {
        this.logger.warn({ error: errorMessage(err) }, 'A listener threw')
      }
    }
  }

  /** People in line see their place change, and the one who is up sees it. */
  private notifyQueue(): void {
    for (const run of this.runs.values()) {
      if (run.finished) continue
      const position = this.turn.positionOf(run.jobId)
      const known = this.queuePositions.get(run.jobId) ?? null
      this.queuePositions.set(run.jobId, position)
      if (position !== known) this.emit(run.lilnasUserId)
    }
  }

  // --- sign-in ---

  /** True when signed in; false when the job ended instead. */
  private async signIn(run: Run): Promise<boolean> {
    const admitted = this.turn.acquire(run.jobId)
    this.notifyQueue()
    const granted = await admitted
    this.guard(run)
    if (!granted) throw new StopSignal('cancel')

    try {
      for (;;) {
        const outcome = await this.authAttempt(run)
        if (outcome.kind === 'signed_in') return true
        if (outcome.kind === 'fail') {
          await this.finishRun(
            run,
            'failed',
            outcome.code,
            outcome.detail,
            outcome.message,
          )
          return false
        }
        run.passwordFailures++
        this.logger.log(
          { jobId: run.jobId, failures: run.passwordFailures },
          'Apple password was not accepted',
        )
        if (run.passwordFailures >= MAX_PASSWORD_FAILURES) {
          await this.finishRun(
            run,
            'failed',
            'wrong_password',
            null,
            'Backup failed: the Apple password was not accepted',
          )
          return false
        }
        await this.enterSignInState(
          run,
          'need_password',
          { authError: 'wrong_password' },
          {
            type: 'retry',
            message: 'The Apple password was not accepted: try again',
          },
        )
      }
    } finally {
      this.turn.release(run.jobId)
      this.notifyQueue()
      this.clock.clearTimeout(run.idleTimer)
      run.idleTimer = null
    }
  }

  private async enterSignInState(
    run: Run,
    state: BackupState,
    patch: JobPatch = {},
    event?: { type: string; message: string },
  ): Promise<void> {
    this.armIdle(run)
    await this.setState(run, state, patch, event)
  }

  private armIdle(run: Run): void {
    this.clock.clearTimeout(run.idleTimer)
    run.idleTimer = this.clock.setTimeout(() => {
      run.loginTimedOut = true
      this.wake(run)
    }, LOGIN_IDLE_MS)
  }

  private newAttempt(): AuthAttempt {
    return {
      proc: null,
      signals: [],
      judging: false,
      authenticated: false,
      accessDenied: false,
      exit: null,
      askedPassword: false,
      reachedCode: false,
      awaitingCode: false,
      checkedCode: false,
      staleCodePolls: 0,
      submitting: false,
      submitSeq: 0,
      lastStep: '',
    }
  }

  private async authAttempt(run: Run): Promise<AuthOutcome> {
    const attempt = this.newAttempt()
    let proc: IcloudpdProcess
    try {
      proc = this.processes.spawnIcloudpd(
        buildAuthArgs({
          appleId: run.appleId,
          cookieDir: join(readConfig().stateRoot, 'cookies', run.slug),
        }),
        { onLine: line => this.onAuthLine(run, attempt, line) },
      )
    } catch {
      return {
        kind: 'fail',
        code: 'icloudpd_error',
        detail: 'icloudpd could not be started.',
        message: 'Backup failed: icloudpd could not be started',
      }
    }
    attempt.proc = proc
    run.auth = attempt
    void proc.exited.then(exit => {
      attempt.exit = exit
      this.wake(run)
    })
    this.armIdle(run)
    try {
      return await this.pollAuth(run, attempt)
    } finally {
      run.auth = null
      await proc.stop()
    }
  }

  /**
   * Only the parsed kind of a line is kept. The text of an auth line is never
   * stored or logged: after a form submission it can echo what was typed.
   */
  private onAuthLine(run: Run, attempt: AuthAttempt, line: string): void {
    const event = this.parser.parseLine(line)
    switch (event.type) {
      case 'authenticated':
        attempt.authenticated = true
        attempt.signals.push('authenticated')
        break
      case 'two_factor_required':
        attempt.reachedCode = true
        attempt.signals.push('two_factor_log')
        break
      case 'access_denied':
        attempt.accessDenied = true
        break
      default:
        return
    }
    this.wake(run)
  }

  private async pollAuth(run: Run, a: AuthAttempt): Promise<AuthOutcome> {
    for (;;) {
      this.guard(run)
      if (a.accessDenied) {
        return {
          kind: 'fail',
          code: 'apple_access_denied',
          detail: null,
          message: 'Backup failed: Apple denied access',
        }
      }
      if (run.loginTimedOut) {
        return {
          kind: 'fail',
          code: 'login_timeout',
          detail: null,
          message: 'Backup failed: nobody answered the sign-in in time',
        }
      }
      if (a.authenticated) {
        await this.awaitExit(a)
        return { kind: 'signed_in' }
      }
      if (a.exit) return this.afterAuthExit(a, a.exit)

      await this.waitFor(run, POLL_MS)
      this.guard(run)
      if (this.authFlagsSet(run, a)) continue

      const seq = a.submitSeq
      const step = await this.webui.getStep()
      this.guard(run)
      // The step may be older than a relay or an exit that happened while it
      // was being read.
      if (a.submitting || a.submitSeq !== seq || this.authFlagsSet(run, a)) {
        continue
      }
      if ((await this.applyStep(run, a, step)) === 'failed') {
        return { kind: 'wrong_password' }
      }
    }
  }

  private authFlagsSet(run: Run, a: AuthAttempt): boolean {
    return a.accessDenied || a.authenticated || !!a.exit || run.loginTimedOut
  }

  /** Waits for the process to finish writing its session, up to a limit. */
  private async awaitExit(a: AuthAttempt): Promise<void> {
    if (!a.proc) return
    let timer: unknown
    await Promise.race([
      a.proc.exited,
      new Promise<void>(resolve => {
        timer = this.clock.setTimeout(resolve, AUTH_EXIT_GRACE_MS)
      }),
    ])
    this.clock.clearTimeout(timer)
  }

  private afterAuthExit(a: AuthAttempt, exit: IcloudpdExit): AuthOutcome {
    if (a.judging) {
      a.signals.push('exit')
      const verdict = judgePasswordAttempt(a.signals)
      if (verdict === 'failed') return { kind: 'wrong_password' }
      a.judging = false
    }
    // `--auth-only` exits 0 once the session is saved. An exit that never
    // asked for a password is a valid saved session; one that got as far as
    // the code step is a finished sign-in.
    if (exit.code === 0 && (!a.askedPassword || a.reachedCode)) {
      return { kind: 'signed_in' }
    }
    return {
      kind: 'fail',
      code: 'icloudpd_error',
      detail: `icloudpd stopped during sign-in (exit code ${exit.code ?? 'none'}).`,
      message: 'Backup failed: icloudpd stopped during sign-in',
    }
  }

  /**
   * Moves the job along with what the form shows. The step names (never
   * anything typed) are logged so the real sequence for a wrong password can
   * be read off after the dry run.
   */
  private async applyStep(
    run: Run,
    a: AuthAttempt,
    step: FormStep,
  ): Promise<AttemptVerdict> {
    if (step.step !== a.lastStep) {
      a.lastStep = step.step
      this.logger.log(
        { jobId: run.jobId, step: step.step },
        'Sign-in form step',
      )
    }
    switch (step.step) {
      case 'need_password':
        a.askedPassword = true
        a.signals.push('need_password')
        if (!a.judging && run.state !== 'need_password') {
          await this.enterSignInState(run, 'need_password')
        }
        break
      case 'need_code': {
        a.reachedCode = true
        a.signals.push('need_code')
        // The form is on the code step again after a code was relayed. That
        // is a wrong code if it shows an error, or if the check had been seen
        // running. If neither shows, the form may only be catching up with
        // the POST: several polls in a row on the code step say it is not.
        const wrong =
          step.error !== null ||
          a.checkedCode ||
          (a.awaitingCode && ++a.staleCodePolls >= STALE_CODE_POLLS)
        if (a.awaitingCode && !wrong) break
        if (a.awaitingCode || run.state !== 'need_code') {
          a.awaitingCode = false
          a.checkedCode = false
          await this.enterSignInState(
            run,
            'need_code',
            { authError: wrong ? 'wrong_code' : null },
            wrong
              ? {
                  type: 'retry',
                  message: 'The verification code was not accepted',
                }
              : undefined,
          )
        }
        break
      }
      case 'checking_password':
        a.signals.push('checking_password')
        break
      case 'checking_code':
        a.awaitingCode = false
        a.checkedCode = true
        a.staleCodePolls = 0
        a.signals.push('checking_code')
        break
      case 'no_input':
        a.signals.push('no_input')
        break
      default:
        // unreachable, unknown: nothing to act on yet.
        break
    }
    if (!a.judging) return 'pending'
    const verdict = judgePasswordAttempt(a.signals)
    if (verdict === 'progressed') a.judging = false
    return verdict
  }

  // --- downloads ---

  private async download(run: Run): Promise<void> {
    run.pendingWake = false
    for (;;) {
      if (run.state !== 'queued_download') {
        await this.setState(run, 'queued_download')
      }
      const admitted = await this.slots.acquire(run.jobId)
      this.guard(run)
      if (!admitted) throw new StopSignal('cancel')

      let outcome: DownloadOutcome
      try {
        outcome = await this.downloadOnce(run)
      } finally {
        this.slots.release(run.jobId)
      }

      switch (outcome.kind) {
        case 'success':
          await this.completeBackup(run)
          return
        case 'needs_login':
          await this.finishRun(
            run,
            'needs_login',
            null,
            null,
            STATE_MESSAGES.needs_login,
          )
          return
        case 'access_denied':
          await this.finishRun(
            run,
            'failed',
            'apple_access_denied',
            null,
            'Backup failed: Apple denied access',
          )
          return
        case 'indexing': {
          if (run.attempt >= INDEXING_LADDER_MS.length) {
            await this.finishRun(
              run,
              'failed',
              'apple_indexing',
              null,
              'Backup failed: Apple never finished indexing the library',
            )
            return
          }
          const delay = INDEXING_LADDER_MS[run.attempt] ?? 600_000
          run.attempt++
          await this.setState(
            run,
            'indexing_wait',
            {
              attempt: run.attempt,
              retryAt: new Date(this.clock.now() + delay),
            },
            {
              type: 'retry',
              message: `Apple is still indexing: retry ${run.attempt} of ${INDEXING_LADDER_MS.length} in ${seconds(delay)}`,
            },
          )
          await this.sleep(run, delay)
          break
        }
        case 'error': {
          if (run.errorRetries >= ERROR_LADDER_MS.length) {
            await this.finishRun(
              run,
              'failed',
              'icloudpd_error',
              outcome.detail,
              'Backup failed: icloudpd kept failing',
            )
            return
          }
          const delay = ERROR_LADDER_MS[run.errorRetries] ?? 600_000
          run.errorRetries++
          await this.setState(
            run,
            'queued_download',
            {},
            {
              type: 'retry',
              message: `icloudpd failed: retry ${run.errorRetries} of ${ERROR_LADDER_MS.length} in ${seconds(delay)}`,
            },
          )
          await this.sleep(run, delay)
          break
        }
      }
    }
  }

  private async sleep(run: Run, ms: number): Promise<void> {
    await this.waitFor(run, ms)
    this.guard(run)
  }

  private async downloadOnce(run: Run): Promise<DownloadOutcome> {
    this.guard(run)
    if (await this.belowMinimum()) throw new StopSignal('low_disk')

    const config = readConfig()
    // Starting a download is what locks the Apple ID.
    await this.setState(
      run,
      'downloading',
      { skippedItems: 0, errorCode: null, errorDetail: null },
      { type: DOWNLOAD_STARTED_EVENT, message: STATE_MESSAGES.downloading },
    )
    run.skipped = 0
    this.guard(run)

    const photosDir = join(config.photosRoot, run.slug)
    const session: DownloadSession = {
      allDone: false,
      indexing: false,
      needsLogin: false,
      accessDenied: false,
      tail: [],
      chain: Promise.resolve(),
    }
    let proc: IcloudpdProcess
    try {
      proc = this.processes.spawnIcloudpd(
        buildDownloadArgs({
          appleId: run.appleId,
          cookieDir: join(config.stateRoot, 'cookies', run.slug),
          directory: photosDir,
          recent: config.recent,
        }),
        { onLine: line => this.onDownloadLine(run, session, photosDir, line) },
      )
    } catch {
      return { kind: 'error', detail: 'icloudpd could not be started.' }
    }
    run.dlProc = proc
    run.diskTimer = this.clock.setInterval(() => {
      this.track(this.watchDisk(run))
    }, DISK_CHECK_MS)

    try {
      await proc.exited
      await session.chain
    } finally {
      this.clock.clearInterval(run.diskTimer)
      run.diskTimer = null
      run.dlProc = null
    }
    await this.flushProgress(run)
    this.guard(run)

    // From the log, never from the exit code alone.
    if (session.allDone) return { kind: 'success' }
    if (session.indexing) return { kind: 'indexing' }
    if (session.needsLogin) return { kind: 'needs_login' }
    if (session.accessDenied) return { kind: 'access_denied' }
    return { kind: 'error', detail: session.tail.join('\n') }
  }

  private onDownloadLine(
    run: Run,
    session: DownloadSession,
    photosDir: string,
    line: string,
  ): void {
    const event = this.parser.parseLine(line)
    session.tail.push(line.slice(0, 500))
    if (session.tail.length > ERROR_LOG_LINES) session.tail.shift()

    const later = (work: () => Promise<void> | void): void => {
      session.chain = session.chain
        .then(work)
        .catch(err =>
          this.logger.warn(
            { jobId: run.jobId, error: errorMessage(err) },
            'Could not process an icloudpd line',
          ),
        )
    }

    switch (event.type) {
      case 'all_done':
        session.allDone = true
        break
      case 'indexing':
        session.indexing = true
        break
      case 'needs_login':
        session.needsLogin = true
        break
      case 'access_denied':
        session.accessDenied = true
        break
      case 'total':
        later(() => {
          run.total = event.count
          this.markProgress(run)
        })
        break
      case 'downloaded':
        later(async () => {
          run.bytes += await sizeOf(event.path)
          run.downloaded++
          run.currentFile = relativeTo(photosDir, event.path)
          this.markProgress(run)
        })
        break
      case 'skipped':
        later(() => {
          run.skipped++
          this.markProgress(run)
        })
        break
      default:
        break
    }
  }

  /** At most one database write and one announcement per second. */
  private markProgress(run: Run): void {
    run.progressDirty = true
    if (run.progressTimer) return
    const wait = run.lastProgressAt + PROGRESS_MS - this.clock.now()
    if (wait <= 0) {
      this.track(this.flushProgress(run))
      return
    }
    run.progressTimer = this.clock.setTimeout(() => {
      run.progressTimer = null
      this.track(this.flushProgress(run))
    }, wait)
  }

  private flushProgress(run: Run): Promise<void> {
    this.clock.clearTimeout(run.progressTimer)
    run.progressTimer = null
    if (run.progressDirty) {
      run.progressDirty = false
      run.lastProgressAt = this.clock.now()
      const patch: JobPatch = {
        totalItems: run.total,
        downloadedItems: run.downloaded,
        skippedItems: run.skipped,
        downloadedBytes: run.bytes,
        currentFile: run.currentFile,
      }
      run.flight = run.flight
        .then(async () => {
          await this.jobsRepo.update(run.jobId, patch)
          this.emit(run.lilnasUserId)
        })
        .catch(err =>
          this.logger.warn(
            { jobId: run.jobId, error: errorMessage(err) },
            'Could not write progress',
          ),
        )
    }
    return run.flight
  }

  private async watchDisk(run: Run): Promise<void> {
    if (run.stop || !(await this.belowMinimum())) return
    run.stop = 'low_disk'
    this.wake(run)
    await run.dlProc?.stop()
  }

  /** Free space of the photos volume, against MIN_FREE_BYTES. */
  private async belowMinimum(): Promise<boolean> {
    const { photosRoot, minFreeBytes } = readConfig()
    try {
      const { bavail, bsize } = await this.statfs(photosRoot)
      return bavail * bsize < minFreeBytes
    } catch (err) {
      // Not being able to measure is not a reason to refuse a backup.
      this.logger.warn(
        { error: errorMessage(err) },
        'Could not read the free disk space',
      )
      return false
    }
  }

  // --- after the download ---

  private async completeBackup(run: Run): Promise<void> {
    await this.accounts.addTotals(run.accountId, run.downloaded, run.bytes)
    await this.setState(run, 'provisioning')

    try {
      const account = await this.accounts.findById(run.accountId)
      if (!account) throw new Error('the account is gone')
      if (account.immichLibraryId) {
        await this.immich.scanLibrary(account.immichLibraryId)
      } else {
        const link = await this.provisioner.ensure({
          email: immichEmail(
            account.lilnasEmail,
            readConfig().immichPlusTag || undefined,
          ),
          slug: account.slug,
          onUserCreated: user =>
            this.accounts.setImmichUser(run.accountId, user),
          knownCreatedUserId: account.immichCreatedByUs
            ? account.immichUserId
            : null,
        })
        await this.accounts.setImmich(run.accountId, link)
      }
    } catch (err) {
      this.logger.warn(
        { jobId: run.jobId, error: errorMessage(err) },
        'Immich step failed',
      )
      await this.finishRun(
        run,
        'failed',
        'immich_error',
        describeImmichError(err),
        'Backup downloaded, but Immich could not be updated',
      )
      return
    }
    this.guard(run)
    await this.finishRun(run, 'done', null, null, STATE_MESSAGES.done)
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error'
}

function seconds(ms: number): string {
  const s = Math.round(ms / 1000)
  return s >= 120 ? `${Math.round(s / 60)} min` : `${s} s`
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/** Relative to the person's folder; a path outside it keeps only its name. */
function relativeTo(folder: string, path: string): string {
  const rel = relative(folder, path)
  return rel === '' || rel.startsWith('..') || isAbsolute(rel)
    ? (path.split('/').pop() ?? path)
    : rel
}
