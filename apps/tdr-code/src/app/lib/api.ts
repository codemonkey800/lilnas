import type {
  ConfigResponseDto,
  UpdateConfigBodyDto,
} from 'src/console/config.dto'
import type { EventListResponseDto } from 'src/console/events.dto'
import type {
  DiscordGuildMemberListResponseDto,
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

// Module-scoped flag collapsing a 401 STORM into a single redirect. This
// file's request() is called from up to four concurrent
// `refetchInterval: 5_000` polls (app/page.tsx, app/config/page.tsx,
// app/components/bot-status-widget.tsx, app/sessions/[id]/page.tsx) — once a
// session expires, all four (and any other in-flight requests) will 401
// within the same tick or the next 5s window. Without this guard each of
// those would independently call redirectToLogin(), which in a real browser
// only ever navigates once anyway (the first navigation tears down the
// page), but under test (jsdom, where `window.location.href =` is an
// observable assignment rather than an actual navigation) and in any
// future non-navigating caller, an unguarded handler would issue N
// redirects for N concurrent 401s. Set once, on the FIRST 401 seen, and
// never reset — a redirect that's already underway supersedes anything
// else this page would otherwise do.
let hasRedirectedForSessionExpiry = false

function redirectToLogin() {
  if (hasRedirectedForSessionExpiry) return
  hasRedirectedForSessionExpiry = true
  window.location.href = '/login?error=session_expired'
}

// Base request helper with /api prefix. Throws on non-2xx.
//
// 401 handling (this is the redirect-on-401 half of the plan's "three
// cooperating gates" — middleware.ts's cookie-presence check is the other
// page-level gate; the NestJS guard is the authoritative one): a 401
// specifically means "the session that got this page rendered is no longer
// valid" — either it expired, or it was revoked, or a stale-but-cookie-
// present request slipped past middleware.ts's cheap presence check. On a
// 401 this redirects to /login?error=session_expired and NEVER resolves or
// rejects the underlying promise (the redirect is about to tear down the
// page anyway, so there is nothing useful a caller could do with a settled
// promise) — this is the one deliberate exception to "throws on non-2xx"
// below. Every OTHER non-2xx status still throws exactly as before, so the
// existing inline error UI (ErrorState / ad-hoc `text-red-400` blocks) that
// depends on that throw keeps working completely unchanged.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (res.status === 401) {
    redirectToLogin()
    // Deliberately never settles — see the comment above. A rejected
    // promise here would still reach each of the four polling call sites'
    // `isError` state right as the page is about to be replaced by the
    // /login navigation, which is pure wasted/misleading render work
    // (`ErrorState` flashing "HTTP 401" for a frame right before redirect).
    return new Promise<T>(() => {})
  }
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
  discordGuildMembers: ['discord-guild-members'] as const,
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
    deleteJson<{ accepted: true }>(
      `/git-identity/${encodeURIComponent(discordUserId)}`,
    ),
  listDiscordGuildMembers: (opts?: { force?: boolean }) =>
    fetchJson<DiscordGuildMemberListResponseDto>(
      `/git-identity/discord-members${opts?.force ? '?force=true' : ''}`,
    ),
}
