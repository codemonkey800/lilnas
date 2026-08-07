'use server'

import { env } from '@lilnas/utils/env'
import { headers } from 'next/headers'

import { EnvKeys } from 'src/env'

// ──────────────────────────────────────────────────────────────────────────────
// U7/U9: Server Actions the queue and users pages' client components call
// to mutate state. Same forward-the-incoming-Cookie-header pattern as
// src/app/pending/actions.ts — see that file's own header comment for why
// this is a plain internal fetch rather than a next.config.js rewrite:
// every call here originates server-side, inside this Server Action's own
// execution context, never directly from the browser.
//
// Unlike require-admin.ts's fetchFromAdminApi(), this file's callBackend()
// does NOT redirect on 401/403 — every mutation here is only ever invoked
// from a page the corresponding requireAdminQueue()/fetchAdminServices()
// call already gated (the queue/users pages themselves), and a Server
// Action's own error simply surfaces as a thrown error in the calling
// client component, which now handles it with its own try/catch (#17 from
// REVIEW.md — see queue-client.tsx's and users-client.tsx's own comments).
//
// Server Actions compile to public POST endpoints: the `id: number` /
// `userId: string` parameter TYPES below are erased at runtime, and Next
// performs no validation of its own on the deserialized payload. Every
// argument that becomes part of a backend URL PATH is narrowed by
// requireRequestId()/requireUserId() below BEFORE that interpolation, so a
// crafted call can't smuggle a `../` path segment (undici normalizes those
// away client-side before ever sending, but the resulting request would
// still target whatever path survives that normalization) or otherwise
// send a request whose path differs from what the type signature implies
// (#23 from REVIEW.md). No live privilege escalation was found through
// this gap — every route reachable this way is either itself guarded or
// already directly reachable by the caller with their own cookie — but
// AdminGuard alone carrying that whole load, with a type signature that
// reads as though the boundary were already checked, is fragile enough to
// close outright.
// ──────────────────────────────────────────────────────────────────────────────

function requireRequestId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('lilnas-auth: invalid request id')
  }
  return value
}

function requireUserId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/')) {
    throw new Error('lilnas-auth: invalid user id')
  }
  return value
}

// Returns the parsed JSON response body on success (every route this file
// calls returns a plain JSON object — see admin.controller.ts) rather than
// discarding it, which is what lets rejectRequest()/bulkRejectRequests()
// below report whether the backend actually decided anything (#24 from
// REVIEW.md) instead of every caller seeing the same undifferentiated
// success.
async function callBackend<T = { ok: true }>(
  path: string,
  init?: { body?: unknown },
): Promise<T> {
  const incomingHeaders = await headers()
  const cookie = incomingHeaders.get('cookie') ?? ''
  const backendPort = env(EnvKeys.BACKEND_PORT)

  const res = await fetch(`http://localhost:${backendPort}${path}`, {
    method: 'POST',
    headers: {
      cookie,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { message?: string }
      detail = body.message ? `: ${body.message}` : ''
    } catch {
      // Not every error response is JSON (or has a body at all) — the
      // bare status-based message below is still useful without it.
    }
    throw new Error(`lilnas-auth: ${path} returned ${res.status}${detail}`)
  }
  return (await res.json()) as T
}

export async function approveRequest(id: number): Promise<void> {
  await callBackend(`/admin/requests/${requireRequestId(id)}/approve`)
}

// Returns `decided` — whether this call ACTUALLY rejected the row, as
// opposed to a no-op on one already decided (e.g. by a second admin acting
// on a stale queue view) — passed straight through from the backend's own
// AdminController.reject() (#24 from REVIEW.md). See queue-client.tsx's
// own comment on why this is what lets it only drop a row from its local
// list once the backend confirms it actually changed.
export async function rejectRequest(
  id: number,
): Promise<{ ok: true; decided: boolean }> {
  return callBackend<{ ok: true; decided: boolean }>(
    `/admin/requests/${requireRequestId(id)}/reject`,
  )
}

// `decided` is the subset of `ids` the backend actually rejected — see
// rejectRequest()'s own comment above for why that matters.
export async function bulkRejectRequests(
  ids: number[],
): Promise<{ ok: true; decided: number[] }> {
  return callBackend<{ ok: true; decided: number[] }>(
    '/admin/requests/bulk-reject',
    { body: { ids } },
  )
}

// U9 (R15): "add by email," M3's batched form — one call for every
// service the admin checked, not one call per checkbox. A clear, specific
// error (e.g. "not a known service") surfaces from the backend's own
// BadRequestException message — see callBackend()'s own `detail`
// extraction above.
export async function preAuthorizeUsers(
  email: string,
  serviceHosts: string[],
): Promise<void> {
  await callBackend('/admin/users/pre-authorize', {
    body: { email, serviceHosts },
  })
}

// U9 (R15), M3's batched form — a set of explicit (serviceHost, grant)
// deltas in one call, replacing a per-checkbox loop of the old single-host
// shape — see src/admin/users.service.ts's setUserServices() for why
// explicit deltas replaced an earlier complete-desired-set shape (a stale
// client snapshot could silently revoke an unrelated, just-granted
// service) and for the "one transaction for the whole batch" half of this
// fix.
export async function setUserServices(
  userId: string,
  changes: { serviceHost: string; grant: boolean }[],
): Promise<void> {
  await callBackend(`/admin/users/${requireUserId(userId)}/services`, {
    body: { changes },
  })
}

export async function removeUser(userId: string): Promise<void> {
  await callBackend(`/admin/users/${requireUserId(userId)}/remove`)
}

export async function blockUser(userId: string): Promise<void> {
  await callBackend(`/admin/users/${requireUserId(userId)}/block`)
}

export async function unblockUser(userId: string): Promise<void> {
  await callBackend(`/admin/users/${requireUserId(userId)}/unblock`)
}

// S2b: the "revoke all sessions" break-glass action — see
// UsersService.revokeSessions()'s own comment for the full rationale.
// `sessionsRevoked` is passed straight through so the calling client
// component can report a specific count rather than an undifferentiated
// success.
export async function revokeSessions(
  userId: string,
): Promise<{ ok: true; sessionsRevoked: number }> {
  return callBackend<{ ok: true; sessionsRevoked: number }>(
    `/admin/users/${requireUserId(userId)}/revoke-sessions`,
  )
}
