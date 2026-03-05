import {
  getApiV3QueueDetails,
  postApiV3Command,
  type QueueResource,
} from '@lilnas/media/sonarr'
import { type NextRequest, NextResponse } from 'next/server'

import { getSonarrClient, type MovieDownloadInfo } from 'src/media'

export const dynamic = 'force-dynamic'

const ACTIVE_STATUSES = new Set([
  'downloading',
  'queued',
  'paused',
  'delay',
  'completed',
])

function queueToDownloadInfo(q: QueueResource): MovieDownloadInfo {
  return {
    id: q.id ?? 0,
    title: q.title ?? null,
    size: q.size ?? 0,
    sizeleft: q.sizeleft ?? 0,
    status: q.status ?? 'unknown',
    trackedDownloadState: q.trackedDownloadState ?? null,
    estimatedCompletionTime: q.estimatedCompletionTime ?? null,
  }
}

export interface EpisodeDownloadStatus {
  episodeId: number
  download: MovieDownloadInfo
}

export async function GET(
  request: NextRequest,
): Promise<NextResponse<EpisodeDownloadStatus[] | null>> {
  const seriesId = Number(request.nextUrl.searchParams.get('seriesId'))
  if (!seriesId || Number.isNaN(seriesId)) {
    return NextResponse.json(null, { status: 400 })
  }

  const client = getSonarrClient()

  // Fire-and-forget: tell Sonarr to immediately poll its download client
  void postApiV3Command({
    client,
    body: { name: 'RefreshMonitoredDownloads' },
  }).catch(console.error)

  const result = await getApiV3QueueDetails({
    client,
    query: { seriesId, includeEpisode: false },
    cache: 'no-store',
  })
  const items = (result.data ?? []) as QueueResource[]

  const activeItems = items
    .filter(q => ACTIVE_STATUSES.has(q.status ?? '') && q.episodeId != null)
    .map(q => ({
      episodeId: q.episodeId!,
      download: queueToDownloadInfo(q),
    }))

  return NextResponse.json(activeItems)
}
