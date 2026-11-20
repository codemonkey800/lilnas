// How icloudpd reports a wrong Apple password is unverified: its web UI moves
// to "no input needed" on an error during the password check, and the process
// may exit or stay up. Everything that guesses lives in this one function, so
// the dry run (H4) can correct it without touching the state machine.

/** What the sign-in loop saw after the password was handed over. */
export type AttemptSignal =
  | 'checking_password'
  | 'need_password'
  | 'no_input'
  | 'need_code'
  | 'checking_code'
  // The log said two-factor authentication is required.
  | 'two_factor_log'
  // The log said "all set up".
  | 'authenticated'
  | 'exit'

export type AttemptVerdict = 'pending' | 'progressed' | 'failed'

const PROGRESS: readonly AttemptSignal[] = [
  'need_code',
  'checking_code',
  'two_factor_log',
  'authenticated',
]

/**
 * Judges a password attempt from the signals seen since the password was
 * relayed, oldest first. The first decisive signal wins:
 *
 * - progressed: the code step or the "all set up" line was reached;
 * - failed: the process exited, or the form came back to the password step or
 *   to "no input" after the check had started (or twice in a row, in case the
 *   check was too quick to be seen).
 *
 * A single `need_password` or `no_input` before the check shows is the form
 * still catching up with the POST, so it decides nothing.
 */
export function judgePasswordAttempt(
  signals: readonly AttemptSignal[],
): AttemptVerdict {
  let sawChecking = false
  let last: AttemptSignal | null = null
  let streak = 0

  for (const signal of signals) {
    if (PROGRESS.includes(signal)) return 'progressed'
    if (signal === 'exit') return 'failed'
    if (signal === 'checking_password') {
      sawChecking = true
      last = null
      streak = 0
      continue
    }
    // need_password or no_input
    streak = signal === last ? streak + 1 : 1
    last = signal
    if (sawChecking || streak >= 2) return 'failed'
  }
  return 'pending'
}
