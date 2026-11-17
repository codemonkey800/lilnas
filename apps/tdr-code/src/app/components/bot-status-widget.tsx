'use client'

import { cns } from '@lilnas/utils/cns'
import { useQuery } from '@tanstack/react-query'

import { fetchJson, queryKeys } from 'src/app/lib/api'
import { useLiveStream } from 'src/app/lib/use-live-stream'
import type { BotStatusDto } from 'src/bot/bot-status.dto'

import { RelativeTime } from './relative-time'
import { StatusDot } from './status-dot'

type ClientStatus = 'loading' | 'unknown' | BotStatusDto['status']

const STATUS_LABELS: Record<ClientStatus, string> = {
  loading: 'Checking…',
  unknown: "Can't reach server",
  online: 'Online',
  starting: 'Starting…',
  offline: 'Offline',
  'offline-failed': 'Supervisor gave up',
  'never-seen': 'Never seen',
}

function statusVariant(s: ClientStatus): 'green' | 'yellow' | 'red' | 'gray' {
  if (s === 'online') return 'green'
  if (s === 'starting') return 'yellow'
  if (s === 'offline' || s === 'offline-failed') return 'red'
  return 'gray'
}

export function BotStatusWidget() {
  useLiveStream(['bot-status'])

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.botStatus,
    queryFn: () => fetchJson<BotStatusDto>('/bot/status'),
    retry: false,
  })

  let clientStatus: ClientStatus
  if (isLoading && !data) {
    clientStatus = 'loading'
  } else if (isError && !data) {
    clientStatus = 'unknown'
  } else if (data) {
    clientStatus = data.status
  } else {
    clientStatus = 'loading'
  }

  const online = clientStatus === 'online'

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
      role="status"
    >
      <StatusDot pulse={online} variant={statusVariant(clientStatus)} />
      <span
        className={cns(
          'text-sm font-medium',
          online ? 'text-ok' : 'text-ink-2',
        )}
      >
        {STATUS_LABELS[clientStatus]}
      </span>
      {data?.lastSeenAt && !online && (
        <span className="text-cap text-ink-3">
          last seen <RelativeTime value={data.lastSeenAt} />
        </span>
      )}
    </div>
  )
}
