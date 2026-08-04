'use server'

import { env } from '@lilnas/utils/env'
import { headers } from 'next/headers'

import { EnvKeys } from 'src/env'

// ──────────────────────────────────────────────────────────────────────────────
// U6: the pending page's only bridge to the Nest backend (src/requests/
// requests.controller.ts). Both functions forward the INCOMING request's own
// Cookie header — obtained via next/headers, never read/constructed by hand
// — so the backend's AccessCacheService.resolveSession() sees the exact same
// session the browser is already carrying. Marked 'use server' so
// pending-client.tsx (a Client Component — EventSource can't run
// server-side) can call these directly as Server Actions, while
// page.tsx (a Server Component) calls the same functions as plain
// server-side function calls — both call paths hit this one implementation,
// so there is nowhere for the two to drift.
//
// Deliberately NOT a next.config.js rewrite: unlike the SSE connection
// (browser-opened, must cross :8080 -> :8081), every call here originates
// server-side (either this Server Action's own execution context, or
// page.tsx's direct call), so a plain internal fetch to localhost:8081 never
// needs to be browser-reachable at all.
// ──────────────────────────────────────────────────────────────────────────────

export type RequestStatusResult =
  | { outcome: 'granted' }
  | { outcome: 'pending' }
  | { outcome: 'rejected' }
  | { outcome: 'blocked' }

async function callBackend<T>(
  path: string,
  method: 'GET' | 'POST',
): Promise<T> {
  const incomingHeaders = await headers()
  const cookie = incomingHeaders.get('cookie') ?? ''
  const backendPort = env(EnvKeys.BACKEND_PORT)

  const res = await fetch(`http://localhost:${backendPort}${path}`, {
    method,
    headers: { cookie },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(
      `lilnas-auth: requests endpoint ${path} returned ${res.status}`,
    )
  }
  return (await res.json()) as T
}

export async function checkRequestStatus(
  redirectUrl: string,
): Promise<RequestStatusResult> {
  return callBackend<RequestStatusResult>(
    `/requests/status?redirect=${encodeURIComponent(redirectUrl)}`,
    'GET',
  )
}

// Called from login-form.tsx's sign-in click when the user is returning
// after a rejection — see that file's own comment for why this is awaited
// BEFORE signIn.social() rather than fire-and-forget. The backend's
// response is uniformly `{ ok: true }` regardless of what actually
// happened (see requests.controller.ts's own reRequest() comment) — the
// caller navigates away via signIn.social() immediately afterward either
// way, so there is nothing left for this return value to carry.
export async function submitReRequest(
  redirectUrl: string,
): Promise<{ ok: true }> {
  return callBackend<{ ok: true }>(
    `/requests/re-request?redirect=${encodeURIComponent(redirectUrl)}`,
    'POST',
  )
}
