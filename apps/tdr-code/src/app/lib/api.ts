import type { ConfigResponseDto, UpdateConfigBodyDto } from 'src/console/config.dto'
import type { EventListResponseDto } from 'src/console/events.dto'
import type {
  GitIdentityListResponseDto,
  UpsertGitIdentityBodyDto,
  UpsertGitIdentityResponseDto,
} from 'src/console/git-identity.dto'
import type {
  RestartResponseDto,
  TeardownResponseDto,
} from 'src/console/lifecycle.dto'
import type { LiveResponseDto } from 'src/console/live.dto'
import type { ReconcileResponseDto } from 'src/console/reconcile.dto'
import type {
  SessionDetailResponseDto,
  SessionListResponseDto,
} from 'src/console/sessions.dto'

// Base request helper with /api prefix. Throws on non-2xx.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
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

export const fetchJson = <T>(path: string) => request<T>(path)
export const postJson = <T>(path: string) =>
  request<T>(path, { method: 'POST' })
export const putJsonBody = <T>(path: string, body: unknown) =>
  request<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
export const postJsonBody = <T>(path: string, body: unknown) =>
  request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
export const deleteJson = <T>(path: string) =>
  request<T>(path, { method: 'DELETE' })

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
  reconcile: (sessionId: number) => ['reconcile', sessionId] as const,
  config: ['config'] as const,
  gitIdentity: ['git-identity'] as const,
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
  reconcile: (sessionId: number) =>
    fetchJson<ReconcileResponseDto>(`/sessions/${sessionId}/reconcile`),
  getConfig: () => fetchJson<ConfigResponseDto>('/config'),
  updateConfig: (body: UpdateConfigBodyDto) =>
    putJsonBody<ConfigResponseDto>('/config', body),
  listGitIdentities: () =>
    fetchJson<GitIdentityListResponseDto>('/git-identity'),
  upsertGitIdentity: (body: UpsertGitIdentityBodyDto) =>
    postJsonBody<UpsertGitIdentityResponseDto>('/git-identity', body),
  deleteGitIdentity: (discordUserId: string) =>
    deleteJson<{ accepted: true }>(`/git-identity/${encodeURIComponent(discordUserId)}`),
}
