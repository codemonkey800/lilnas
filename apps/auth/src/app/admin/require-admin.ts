import { env } from '@lilnas/utils/env'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import type {
  AdminUserEntry,
  QueueEntry as AdminQueueEntry,
} from 'src/admin/admin.controller'
import { EnvKeys } from 'src/env'
import type { ServiceRegistryEntry as AdminServiceEntry } from 'src/services/service-registry.service'

// Imported (aliased at the import site to this file's own established
// names, so every existing `import ... from 'src/app/admin/require-admin'`
// call site needs no change) from their Nest-side originals via `import
// type`, then re-exported below, rather than hand-redeclared
// byte-identical copies as this file used to have. `import type` is
// erased entirely at compile time under this project's
// `isolatedModules: true` — the decorator-laden Nest module itself never
// reaches the Next.js bundle, exactly like a redeclared copy, but with no
// way for the two shapes to silently drift apart the way a redeclaration
// could (rename a field on the Nest side and `tsc` stays green while this
// file's copy quietly goes stale). admin.controller.ts already does the
// same thing in reverse for ServiceRegistryEntry.
export type { AdminQueueEntry, AdminServiceEntry, AdminUserEntry }

// ──────────────────────────────────────────────────────────────────────────────
// U7 (R17, AE5): turns AdminGuard's 401/403 into the user-facing navigation
// a guard has no way to produce itself — a guard only ever sees an
// ExecutionContext, never a Next.js response it could redirect with. Both
// outcomes redirect to /login: an unauthenticated visitor obviously belongs
// there, and a signed-in non-admin gets the same redirect rather than a
// dedicated "forbidden" page — this app has none, and the API's own 403
// (admin.guard.spec.ts) is what actually enforces the boundary against
// anyone hitting the backend directly; this redirect is only ever a UX
// nicety for a person who was never going to have the /admin URL in the
// first place. Shared by every admin-API caller below so that property
// holds uniformly, not just for whichever call happens to run first on a
// given page.
// ──────────────────────────────────────────────────────────────────────────────
async function fetchFromAdminApi<T>(
  path: string,
  init?: { method?: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  const incomingHeaders = await headers()
  const cookie = incomingHeaders.get('cookie') ?? ''
  const backendPort = env(EnvKeys.BACKEND_PORT)

  const res = await fetch(`http://localhost:${backendPort}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      cookie,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  if (res.status === 401 || res.status === 403) {
    redirect('/login')
  }
  if (!res.ok) {
    throw new Error(`lilnas-auth: ${path} returned ${res.status}`)
  }
  return (await res.json()) as T
}

// U7's own auth check both src/app/admin/page.tsx and
// src/app/admin/queue/page.tsx call before rendering anything. Reuses GET
// /admin/queue as the check itself, rather than adding a second, narrower
// "am I admin" endpoint — homelab scale makes fetching the queue array
// cheap even from the page that only cares about the yes/no (the landing
// page), and one already-fully-tested guarded endpoint is simpler than
// standing up a second one that exists purely to be lighter.
export async function requireAdminQueue(): Promise<AdminQueueEntry[]> {
  return fetchFromAdminApi<AdminQueueEntry[]>('/admin/queue')
}

// U8 (R13): the admin landing page's service registry section. Always
// called AFTER requireAdminQueue() on the same page render (so its own
// 401/403 branch is, in practice, redundant with the already-performed
// redirect) — kept anyway via the shared fetchFromAdminApi() helper above
// so this function is independently correct if a future page ever calls it
// without requireAdminQueue() first, rather than depending on call order
// elsewhere to stay safe.
export async function fetchAdminServices(): Promise<AdminServiceEntry[]> {
  return fetchFromAdminApi<AdminServiceEntry[]>('/admin/services')
}

// U9 (R14): the admin users page's own list — every user with at least
// one grant, current or historical. Same "always called alongside
// requireAdminQueue()" note as fetchAdminServices() above applies here
// too.
export async function fetchAdminUsers(): Promise<AdminUserEntry[]> {
  return fetchFromAdminApi<AdminUserEntry[]>('/admin/users')
}
