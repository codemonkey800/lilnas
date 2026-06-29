import { type ChildProcess, spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { env } from '@lilnas/utils/env'
import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import {
  finalize,
  generationById,
  insertGeneration,
  liveGenerations,
  markStopping,
} from 'src/db/bot-generation.repo'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import { EnvKeys } from 'src/env'

import { reapGeneration } from './reaper'
import {
  applyEvent,
  type Effect,
  initialState,
  type SupervisorCtx,
  type SupervisorEvent,
  type SupervisorState,
  type TransitionResult,
} from './supervisor-machine'

// Injected for testing (allows clock/spawn overrides).
export const SUPERVISOR_CLOCK = 'SUPERVISOR_CLOCK' as const
export const SUPERVISOR_SPAWN = 'SUPERVISOR_SPAWN' as const

export interface SupervisorClock {
  now(): number
  setTimeout(fn: () => void, ms: number): NodeJS.Timeout
  clearTimeout(t: NodeJS.Timeout): void
}

export interface SupervisorSpawn {
  spawnBot(env: NodeJS.ProcessEnv): ChildProcess
}

function defaultClock(): SupervisorClock {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: t => clearTimeout(t),
  }
}

function defaultSpawn(): SupervisorSpawn {
  return {
    spawnBot: (spawnEnv: NodeJS.ProcessEnv) => {
      const botEntry = path.resolve(process.cwd(), 'dist/bot-main.js')
      return spawn('node', [botEntry], {
        stdio: 'inherit',
        detached: false,
        env: spawnEnv,
      })
    },
  }
}

function buildBotEnv(generationId: number): NodeJS.ProcessEnv {
  // Explicit allowlist — never inherit the full process.env so that
  // main-server-only secrets (and future Phase-C keys) cannot reach the
  // skip-permissions agent tree.
  const allow: Record<string, string | undefined> = {
    BOT_GENERATION_ID: String(generationId),
    DATABASE_PATH: process.env[EnvKeys.DATABASE_PATH],
    DISCORD_API_TOKEN: process.env[EnvKeys.DISCORD_API_TOKEN],
    DISCORD_GUILD_ID: process.env[EnvKeys.DISCORD_GUILD_ID],
    CLAUDE_COMMAND: process.env[EnvKeys.CLAUDE_COMMAND],
    CLAUDE_CWD: process.env[EnvKeys.CLAUDE_CWD],
    NODE_ENV: process.env[EnvKeys.NODE_ENV],
    PATH: process.env.PATH,
    // Bot timing knobs
    BOT_HEARTBEAT_MS: process.env[EnvKeys.BOT_HEARTBEAT_MS],
    BOT_COMMAND_POLL_MS: process.env[EnvKeys.BOT_COMMAND_POLL_MS],
    BOT_HEARTBEAT_STALE_THRESHOLD_MS:
      process.env[EnvKeys.BOT_HEARTBEAT_STALE_THRESHOLD_MS],
    AGENT_IDLE_TIMEOUT_SECONDS: process.env[EnvKeys.AGENT_IDLE_TIMEOUT_SECONDS],
    AGENT_MAX_SESSIONS: process.env[EnvKeys.AGENT_MAX_SESSIONS],
  }
  // Strip undefined values.
  const envObj: Record<string, string> = {}
  for (const [k, v] of Object.entries(allow)) {
    if (v !== undefined) envObj[k] = v
  }
  return envObj as NodeJS.ProcessEnv
}

function buildCtx(
  unexpectedExitHistory: number[],
  overrides: Partial<SupervisorCtx> = {},
): SupervisorCtx {
  return {
    startTimeoutMs: parseInt(
      env(EnvKeys.SUPERVISOR_START_TIMEOUT_MS, '30000'),
      10,
    ),
    sigkillGraceMs: parseInt(
      env(EnvKeys.SUPERVISOR_SIGKILL_GRACE_MS, '10000'),
      10,
    ),
    stableWindowMs: parseInt(
      env(EnvKeys.SUPERVISOR_STABLE_WINDOW_MS, '30000'),
      10,
    ),
    backoffBaseMs: parseInt(
      env(EnvKeys.SUPERVISOR_BACKOFF_BASE_MS, '1000'),
      10,
    ),
    backoffMaxMs: parseInt(env(EnvKeys.SUPERVISOR_BACKOFF_MAX_MS, '60000'), 10),
    crashLoopWindowMs: parseInt(
      env(EnvKeys.SUPERVISOR_CRASH_LOOP_WINDOW_MS, '120000'),
      10,
    ),
    crashLoopThreshold: parseInt(
      env(EnvKeys.SUPERVISOR_CRASH_LOOP_THRESHOLD, '3'),
      10,
    ),
    unexpectedExitHistory,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class SupervisorService implements OnModuleInit, OnModuleDestroy {
  private fsmState: SupervisorState = initialState()
  private unexpectedExitHistory: number[] = []
  private currentChild: ChildProcess | null = null
  private currentGenerationId: number | null = null

  // Timers — each is keyed per-spawn; re-armed only via the FSM effects.
  private startDeadlineTimer: NodeJS.Timeout | null = null
  private graceTimer: NodeJS.Timeout | null = null
  private backoffTimer: NodeJS.Timeout | null = null
  private livenessPollTimer: NodeJS.Timeout | null = null
  private stableWindowTimer: NodeJS.Timeout | null = null

  private readonly supervise: boolean
  private readonly clock: SupervisorClock
  private readonly spawnFactory: SupervisorSpawn

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
    @Inject(SUPERVISOR_CLOCK) clock: SupervisorClock | null,
    @Inject(SUPERVISOR_SPAWN) spawnFn: SupervisorSpawn | null,
  ) {
    this.supervise = env(EnvKeys.SUPERVISE_BOT, 'true') === 'true'
    this.clock = clock ?? defaultClock()
    this.spawnFactory = spawnFn ?? defaultSpawn()
  }

  async onModuleInit(): Promise<void> {
    if (!this.supervise) {
      this.logger.info('SUPERVISE_BOT=false — running standalone (dev mode)')
      return
    }
    await this.reconcileOnBoot()
    this.dispatch({ type: 'StartRequested' })
  }

  onModuleDestroy(): void {
    this.clearAllTimers()
    if (this.currentChild && this.currentGenerationId != null) {
      this.logger.info('Main server shutting down — stopping bot child')
      const genId = this.currentGenerationId
      this.fsmState = { ...this.fsmState, expectedStop: true }
      try {
        this.currentChild.kill('SIGTERM')
      } catch {
        /* already gone */
      }
      finalize(this.db, genId, 'stopped', null, new Date())
    }
  }

  // ── Liveness-aware boot reconciliation ────────────────────────────────────

  private async reconcileOnBoot(): Promise<void> {
    const liveRows = liveGenerations(this.db)
    for (const row of liveRows) {
      if (row.pid == null) {
        finalize(this.db, row.id, 'crashed', null, new Date())
        continue
      }
      const isAlive = isPidAlive(row.pid)
      if (!isAlive) {
        finalize(this.db, row.id, 'crashed', null, new Date())
        continue
      }
      // PID is alive — verify identity before signaling.
      const confirmed = verifyPidIdentity(row.pid, row.startedAt)
      if (!confirmed) {
        // A recycled PID: finalize without signaling.
        finalize(this.db, row.id, 'crashed', null, new Date())
        this.logger.warn(
          { pid: row.pid, generationId: row.id },
          'Boot reconciliation: live PID identity mismatch, finalizing without signal',
        )
        continue
      }
      // Confirmed live survivor — reap before spawning a replacement.
      this.logger.info(
        { pid: row.pid, generationId: row.id },
        'Boot reconciliation: reaped confirmed live survivor',
      )
      try {
        process.kill(row.pid, 'SIGTERM')
      } catch {
        /* already exited */
      }
      await sleep(100)
      try {
        process.kill(row.pid, 'SIGKILL')
      } catch {
        /* gone */
      }
      finalize(this.db, row.id, 'crashed', null, new Date())
    }
  }

  // ── FSM dispatch ──────────────────────────────────────────────────────────

  private dispatch(event: SupervisorEvent): void {
    const ctx = buildCtx(this.unexpectedExitHistory)
    const result = applyEvent(this.fsmState, event, ctx)
    this.fsmState = result.state
    this.unexpectedExitHistory = result.unexpectedExitHistory
    this.executeEffects(result)
  }

  private executeEffects(result: TransitionResult): void {
    for (const effect of result.effects) {
      this.executeEffect(effect)
    }
  }

  private executeEffect(effect: Effect): void {
    switch (effect.kind) {
      case 'insertGeneration': {
        const row = insertGeneration(this.db, { startedAt: new Date() })
        this.currentGenerationId = row.id
        this.logger.info({ generationId: row.id }, 'Inserted bot generation')
        break
      }

      case 'spawn': {
        const genId = this.currentGenerationId
        if (genId == null) {
          this.logger.error('spawn effect without a generation id')
          return
        }
        try {
          const child = this.spawnFactory.spawnBot(buildBotEnv(genId))
          this.currentChild = child
          this.logger.info(
            { pid: child.pid, generationId: genId },
            'Spawned bot',
          )

          // Bind listeners exactly once per generation (drawer-history invariant).
          const onExit = (code: number | null) => {
            const expected = this.fsmState.expectedStop
            this.logger.info(
              { pid: child.pid, code, expected, generationId: genId },
              'Bot child exited',
            )
            this.dispatch({
              type: 'ExitObserved',
              code,
              expected,
              now: this.clock.now(),
            })
          }
          const onError = (err: Error) => {
            this.logger.error({ err }, 'Bot child process error')
          }
          child.once('exit', onExit)
          child.once('error', onError)
        } catch (err) {
          this.logger.error({ err, generationId: genId }, 'Failed to spawn bot')
          finalize(this.db, genId, 'crashed', null, new Date())
          this.dispatch({
            type: 'ExitObserved',
            code: null,
            expected: false,
            now: this.clock.now(),
          })
        }
        break
      }

      case 'armStartDeadline': {
        this.clearTimer('startDeadline')
        this.startDeadlineTimer = this.clock.setTimeout(() => {
          this.logger.warn(
            { generationId: this.currentGenerationId },
            'Bot start timeout',
          )
          this.dispatch({ type: 'StartTimeout', now: this.clock.now() })
        }, effect.ms)
        // Arm liveness poll to detect the Ready signal via heartbeats.
        this.armLivenessPoll()
        break
      }

      case 'cancelStartDeadline': {
        this.clearTimer('startDeadline')
        break
      }

      case 'armGraceTimeout': {
        this.clearTimer('grace')
        this.graceTimer = this.clock.setTimeout(() => {
          this.logger.warn(
            { generationId: this.currentGenerationId },
            'Bot grace timeout — sending SIGKILL',
          )
          this.dispatch({ type: 'GraceTimeout' })
        }, effect.ms)
        break
      }

      case 'cancelGraceTimeout': {
        this.clearTimer('grace')
        break
      }

      case 'scheduleBackoff': {
        this.clearTimer('backoff')
        if (effect.ms === 0) {
          // Restart immediately (restart command).
          this.dispatch({ type: 'BackoffElapsed' })
          return
        }
        this.backoffTimer = this.clock.setTimeout(() => {
          this.dispatch({ type: 'BackoffElapsed' })
        }, effect.ms)
        break
      }

      case 'cancelBackoff': {
        this.clearTimer('backoff')
        break
      }

      case 'markStopping': {
        if (this.currentGenerationId != null) {
          markStopping(this.db, this.currentGenerationId)
        }
        break
      }

      case 'sendSigterm': {
        if (this.currentChild) {
          try {
            this.currentChild.kill('SIGTERM')
          } catch {
            /* already gone */
          }
        }
        break
      }

      case 'sendSigkill': {
        if (this.currentChild) {
          try {
            this.currentChild.kill('SIGKILL')
          } catch {
            /* already gone */
          }
        }
        break
      }

      case 'finalize': {
        if (this.currentGenerationId != null) {
          const code = this.currentChild?.exitCode ?? null
          finalize(
            this.db,
            this.currentGenerationId,
            effect.status,
            code,
            new Date(),
          )
          this.logger.info(
            { generationId: this.currentGenerationId, status: effect.status },
            'Finalized bot generation',
          )
        }
        this.clearLivenessPoll()
        this.clearTimer('stableWindow')
        break
      }

      case 'reap': {
        this.clearLivenessPoll()
        this.clearTimer('stableWindow')
        const genIdToReap = this.currentGenerationId
        if (genIdToReap != null) {
          try {
            reapGeneration(this.db, genIdToReap)
          } catch (err) {
            this.logger.warn({ err, generationId: genIdToReap }, 'Reaper error')
          }
        }
        break
      }

      case 'resetAttempt': {
        this.logger.info(
          { generationId: this.currentGenerationId },
          'Bot stable — attempt counter reset',
        )
        break
      }
    }
  }

  // ── Liveness poll ─────────────────────────────────────────────────────────

  private armLivenessPoll(): void {
    this.clearLivenessPoll()
    const intervalMs = parseInt(
      env(EnvKeys.SUPERVISOR_LIVENESS_POLL_MS, '2000'),
      10,
    )
    const poll = () => {
      if (
        this.fsmState.phase !== 'Starting' &&
        this.fsmState.phase !== 'Running'
      ) {
        return
      }
      const genId = this.currentGenerationId
      if (genId == null) return
      const row = generationById(this.db, genId)
      if (!row) return

      if (
        this.fsmState.phase === 'Starting' &&
        row.status === 'running' &&
        row.lastHeartbeatAt != null
      ) {
        // Bot is ready — fire Ready event.
        this.dispatch({ type: 'Ready', now: this.clock.now() })
        // Arm stable-window timer.
        this.armStableWindowTimer()
        this.clearLivenessPoll()
        return
      }

      this.livenessPollTimer = this.clock.setTimeout(poll, intervalMs)
    }
    this.livenessPollTimer = this.clock.setTimeout(poll, intervalMs)
  }

  private clearLivenessPoll(): void {
    this.clearTimer('livenessPoll')
  }

  private armStableWindowTimer(): void {
    this.clearTimer('stableWindow')
    const windowMs = parseInt(
      env(EnvKeys.SUPERVISOR_STABLE_WINDOW_MS, '30000'),
      10,
    )
    this.stableWindowTimer = this.clock.setTimeout(() => {
      this.dispatch({ type: 'StableWindowElapsed', now: this.clock.now() })
    }, windowMs)
  }

  // ── Timer management ──────────────────────────────────────────────────────

  private clearTimer(
    which:
      | 'startDeadline'
      | 'grace'
      | 'backoff'
      | 'livenessPoll'
      | 'stableWindow',
  ): void {
    if (which === 'startDeadline' && this.startDeadlineTimer) {
      this.clock.clearTimeout(this.startDeadlineTimer)
      this.startDeadlineTimer = null
    }
    if (which === 'grace' && this.graceTimer) {
      this.clock.clearTimeout(this.graceTimer)
      this.graceTimer = null
    }
    if (which === 'backoff' && this.backoffTimer) {
      this.clock.clearTimeout(this.backoffTimer)
      this.backoffTimer = null
    }
    if (which === 'livenessPoll' && this.livenessPollTimer) {
      this.clock.clearTimeout(this.livenessPollTimer)
      this.livenessPollTimer = null
    }
    if (which === 'stableWindow' && this.stableWindowTimer) {
      this.clock.clearTimeout(this.stableWindowTimer)
      this.stableWindowTimer = null
    }
  }

  private clearAllTimers(): void {
    this.clearTimer('startDeadline')
    this.clearTimer('grace')
    this.clearTimer('backoff')
    this.clearTimer('livenessPoll')
    this.clearTimer('stableWindow')
  }

  // ── Public API (for testing + future REST controller) ─────────────────────

  getPhase() {
    return this.fsmState.phase
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function verifyPidIdentity(pid: number, startedAt: Date): boolean {
  try {
    // Compare the process start time from the OS against the generation's
    // started_at to guard against PID recycling.
    // On macOS/Linux, `ps -o lstart= -p <pid>` gives the process start time.
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf-8',
      timeout: 1000,
    }).trim()
    if (!output) return false
    const osStart = new Date(output)
    if (isNaN(osStart.getTime())) return true // can't parse — assume ok
    // Allow 5 second slack for clock precision.
    return Math.abs(osStart.getTime() - startedAt.getTime()) < 5_000
  } catch {
    return true // ps failed — assume identity ok (conservative)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
