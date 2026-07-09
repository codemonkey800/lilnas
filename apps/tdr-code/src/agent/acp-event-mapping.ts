// ──────────────────────────────────────────────────────────────────────────────
// Pure ACP-event → table-action mapping (Decision 10 / pure-FSM learning).
// No NestJS, no Drizzle imports — every branch is matrix-testable without SQLite.
// ──────────────────────────────────────────────────────────────────────────────

// Mirrors the TurnStatus enum without importing schema.ts.
export type LiveTurnStatus = 'completed' | 'cancelled' | 'errored'

// The EventType subset produced by this mapping.
export type TurnEventType =
  | 'turn_started'
  | 'turn_completed'
  | 'turn_cancelled'
  | 'turn_errored'

export interface MapStopReasonResult {
  status: LiveTurnStatus
  eventType: TurnEventType
  // True when the stopReason was not in the known set — caller emits a warn event.
  unknownReason: boolean
}

// Map ACP + synthetic stop reasons to a controlled DB status (Decision 10).
//
// ACP normal completions: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'
//   → completed.
// User-cancel (ACP 'cancelled') OR bot-synthetic 'aborted'
//   (idle-timeout / LRU-evict / /clear / shutdown teardown) → cancelled.
// Bot-synthetic 'error' (executePrompt catch) → errored.
// Unknown → errored + unknownReason=true  (caller emits a warn-level event).
//
// 'interrupted' is RESERVED for the reconciliation sweep — never produced live.
export function mapStopReason(stopReason: string): MapStopReasonResult {
  switch (stopReason) {
    case 'end_turn':
    case 'max_tokens':
    case 'tool_use':
    case 'stop_sequence':
      return {
        status: 'completed',
        eventType: 'turn_completed',
        unknownReason: false,
      }
    case 'cancelled':
    case 'aborted':
      return {
        status: 'cancelled',
        eventType: 'turn_cancelled',
        unknownReason: false,
      }
    case 'error':
      return {
        status: 'errored',
        eventType: 'turn_errored',
        unknownReason: false,
      }
    default:
      return {
        status: 'errored',
        eventType: 'turn_errored',
        unknownReason: true,
      }
  }
}
