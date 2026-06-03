import { collectDefaultMetrics, register } from 'prom-client'

// register.clear() is dev-only to survive `next dev` hot reload without
// "metric already exists" errors. In production, custom metric modules may
// register against this same default registry at server boot — clearing here
// would wipe their registrations on the first /metrics scrape. Add the guard
// at file-scope so it runs exactly once when this module is first loaded.
if (process.env.NODE_ENV !== 'production') {
  register.clear()
}
collectDefaultMetrics({ register })

export const dynamic = 'force-dynamic'

export async function GET() {
  return new Response(await register.metrics(), {
    headers: { 'Content-Type': register.contentType },
  })
}
