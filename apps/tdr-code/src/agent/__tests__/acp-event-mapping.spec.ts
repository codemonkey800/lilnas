import { mapStopReason } from 'src/agent/acp-event-mapping'

describe('acp-event-mapping — mapStopReason (Decision 10)', () => {
  describe('ACP normal completions → completed', () => {
    const normalCompletions = [
      'end_turn',
      'max_tokens',
      'tool_use',
      'stop_sequence',
    ]

    for (const reason of normalCompletions) {
      it(`maps '${reason}' → completed/turn_completed`, () => {
        const result = mapStopReason(reason)
        expect(result.status).toBe('completed')
        expect(result.eventType).toBe('turn_completed')
        expect(result.unknownReason).toBe(false)
      })
    }
  })

  describe("cancellation reasons → cancelled (user-cancel + bot-synthetic 'aborted')", () => {
    it("maps ACP 'cancelled' → cancelled/turn_cancelled", () => {
      const result = mapStopReason('cancelled')
      expect(result.status).toBe('cancelled')
      expect(result.eventType).toBe('turn_cancelled')
      expect(result.unknownReason).toBe(false)
    })

    it("maps bot-synthetic 'aborted' (idle/LRU/clear/shutdown) → cancelled/turn_cancelled", () => {
      const result = mapStopReason('aborted')
      expect(result.status).toBe('cancelled')
      expect(result.eventType).toBe('turn_cancelled')
      expect(result.unknownReason).toBe(false)
    })
  })

  describe('error → errored', () => {
    it("maps bot-synthetic 'error' (executePrompt catch) → errored/turn_errored", () => {
      const result = mapStopReason('error')
      expect(result.status).toBe('errored')
      expect(result.eventType).toBe('turn_errored')
      expect(result.unknownReason).toBe(false)
    })
  })

  describe('unknown reason → errored + unknownReason=true', () => {
    it('maps an unknown string → errored + unknownReason=true', () => {
      const result = mapStopReason('some_unknown_acp_string')
      expect(result.status).toBe('errored')
      expect(result.eventType).toBe('turn_errored')
      expect(result.unknownReason).toBe(true)
    })

    it('maps empty string → errored + unknownReason=true', () => {
      const result = mapStopReason('')
      expect(result.status).toBe('errored')
      expect(result.unknownReason).toBe(true)
    })
  })

  it("'interrupted' is NOT produced live (reserved for sweep)", () => {
    // Verify none of the live-path reasons produce 'interrupted'.
    const liveReasons = [
      'end_turn',
      'cancelled',
      'aborted',
      'error',
      'max_tokens',
    ]
    for (const r of liveReasons) {
      expect(mapStopReason(r).status).not.toBe('interrupted')
    }
  })

  it('methods return void (not Promise) — synchronous guard', () => {
    const result = mapStopReason('end_turn')
    // mapStopReason is a pure function returning an object, not a Promise.
    expect(result).not.toBeInstanceOf(Promise)
    expect(typeof result).toBe('object')
  })
})
