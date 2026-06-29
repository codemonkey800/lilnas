'use client'

import { cns } from '@lilnas/utils/cns'
import { useQuery } from '@tanstack/react-query'

import type { BotStatusDto } from 'src/bot/bot-status.dto'

type ClientStatus = 'loading' | 'unknown' | BotStatusDto['status']

function fetchBotStatus(): Promise<BotStatusDto> {
  return fetch('/api/bot/status').then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<BotStatusDto>
  })
}

const STATUS_LABELS: Record<ClientStatus, string> = {
  loading: 'Checking status…',
  unknown: "Can't reach server",
  online: 'Online',
  starting: 'Starting…',
  offline: 'Offline',
  'offline-failed': 'Supervisor gave up — needs manual start',
  'never-seen': 'Never seen',
}

const STATUS_COLORS: Record<ClientStatus, string> = {
  loading: 'text-gray-400',
  unknown: 'text-orange-400',
  online: 'text-green-400',
  starting: 'text-yellow-400',
  offline: 'text-red-400',
  'offline-failed': 'text-red-600',
  'never-seen': 'text-gray-400',
}

export default function RootPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bot-status'],
    queryFn: fetchBotStatus,
    refetchInterval: 5_000,
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

  const label = STATUS_LABELS[clientStatus]
  const colorClass = STATUS_COLORS[clientStatus]

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold tracking-tight">tdr-code</h1>
      <div className="flex items-center gap-2">
        <span
          className={cns(
            'h-3 w-3 rounded-full',
            clientStatus === 'online' && 'bg-green-400',
            clientStatus === 'starting' && 'bg-yellow-400',
            (clientStatus === 'offline' || clientStatus === 'offline-failed') &&
              'bg-red-400',
            (clientStatus === 'loading' ||
              clientStatus === 'unknown' ||
              clientStatus === 'never-seen') &&
              'bg-gray-400',
          )}
        />
        <span className={cns('text-sm font-medium', colorClass)}>{label}</span>
      </div>
      {data?.lastSeenAt && clientStatus !== 'online' && (
        <p className="text-xs text-gray-500">
          Last seen: {new Date(data.lastSeenAt).toLocaleString()}
        </p>
      )}
    </main>
  )
}
