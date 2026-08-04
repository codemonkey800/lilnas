import { env } from '@lilnas/utils/env'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { EnvKeys } from 'src/env'
import type { MeResponse } from 'src/me/me.controller'

// Re-exported the same way require-admin.ts re-exports its own Nest-side
// DTOs: `import type` is erased entirely at compile time under this
// project's `isolatedModules: true`, so the decorator-laden Nest module
// never reaches the Next.js bundle, with no way for the two shapes to
// silently drift apart the way a hand-redeclared copy could.
export type { MeResponse }

// The self-service counterpart to admin/require-admin.ts's
// fetchFromAdminApi() — any authenticated user's own profile via GET /me.
// Unlike that helper, there is no 403 branch to handle: this route has no
// AdminGuard, only the same 401 "no session at all" case every other
// controller in this app already produces. A 401 redirects to /login,
// exactly like every admin-page caller redirects on 401; any other non-2xx
// status throws rather than degrading silently, since there is no sane
// fallback rendering for `/` without a resolved profile.
export async function fetchMe(): Promise<MeResponse> {
  const incomingHeaders = await headers()
  const cookie = incomingHeaders.get('cookie') ?? ''
  const backendPort = env(EnvKeys.BACKEND_PORT)

  const res = await fetch(`http://localhost:${backendPort}/me`, {
    headers: { cookie },
    cache: 'no-store',
  })
  if (res.status === 401) {
    redirect('/login')
  }
  if (!res.ok) {
    throw new Error(`lilnas-auth: /me returned ${res.status}`)
  }
  return (await res.json()) as MeResponse
}
