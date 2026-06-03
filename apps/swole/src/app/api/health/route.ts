import { healthResponse, healthStatusCode } from '@lilnas/utils/health'
import { NextResponse } from 'next/server'

import { db } from 'src/db/client'

// Liveness probe consumed by Docker's healthcheck. Probes the SQLite handle
// directly so a wedged DB (permissions revoked, volume unmounted, disk full,
// WAL lock stuck) flips the healthcheck red even though the Node process is
// still bound to port 8080 (#2). Uses the shared @lilnas/utils/health helper
// so the response shape stays uniform across the lilnas fleet (#35).
export async function GET() {
  const result = await healthResponse({
    service: 'swole',
    deps: {
      sqlite: () => {
        const sqlite = (
          db as unknown as {
            $client: { prepare: (s: string) => { get: () => unknown } }
          }
        ).$client
        sqlite.prepare('SELECT 1').get()
      },
    },
  })
  return NextResponse.json(result, { status: healthStatusCode(result) })
}
