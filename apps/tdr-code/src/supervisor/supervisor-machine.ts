// ──────────────────────────────────────────────────────────────────────────────
// Supervisor FSM — pure core. No I/O, no timers, no DB. Time and attempt count
// are injected via event/ctx so every transition is deterministically testable.
//
// Effects are returned as data; the SupervisorService interprets them.
// ──────────────────────────────────────────────────────────────────────────────

export type SupervisorPhase =
  | 'Stopped'
  | 'Starting'
  | 'Running'
  | 'Stopping'
  | 'Backoff'
  | 'Failed'

export type SupervisorState = {
  phase: SupervisorPhase
  // How many unexpected exits have occurred (for crash-loop detection).
  attempt: number
  // When the bot last became stably Running (used for stable-window reset).
  lastStableAt: number | null
  // True when SIGTERM was sent deliberately (stop/timeout).
  expectedStop: boolean
  // True when a RestartRequested was the reason for stopping — triggers
  // immediate restart when ExitObserved(Stopping, expected) fires.
  pendingRestart: boolean
}

// ── Effects (returned as data) ───────────────────────────────────────────────

export type Effect =
  | { kind: 'insertGeneration' }
  | { kind: 'spawn' }
  | { kind: 'armStartDeadline'; ms: number }
  | { kind: 'cancelStartDeadline' }
  | { kind: 'sendSigterm' }
  | { kind: 'sendSigkill' }
  | { kind: 'armGraceTimeout'; ms: number }
  | { kind: 'cancelGraceTimeout' }
  | { kind: 'scheduleBackoff'; ms: number }
  | { kind: 'cancelBackoff' }
  | { kind: 'finalize'; status: 'stopped' | 'crashed' | 'failed' }
  | { kind: 'reap'; generationId?: number }
  | { kind: 'markStopping' }
  | { kind: 'resetAttempt' }
  | { kind: 'armStableWindow'; ms: number }

// ── Events ───────────────────────────────────────────────────────────────────

export type SupervisorEvent =
  | { type: 'StartRequested' }
  | { type: 'Ready'; now: number }
  | {
      type: 'ExitObserved'
      code: number | null
      expected: boolean
      now: number
    }
  | { type: 'StartTimeout'; now: number }
  | { type: 'StopRequested' }
  | { type: 'RestartRequested' }
  | { type: 'BackoffElapsed' }
  | { type: 'GraceTimeout' }
  | { type: 'StableWindowElapsed'; now: number }

// ── Context (injected; no wall-clock reads inside) ───────────────────────────

export type SupervisorCtx = {
  startTimeoutMs: number
  sigkillGraceMs: number
  stableWindowMs: number
  backoffBaseMs: number
  backoffMaxMs: number
  crashLoopWindowMs: number
  crashLoopThreshold: number
  // History of unexpected exits: timestamps (used for crash-loop detection).
  unexpectedExitHistory: number[]
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export function backoffDelay(
  attempt: number,
  ctx: Pick<SupervisorCtx, 'backoffBaseMs' | 'backoffMaxMs'>,
  jitterSeed: number = 0,
): number {
  const expo = ctx.backoffBaseMs * Math.pow(2, attempt)
  const capped = Math.min(expo, ctx.backoffMaxMs)
  // Bounded jitter: ±25% of capped value, deterministic from jitterSeed.
  const jitterRange = capped * 0.25
  const jitter = (((jitterSeed % 1000) / 1000) * 2 - 1) * jitterRange
  return Math.max(0, Math.round(capped + jitter))
}

// Returns true if the last N unexpected exits all occurred within the crash
// window. start-timeouts count as unexpected.
export function isCrashLoop(
  history: number[],
  now: number,
  ctx: Pick<SupervisorCtx, 'crashLoopWindowMs' | 'crashLoopThreshold'>,
): boolean {
  if (history.length < ctx.crashLoopThreshold) return false
  const recent = history.slice(-ctx.crashLoopThreshold)
  const oldest = recent[0]!
  return now - oldest <= ctx.crashLoopWindowMs
}

// ── Transition function ──────────────────────────────────────────────────────

export type TransitionResult = {
  state: SupervisorState
  effects: Effect[]
  // Updated exit history (passed back to the shell for ctx on next event).
  unexpectedExitHistory: number[]
}

export function applyEvent(
  state: SupervisorState,
  event: SupervisorEvent,
  ctx: SupervisorCtx,
): TransitionResult {
  const { phase } = state
  let s = { ...state }
  const effects: Effect[] = []
  let history = [...ctx.unexpectedExitHistory]

  switch (event.type) {
    // ── StartRequested ───────────────────────────────────────────────────────
    case 'StartRequested': {
      if (phase === 'Stopped' || phase === 'Failed') {
        s = {
          ...s,
          phase: 'Starting',
          expectedStop: false,
          attempt: phase === 'Failed' ? 0 : s.attempt,
        }
        effects.push(
          { kind: 'insertGeneration' },
          { kind: 'spawn' },
          { kind: 'armStartDeadline', ms: ctx.startTimeoutMs },
        )
      }
      break
    }

    // ── Ready ────────────────────────────────────────────────────────────────
    case 'Ready': {
      if (phase === 'Starting') {
        s = { ...s, phase: 'Running', lastStableAt: event.now }
        effects.push(
          { kind: 'cancelStartDeadline' },
          { kind: 'armStableWindow', ms: ctx.stableWindowMs },
        )
      }
      break
    }

    // ── StableWindowElapsed ──────────────────────────────────────────────────
    case 'StableWindowElapsed': {
      if (phase === 'Running') {
        s = { ...s, attempt: 0 }
        history = []
        effects.push({ kind: 'resetAttempt' })
      }
      break
    }

    // ── ExitObserved ─────────────────────────────────────────────────────────
    case 'ExitObserved': {
      if (phase === 'Starting') {
        if (event.expected) {
          // Bot exited cleanly during start (unusual but handle gracefully).
          s = { ...s, phase: 'Stopped', expectedStop: false }
          effects.push(
            { kind: 'cancelStartDeadline' },
            { kind: 'finalize', status: 'stopped' },
            { kind: 'reap' },
          )
        } else {
          history.push(event.now)
          s = { ...s, attempt: s.attempt + 1, expectedStop: false }
          // Compute the final status once — only one finalize effect is emitted.
          const finalStatus = isCrashLoop(history, event.now, ctx)
            ? 'failed'
            : 'crashed'
          if (finalStatus === 'failed') {
            s = { ...s, phase: 'Failed' }
          } else {
            s = { ...s, phase: 'Backoff' }
            effects.push({
              kind: 'scheduleBackoff',
              ms: backoffDelay(s.attempt - 1, ctx, event.now),
            })
          }
          effects.push(
            { kind: 'cancelStartDeadline' },
            { kind: 'finalize', status: finalStatus },
            { kind: 'reap' },
          )
        }
      } else if (phase === 'Running') {
        if (event.expected) {
          s = { ...s, phase: 'Stopped', expectedStop: false }
          effects.push(
            { kind: 'cancelGraceTimeout' },
            { kind: 'finalize', status: 'stopped' },
            { kind: 'reap' },
          )
        } else {
          history.push(event.now)
          s = { ...s, attempt: s.attempt + 1, expectedStop: false }
          // Compute the final status once — only one finalize effect is emitted.
          const finalStatus = isCrashLoop(history, event.now, ctx)
            ? 'failed'
            : 'crashed'
          if (finalStatus === 'failed') {
            s = { ...s, phase: 'Failed' }
          } else {
            s = { ...s, phase: 'Backoff' }
            effects.push({
              kind: 'scheduleBackoff',
              ms: backoffDelay(s.attempt - 1, ctx, event.now),
            })
          }
          effects.push(
            { kind: 'finalize', status: finalStatus },
            { kind: 'reap' },
          )
        }
      } else if (phase === 'Stopping') {
        if (event.expected) {
          if (s.pendingRestart) {
            // RestartRequested was the reason for stopping — restart immediately.
            s = {
              ...s,
              phase: 'Starting',
              pendingRestart: false,
              expectedStop: false,
            }
            effects.push(
              { kind: 'cancelGraceTimeout' },
              { kind: 'finalize', status: 'stopped' },
              { kind: 'reap' },
              { kind: 'insertGeneration' },
              { kind: 'spawn' },
              { kind: 'armStartDeadline', ms: ctx.startTimeoutMs },
            )
          } else {
            s = { ...s, phase: 'Stopped', expectedStop: false }
            effects.push(
              { kind: 'cancelGraceTimeout' },
              { kind: 'finalize', status: 'stopped' },
              { kind: 'reap' },
            )
          }
        } else {
          // Crashed during graceful shutdown — evaluate crash-loop and finalize.
          history.push(event.now)
          s = { ...s, attempt: s.attempt + 1, expectedStop: false }
          const finalStatus = isCrashLoop(history, event.now, ctx)
            ? 'failed'
            : 'crashed'
          s = { ...s, phase: finalStatus === 'failed' ? 'Failed' : 'Stopped' }
          effects.push(
            { kind: 'cancelGraceTimeout' },
            { kind: 'finalize', status: finalStatus },
            { kind: 'reap' },
          )
        }
      }
      break
    }

    // ── StartTimeout ─────────────────────────────────────────────────────────
    case 'StartTimeout': {
      if (phase === 'Starting') {
        // Stamp stopping first to prevent false "online" from a racing ready.
        history.push(event.now)
        s = {
          ...s,
          phase: 'Stopping',
          attempt: s.attempt + 1,
          expectedStop: true,
        }
        effects.push(
          { kind: 'markStopping' },
          { kind: 'sendSigterm' },
          { kind: 'armGraceTimeout', ms: ctx.sigkillGraceMs },
        )
        if (isCrashLoop(history, event.now, ctx)) {
          // Set expectedStop: false so ExitObserved(Stopping) falls into the
          // unexpected branch, which evaluates isCrashLoop again and transitions
          // to Failed.
          s = { ...s, expectedStop: false }
        }
      }
      break
    }

    // ── StopRequested ────────────────────────────────────────────────────────
    case 'StopRequested': {
      if (phase === 'Running' || phase === 'Starting') {
        s = { ...s, phase: 'Stopping', expectedStop: true }
        effects.push(
          { kind: 'markStopping' },
          { kind: 'sendSigterm' },
          { kind: 'armGraceTimeout', ms: ctx.sigkillGraceMs },
        )
        if (phase === 'Starting') {
          // Cancel the start deadline and liveness poll.
          effects.push({ kind: 'cancelStartDeadline' })
        }
      } else if (phase === 'Backoff') {
        // Cancel pending backoff and stop.
        s = { ...s, phase: 'Stopped', expectedStop: false }
        effects.push({ kind: 'cancelBackoff' })
      }
      break
    }

    // ── RestartRequested ─────────────────────────────────────────────────────
    case 'RestartRequested': {
      if (phase === 'Running' || phase === 'Starting') {
        // Signal the pending restart; ExitObserved(Stopping, expected) will
        // re-start the bot once the child exits cleanly.
        s = {
          ...s,
          phase: 'Stopping',
          expectedStop: true,
          pendingRestart: true,
        }
        effects.push(
          { kind: 'markStopping' },
          { kind: 'sendSigterm' },
          { kind: 'armGraceTimeout', ms: ctx.sigkillGraceMs },
        )
        if (phase === 'Starting') {
          effects.push({ kind: 'cancelStartDeadline' })
        }
      } else if (phase === 'Backoff') {
        // Immediately restart from Backoff — cancel the backoff timer.
        s = {
          ...s,
          phase: 'Starting',
          expectedStop: false,
          pendingRestart: false,
        }
        effects.push(
          { kind: 'cancelBackoff' },
          { kind: 'insertGeneration' },
          { kind: 'spawn' },
          { kind: 'armStartDeadline', ms: ctx.startTimeoutMs },
        )
      }
      break
    }

    // ── GraceTimeout ─────────────────────────────────────────────────────────
    case 'GraceTimeout': {
      if (phase === 'Stopping') {
        effects.push({ kind: 'sendSigkill' }, { kind: 'reap' })
        // The exit event will come from SIGKILL and flow ExitObserved(expected).
      }
      break
    }

    // ── BackoffElapsed ───────────────────────────────────────────────────────
    case 'BackoffElapsed': {
      if (phase === 'Backoff') {
        s = { ...s, phase: 'Starting', expectedStop: false }
        effects.push(
          { kind: 'insertGeneration' },
          { kind: 'spawn' },
          { kind: 'armStartDeadline', ms: ctx.startTimeoutMs },
        )
      }
      break
    }
  }

  return { state: s, effects, unexpectedExitHistory: history }
}

export function initialState(): SupervisorState {
  return {
    phase: 'Stopped',
    attempt: 0,
    lastStableAt: null,
    expectedStop: false,
    pendingRestart: false,
  }
}
