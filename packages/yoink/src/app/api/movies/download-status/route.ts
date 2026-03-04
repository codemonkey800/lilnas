import {
  getApiV3QueueDetails,
  postApiV3Command,
  type QueueResource,
} from '@lilnas/media/radarr-next'
import { type NextRequest, NextResponse } from 'next/server'

import {
  getRadarrClient,
  type MovieDownloadInfo,
  queueToDownloadInfo,
} from 'src/media'

export const dynamic = 'force-dynamic'

const ACTIVE_STATUSES = new Set([
  'downloading',
  'queued',
  'paused',
  'delay',
  'completed',
])

export async function GET(
  request: NextRequest,
): Promise<NextResponse<MovieDownloadInfo | null>> {
  const movieId = Number(request.nextUrl.searchParams.get('movieId'))
  if (!movieId || Number.isNaN(movieId)) {
    return NextResponse.json(null, { status: 400 })
  }

  const client = getRadarrClient()

  // Fire-and-forget: tell Radarr to immediately poll its download client
  void postApiV3Command({
    client,
    body: { name: 'RefreshMonitoredDownloads' },
  }).catch(console.error)

  const result = await getApiV3QueueDetails({
    client,
    query: { movieId, includeMovie: false },
    cache: 'no-store',
  })
  const items = (result.data ?? []) as QueueResource[]
  const active = items.find(q => ACTIVE_STATUSES.has(q.status ?? ''))

  return NextResponse.json(active ? queueToDownloadInfo(active) : null)
}
