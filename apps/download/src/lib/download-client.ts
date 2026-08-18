import { DownloadClient } from '@lilnas/utils/download/client'
import { headers } from 'next/headers'

// Every production server action/route handler that calls into this
// same-container NestJS backend must go through this instead of
// `DownloadClient.localInstance` directly — Traefik's ForwardAuth sets
// X-Forwarded-User/X-Forwarded-User-Id on the inbound request to this
// Next.js process (port 8080), but a plain `localInstance` call to 8081
// drops them, silently persisting every web-originated job as an
// unattributed service call.
export async function getIdentifiedDownloadClient(): Promise<DownloadClient> {
  const h = await headers()
  const email = h.get('x-forwarded-user')
  const userId = h.get('x-forwarded-user-id')

  return email && userId
    ? DownloadClient.localInstance.withForwardedIdentity({ email, userId })
    : DownloadClient.localInstance
}
