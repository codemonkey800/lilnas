'use client'

import { cns } from '@lilnas/utils/cns'
import { useQuery } from '@tanstack/react-query'

import { fetchJson, queryKeys } from 'src/app/lib/api'
import { useLiveStream } from 'src/app/lib/use-live-stream'
import type { BotStatusDto } from 'src/bot/bot-status.dto'

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

  return (
    <div className="flex items-center gap-2">
      <StatusDot variant={statusVariant(clientStatus)} />
      <span
        className={cns(
          'text-sm font-medium',
          clientStatus === 'online' ? 'text-green-400' : 'text-gray-400',
        )}
      >
        {STATUS_LABELS[clientStatus]}
      </span>
      {data?.lastSeenAt && clientStatus !== 'online' && (
        <span className="text-xs text-gray-500">
          (last seen {new Date(data.lastSeenAt).toLocaleString()})
        </span>
      )}
    </div>
  )
}
