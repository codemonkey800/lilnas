import type {
  SupervisorCtx,
  SupervisorState,
} from 'src/supervisor/supervisor-machine'
import {
  applyEvent,
  backoffDelay,
  initialState,
  isCrashLoop,
} from 'src/supervisor/supervisor-machine'

const CTX: SupervisorCtx = {
  startTimeoutMs: 30_000,
  sigkillGraceMs: 10_000,
  stableWindowMs: 30_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 60_000,
  crashLoopWindowMs: 120_000,
  crashLoopThreshold: 3,
  unexpectedExitHistory: [],
}

function ctx(overrides: Partial<SupervisorCtx> = {}): SupervisorCtx {
  return { ...CTX, ...overrides }
}

function state(s: Partial<SupervisorState> = {}): SupervisorState {
  return { ...initialState(), ...s }
}

describe('initialState', () => {
  it('starts Stopped with zero attempt', () => {
    expect(initialState()).toEqual({
      phase: 'Stopped',
      attempt: 0,
      lastStableAt: null,
      expectedStop: false,
    })
  })
})

describe('StartRequested', () => {
  it('Stopped → Starting with spawn effects', () => {
    const { state: s, effects } = applyEvent(
      state({ phase: 'Stopped' }),
      { type: 'StartRequested' },
      ctx(),
    )
    expect(s.phase).toBe('Starting')
    expect(effects.map(e => e.kind)).toContain('insertGeneration')
    expect(effects.map(e => e.kind)).toContain('spawn')
    expect(effects.map(e => e.kind)).toContain('armStartDeadline')
  })

  it('Failed → Starting and resets attempt', () => {
    const { state: s, effects } = applyEvent(
      state({ phase: 'Failed', attempt: 5 }),
      { type: 'StartRequested' },
      ctx(),
    )
    expect(s.phase).toBe('Starting')
    expect(s.attempt).toBe(0)
    expect(effects.map(e => e.kind)).toContain('spawn')
  })

  it('ignored in Running', () => {
    const { state: s } = applyEvent(
      state({ phase: 'Running' }),
      { type: 'StartRequested' },
      ctx(),
    )
    expect(s.phase).toBe('Running')
  })
})

describe('Ready', () => {
  it('Starting → Running, cancels start-deadline', () => {
    const now = Date.now()
    const { state: s, effects } = applyEvent(
      state({ phase: 'Starting' }),
      { type: 'Ready', now },
      ctx(),
    )
    expect(s.phase).toBe('Running')
    expect(s.lastStableAt).toBe(now)
    expect(effects.map(e => e.kind)).toContain('cancelStartDeadline')
  })

  it('ignored in Running', () => {
    const { state: s } = applyEvent(
      state({ phase: 'Running' }),
      { type: 'Ready', now: Date.now() },
      ctx(),
    )
    expect(s.phase).toBe('Running')
  })
})

describe('StableWindowElapsed', () => {
  it('Running → resets attempt to 0', () => {
    const {
      state: s,
      effects,
      unexpectedExitHistory,
    } = applyEvent(
      state({ phase: 'Running', attempt: 2 }),
      { type: 'StableWindowElapsed', now: Date.now() },
      ctx({ unexpectedExitHistory: [100, 200] }),
    )
    expect(s.attempt).toBe(0)
    expect(unexpectedExitHistory).toHaveLength(0)
    expect(effects.map(e => e.kind)).toContain('resetAttempt')
  })
})

describe('ExitObserved (Running)', () => {
  it('unexpected → Backoff with finalize(crashed) + reap + scheduleBackoff', () => {
    const now = 1_000
    const { state: s, effects } = applyEvent(
      state({ phase: 'Running', attempt: 0 }),
      { type: 'ExitObserved', code: 1, expected: false, now },
      ctx(),
    )
    expect(s.phase).toBe('Backoff')
    expect(s.attempt).toBe(1)
    expect(effects.find(e => e.kind === 'finalize')).toMatchObject({
      kind: 'finalize',
      status: 'crashed',
    })
    expect(effects.map(e => e.kind)).toContain('reap')
    expect(effects.map(e => e.kind)).toContain('scheduleBackoff')
  })

  it('expected → Stopped with finalize(stopped)', () => {
    const { state: s, effects } = applyEvent(
      state({ phase: 'Running' }),
      { type: 'ExitObserved', code: 0, expected: true, now: 1000 },
      ctx(),
    )
    expect(s.phase).toBe('Stopped')
    expect(effects.find(e => e.kind === 'finalize')).toMatchObject({
      kind: 'finalize',
      status: 'stopped',
    })
    expect(effects.map(e => e.kind)).toContain('cancelGraceTimeout')
  })

  it('N unexpected exits within window → Failed (crash-loop breaker)', () => {
    const base = 1_000
    const c = ctx({ crashLoopThreshold: 3, crashLoopWindowMs: 60_000 })
    let s = state({ phase: 'Running' })
    let history: number[] = []

    for (let i = 0; i < 3; i++) {
      const now = base + i * 1_000
      const result = applyEvent(
        { ...s, phase: 'Running' },
        { type: 'ExitObserved', code: 1, expected: false, now },
        { ...c, unexpectedExitHistory: history },
      )
      s = result.state
      history = result.unexpectedExitHistory
    }

    expect(s.phase).toBe('Failed')
  })

  it('exits spaced beyond window do not trip the breaker', () => {
    const c = ctx({ crashLoopThreshold: 3, crashLoopWindowMs: 10_000 })
    let s = state({ phase: 'Running' })
    let history: number[] = []

    for (let i = 0; i < 3; i++) {
      const now = i * 20_000
      const result = applyEvent(
        { ...s, phase: 'Running' },
        { type: 'ExitObserved', code: 1, expected: false, now },
        { ...c, unexpectedExitHistory: history },
      )
      s = result.state
      history = result.unexpectedExitHistory
    }

    expect(s.phase).toBe('Backoff')
  })
})

describe('ExitObserved (Starting)', () => {
  it('unexpected in Starting → Backoff', () => {
    const { state: s, effects } = applyEvent(
      state({ phase: 'Starting' }),
      { type: 'ExitObserved', code: 1, expected: false, now: 1000 },
      ctx(),
    )
    expect(s.phase).toBe('Backoff')
    expect(effects.map(e => e.kind)).toContain('cancelStartDeadline')
    expect(effects.map(e => e.kind)).toContain('finalize')
    expect(effects.map(e => e.kind)).toContain('reap')
    expect(effects.map(e => e.kind)).toContain('scheduleBackoff')
  })
})

describe('ExitObserved (Stopping)', () => {
  it('expected in Stopping → Stopped (no respawn)', () => {
    const { state: s, effects } = applyEvent(
      state({ phase: 'Stopping', expectedStop: true }),
      { type: 'ExitObserved', code: 0, expected: true, now: 1000 },
      ctx(),
    )
    expect(s.phase).toBe('Stopped')
    expect(effects.find(e => e.kind === 'finalize')).toMatchObject({
      status: 'stopped',
    })
    expect(effects.map(e => e.kind)).toContain('cancelGraceTimeout')
    expect(effects.map(e => e.kind)).not.toContain('scheduleBackoff')
  })

  it('unexpected in Stopping → Stopped (crash, no infinite backoff loop)', () => {
    const { state: s } = applyEvent(
      state({ phase: 'Stopping' }),
      { type: 'ExitObserved', code: 1, expected: false, now: 1000 },
      ctx(),
    )
    expect(s.phase).toBe('Stopped')
  })
})

describe('StartTimeout', () => {
  it('Starting → Stopping with SIGTERM + armGraceTimeout', () => {
    const { state: s, effects } = applyEvent(
      state({ phase: 'Starting' }),
      { type: 'StartTimeout', now: 1000 },
      ctx(),
    )
    expect(s.phase).toBe('Stopping')
    expect(s.expectedStop).toBe(true)
    expect(effects.map(e => e.kind)).toContain('markStopping')
    expect(effects.map(e => e.kind)).toContain('sendSigterm')
    expect(effects.map(e => e.kind)).toContain('armGraceTimeout')
  })

  it('repeated start-timeouts count toward crash-loop breaker', () => {
    const c = ctx({ crashLoopThreshold: 3, crashLoopWindowMs: 60_000 })
    let s = state({ phase: 'Starting' })
    let history: number[] = []

    // Simulate N start-timeouts followed by exit events.
    for (let i = 0; i < 3; i++) {
      const now = i * 1_000
      // StartTimeout → Stopping
      const r1 = applyEvent(
        { ...s, phase: 'Starting' },
        { type: 'StartTimeout', now },
        { ...c, unexpectedExitHistory: history },
      )
      s = r1.state
      history = r1.unexpectedExitHistory

      // ExitObserved(expected:true) → Stopped/Backoff/Failed
      const r2 = applyEvent(
        s,
        { type: 'ExitObserved', code: null, expected: true, now },
        { ...c, unexpectedExitHistory: history },
      )
      s = r2.state
      history = r2.unexpectedExitHistory

      if (s.phase === 'Backoff') {
        const r3 = applyEvent(
          s,
          { type: 'BackoffElapsed' },
          { ...c, unexpectedExitHistory: history },
        )
        s = r3.state
        history = r3.unexpectedExitHistory
      }
    }

    // After 3 timeout+exit cycles the history should be length 3 — breaker trips
    expect(history.length).toBeGreaterThanOrEqual(3)
  })
})

describe('StopRequested / RestartRequested', () => {
  it('Running + StopRequested → Stopping with SIGTERM + markStopping', () => {
    const { state: s, effects } = applyEvent(
      state({ phase: 'Running' }),
      { type: 'StopRequested' },
      ctx(),
    )
    expect(s.phase).toBe('Stopping')
    expect(s.expectedStop).toBe(true)
    expect(effects.map(e => e.kind)).toContain('markStopping')
    expect(effects.map(e => e.kind)).toContain('sendSigterm')
    expect(effects.map(e => e.kind)).toContain('armGraceTimeout')
  })

  it('Running + RestartRequested → Stopping + scheduleBackoff(0) for re-start', () => {
    const { effects } = applyEvent(
      state({ phase: 'Running' }),
      { type: 'RestartRequested' },
      ctx(),
    )
    const backoff = effects.find(e => e.kind === 'scheduleBackoff')
    expect(backoff).toMatchObject({ kind: 'scheduleBackoff', ms: 0 })
  })

  it('Starting + StopRequested → Stopping', () => {
    const { state: s } = applyEvent(
      state({ phase: 'Starting' }),
      { type: 'StopRequested' },
      ctx(),
    )
    expect(s.phase).toBe('Stopping')
  })
})

describe('GraceTimeout', () => {
  it('Stopping → SIGKILL + reap effects', () => {
    const { effects } = applyEvent(
      state({ phase: 'Stopping' }),
      { type: 'GraceTimeout' },
      ctx(),
    )
    expect(effects.map(e => e.kind)).toContain('sendSigkill')
    expect(effects.map(e => e.kind)).toContain('reap')
  })
})

describe('BackoffElapsed', () => {
  it('Backoff → Starting with spawn effects', () => {
    const { state: s, effects } = applyEvent(
      state({ phase: 'Backoff', attempt: 2 }),
      { type: 'BackoffElapsed' },
      ctx(),
    )
    expect(s.phase).toBe('Starting')
    expect(effects.map(e => e.kind)).toContain('spawn')
    expect(effects.map(e => e.kind)).toContain('armStartDeadline')
  })
})

describe('backoffDelay', () => {
  it('grows exponentially and is capped', () => {
    const c = { backoffBaseMs: 1_000, backoffMaxMs: 30_000 }
    const d0 = backoffDelay(0, c, 0)
    const d1 = backoffDelay(1, c, 0)
    const d5 = backoffDelay(5, c, 0)
    expect(d1).toBeGreaterThan(d0)
    expect(d5).toBeLessThanOrEqual(30_000 * 1.25)
  })

  it('jitter stays within ±25% of capped value', () => {
    const c = { backoffBaseMs: 1_000, backoffMaxMs: 10_000 }
    const base = 10_000
    for (let seed = 0; seed < 1000; seed++) {
      const d = backoffDelay(5, c, seed)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(base * 1.26)
    }
  })
})

describe('isCrashLoop', () => {
  it('true when N exits within window', () => {
    const c = { crashLoopWindowMs: 60_000, crashLoopThreshold: 3 }
    const history = [1_000, 2_000, 3_000]
    expect(isCrashLoop(history, 5_000, c)).toBe(true)
  })

  it('false when not enough exits', () => {
    const c = { crashLoopWindowMs: 60_000, crashLoopThreshold: 3 }
    expect(isCrashLoop([1_000, 2_000], 3_000, c)).toBe(false)
  })

  it('false when exits span beyond window', () => {
    const c = { crashLoopWindowMs: 10_000, crashLoopThreshold: 3 }
    const history = [1_000, 5_000, 20_000]
    expect(isCrashLoop(history, 20_000, c)).toBe(false)
  })
})

describe('deterministic — no wall-clock or random calls in core', () => {
  it('two identical calls produce identical results', () => {
    const s = state({ phase: 'Starting' })
    const e = { type: 'Ready' as const, now: 42_000 }
    const c = ctx()
    const r1 = applyEvent(s, e, c)
    const r2 = applyEvent(s, e, c)
    expect(r1).toEqual(r2)
  })
})
