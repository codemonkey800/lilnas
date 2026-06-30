import type { EventListResponseDto } from 'src/console/events.dto'
import type {
  RestartResponseDto,
  TeardownResponseDto,
} from 'src/console/lifecycle.dto'
import type { LiveResponseDto } from 'src/console/live.dto'
import type {
  JsonlStatusResponseDto,
  ReconcileResponseDto,
} from 'src/console/reconcile.dto'
import type {
  SessionDetailResponseDto,
  SessionListResponseDto,
} from 'src/console/sessions.dto'

// Typed fetch with /api prefix. Throws on non-2xx.
export async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`)
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.message) message = body.message
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export async function postJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST' })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.message) message = body.message
    } catch {
      // ignore parse errors
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

// Query-key constants.
export const queryKeys = {
  live: ['live'] as const,
  sessions: (params?: { channel?: string; cursor?: number }) =>
    ['sessions', params] as const,
  session: (id: number) => ['session', id] as const,
  events: (params?: {
    type?: string
    level?: string
    channel?: string
    cursor?: number
  }) => ['events', params] as const,
  botStatus: ['bot-status'] as const,
  jsonlStatus: (sessionId: number) => ['jsonl-status', sessionId] as const,
  reconcile: (sessionId: number) => ['reconcile', sessionId] as const,
}

// Typed API functions.
export const api = {
  getLive: () => fetchJson<LiveResponseDto>('/live'),
  restart: () => postJson<RestartResponseDto>('/bot/restart'),
  teardown: (channelId: string) =>
    postJson<TeardownResponseDto>(`/channels/${channelId}/teardown`),
  listSessions: (params?: {
    channel?: string
    cursor?: number
    limit?: number
  }) => {
    const q = new URLSearchParams()
    if (params?.channel) q.set('channel', params.channel)
    if (params?.cursor) q.set('cursor', String(params.cursor))
    if (params?.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return fetchJson<SessionListResponseDto>(`/sessions${qs ? `?${qs}` : ''}`)
  },
  getSession: (id: number) =>
    fetchJson<SessionDetailResponseDto>(`/sessions/${id}`),
  listEvents: (params?: {
    type?: string
    level?: string
    channel?: string
    cursor?: number
    limit?: number
  }) => {
    const q = new URLSearchParams()
    if (params?.type) q.set('type', params.type)
    if (params?.level) q.set('level', params.level)
    if (params?.channel) q.set('channel', params.channel)
    if (params?.cursor) q.set('cursor', String(params.cursor))
    if (params?.limit) q.set('limit', String(params.limit))
    const qs = q.toString()
    return fetchJson<EventListResponseDto>(`/events${qs ? `?${qs}` : ''}`)
  },
  getJsonlStatus: (sessionId: number) =>
    fetchJson<JsonlStatusResponseDto>(`/sessions/${sessionId}/jsonl-status`),
  reconcile: (sessionId: number) =>
    fetchJson<ReconcileResponseDto>(`/sessions/${sessionId}/reconcile`),
}
