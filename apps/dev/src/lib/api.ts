import type { Operation, StackAction } from 'src/compose/compose.types'
import type {
  Overview,
  ServiceView,
  StacksEvent,
  StackState,
  StackView,
} from 'src/stacks/stacks.types'

// The view types are the backend's own, so the two sides cannot drift.
export type {
  Operation,
  Overview,
  ServiceView,
  StackAction,
  StacksEvent,
  StackState,
  StackView,
}

/** The Next rewrite maps `/api/*` onto the backend (next.config.js). */
export const API_BASE = '/api'
export const EVENTS_URL = `${API_BASE}/events`

/** Stack ids contain colons (`lilnas:download`), so they are encoded. */
export function stackUrl(id: string): string {
  return `${API_BASE}/stacks/${encodeURIComponent(id)}`
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return undefined
  }
}

function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const { message } = body
    if (typeof message === 'string' && message) return message
  }
  return fallback
}

/** `GET /api/stacks`. Throws `ApiError` when the API does not answer 2xx. */
export async function fetchOverview(signal?: AbortSignal): Promise<Overview> {
  const res = await fetch(`${API_BASE}/stacks`, {
    cache: 'no-store',
    signal,
  })
  if (!res.ok) {
    throw new ApiError(
      res.status,
      messageOf(await readJson(res), `GET /stacks answered ${res.status}`),
    )
  }
  return (await res.json()) as Overview
}

/**
 * What the dashboard needs to say about a refused or failed action:
 * - `busy`      409, another operation owns the stack
 * - `preflight` 412, required env files are missing on this host
 * - `error`     anything else, including a network failure (`status: 0`)
 */
export type ActionResult =
  | { ok: true; operation: Operation }
  | { ok: false; kind: 'busy'; operation?: Operation }
  | { ok: false; kind: 'preflight'; missing: string[] }
  | { ok: false; kind: 'error'; status: number; message: string }

/** `POST /api/stacks/:id/actions/:action`. Never throws. */
export async function postAction(
  id: string,
  action: StackAction,
): Promise<ActionResult> {
  let res: Response
  try {
    res = await fetch(`${stackUrl(id)}/actions/${action}`, { method: 'POST' })
  } catch (err) {
    return {
      ok: false,
      kind: 'error',
      status: 0,
      message: err instanceof Error ? err.message : String(err),
    }
  }

  const body = await readJson(res)

  if (res.ok) {
    const operation = (body as { operation: Operation } | undefined)?.operation
    if (operation) return { ok: true, operation }
  }

  if (res.status === 409) {
    return {
      ok: false,
      kind: 'busy',
      operation: (body as { operation?: Operation } | undefined)?.operation,
    }
  }

  if (res.status === 412) {
    const missing = (body as { missing?: unknown } | undefined)?.missing
    return {
      ok: false,
      kind: 'preflight',
      missing: Array.isArray(missing)
        ? missing.filter((p): p is string => typeof p === 'string')
        : [],
    }
  }

  return {
    ok: false,
    kind: 'error',
    status: res.status,
    message: messageOf(body, `${action} answered ${res.status}`),
  }
}

/** Parses one SSE `data` payload; anything unrecognised is `null`. */
export function parseStacksEvent(data: unknown): StacksEvent | null {
  if (typeof data !== 'string') return null
  try {
    const event = JSON.parse(data) as StacksEvent
    if (event.type === 'stacks-changed' || event.type === 'keepalive') {
      return event
    }
  } catch {
    // fall through
  }
  return null
}
