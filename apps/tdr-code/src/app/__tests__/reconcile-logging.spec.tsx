import { logReconcileResult } from 'src/app/lib/reconcile-logging'

// logToServer only ever calls .catch() on fetch's return value — see
// browser-logger.spec.tsx's identical mock/rationale.
const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
})

function loggedBody() {
  const [, init] = mockFetch.mock.calls[0]!
  return JSON.parse(init?.body as string)
}

describe('logReconcileResult', () => {
  it('logs an info-level reconcile-result event for cannot-reconcile', () => {
    logReconcileResult(5, {
      verdict: 'cannot-reconcile',
      reason: 'file-missing',
    })

    const body = loggedBody()
    expect(body.level).toBe('info')
    expect(body.event).toBe('reconcile-result')
    expect(body.message).toBe('reconcile-result')
    expect(body.context).toEqual({
      sessionId: 5,
      verdict: 'cannot-reconcile',
      reason: 'file-missing',
    })
  })

  it('logs an info-level reconcile-result event for a clean reconciliation', () => {
    logReconcileResult(5, {
      verdict: 'reconciled',
      matched: 10,
      missingInDb: [],
      extraInDb: [],
      mismatched: [],
      skippedJsonlLines: 0,
    })

    const body = loggedBody()
    expect(body.level).toBe('info')
    expect(body.event).toBe('reconcile-result')
    expect(body.message).toBe('reconcile-result')
    expect(body.context).toEqual({
      sessionId: 5,
      verdict: 'reconciled',
      matched: 10,
      missingInDb: 0,
      extraInDb: 0,
      mismatched: 0,
      skippedJsonlLines: 0,
    })
  })

  it('logs a warn-level reconcile-mismatch event when drift is found, with counts only', () => {
    logReconcileResult(5, {
      verdict: 'reconciled',
      matched: 8,
      missingInDb: [
        { kind: 'agent_text', text: 'super secret transcript line' },
      ],
      extraInDb: [],
      mismatched: [
        { kind: 'tool_call', jsonlText: 'jsonl version', dbText: 'db version' },
      ],
      skippedJsonlLines: 1,
    })

    const body = loggedBody()
    expect(body.level).toBe('warn')
    expect(body.event).toBe('reconcile-mismatch')
    expect(body.message).toBe('Reconcile mismatch detected')
    expect(body.context).toEqual({
      sessionId: 5,
      verdict: 'reconciled',
      matched: 8,
      missingInDb: 1,
      extraInDb: 0,
      mismatched: 1,
      skippedJsonlLines: 1,
    })

    // Regression guard: the raw arrays carry real transcript/tool-call
    // text — only their lengths may ever leave the browser as telemetry.
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain('super secret transcript line')
    expect(serialized).not.toContain('jsonl version')
    expect(serialized).not.toContain('db version')
  })
})
