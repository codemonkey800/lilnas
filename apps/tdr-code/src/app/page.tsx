'use client'

import { cns } from '@lilnas/utils/cns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'

import type { LiveChannelItemDto, LiveResponseDto } from 'src/console/live.dto'

import { BotStatusWidget } from './components/bot-status-widget'
import { EmptyState } from './components/empty-state'
import { ErrorState } from './components/error-state'
import { LoadingState } from './components/loading-state'
import { RelativeTime } from './components/relative-time'
import { StatusDot } from './components/status-dot'
import { api, queryKeys } from './lib/api'

const CHANNEL_STATE_VARIANT: Record<
  LiveChannelItemDto['state'],
  'green' | 'yellow' | 'gray' | 'red'
> = {
  working: 'green',
  idle: 'yellow',
  stale: 'red',
  'last-known': 'gray',
}

function LiveRow({
  item,
  onTeardown,
  teardownPending,
}: {
  item: LiveChannelItemDto
  onTeardown: (channelId: string) => void
  teardownPending: boolean
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <tr className="border-b border-gray-800">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <StatusDot variant={CHANNEL_STATE_VARIANT[item.state]} />
          <span className="font-mono text-xs text-gray-200">
            {item.channelId}
          </span>
        </div>
      </td>
      <td className="py-3 pr-4 text-xs text-gray-400">
        {item.triggeringUserId ?? '—'}
      </td>
      <td className="py-3 pr-4 text-xs">
        <span
          className={cns(
            'rounded px-1.5 py-0.5 text-xs font-medium',
            item.state === 'working' && 'bg-green-900 text-green-300',
            item.state === 'idle' && 'bg-yellow-900 text-yellow-300',
            item.state === 'stale' && 'bg-red-900 text-red-300',
            item.state === 'last-known' && 'bg-gray-800 text-gray-400',
          )}
        >
          {item.state}
        </span>
      </td>
      <td className="py-3 pr-4 text-xs text-gray-400">q:{item.queueDepth}</td>
      <td className="py-3 pr-4 text-xs text-gray-400">
        <RelativeTime value={item.lastActivityAt} />
      </td>
      <td className="py-3 text-right">
        {!confirmOpen ? (
          <button
            onClick={() => setConfirmOpen(true)}
            disabled={teardownPending}
            className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
          >
            Tear down
          </button>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-gray-400">Kill active session?</span>
            <button
              onClick={() => {
                setConfirmOpen(false)
                onTeardown(item.channelId)
              }}
              className="rounded bg-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-800"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmOpen(false)}
              className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

export default function DashboardPage() {
  const queryClient = useQueryClient()
  const [restartError, setRestartError] = useState<string | null>(null)
  const [teardownErrors, setTeardownErrors] = useState<Record<string, string>>(
    {},
  )
  const [confirmRestart, setConfirmRestart] = useState(false)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.live,
    queryFn: api.getLive,
    refetchInterval: 5_000,
    retry: false,
  })

  const restartMutation = useMutation({
    mutationFn: api.restart,
    onSuccess: () => {
      setRestartError(null)
      setConfirmRestart(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.botStatus })
      void queryClient.invalidateQueries({ queryKey: queryKeys.live })
    },
    onError: (err: Error) => {
      setRestartError(err.message)
      setConfirmRestart(false)
    },
  })

  const teardownMutation = useMutation({
    mutationFn: (channelId: string) => api.teardown(channelId),
    onMutate: channelId =>
      void queryClient.setQueryData<LiveResponseDto>(queryKeys.live, old =>
        old
          ? { ...old, items: old.items.filter(i => i.channelId !== channelId) }
          : old,
      ),
    onSuccess: (_data, channelId) => {
      setTeardownErrors(prev => {
        const next = { ...prev }
        delete next[channelId]
        return next
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.live })
    },
    onError: (err: Error, channelId) => {
      setTeardownErrors(prev => ({ ...prev, [channelId]: err.message }))
    },
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Dashboard</h1>
          <div className="mt-1">
            <BotStatusWidget />
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          {!confirmRestart ? (
            <button
              onClick={() => setConfirmRestart(true)}
              disabled={restartMutation.isPending}
              className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              Restart bot
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">
                Restarts all channels
              </span>
              <button
                onClick={() => restartMutation.mutate()}
                className="rounded bg-red-900 px-3 py-1.5 text-sm text-red-300 hover:bg-red-800"
              >
                Confirm restart
              </button>
              <button
                onClick={() => setConfirmRestart(false)}
                className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          )}
          {restartError && (
            <p className="text-xs text-red-400">{restartError}</p>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-gray-400">
          Active channels
        </h2>

        {isLoading && !data && <LoadingState />}
        {isError && !data && <ErrorState message={(error as Error)?.message} />}

        {data && (
          <>
            {data.botOffline && (
              <div className="mb-3 rounded bg-yellow-950 px-4 py-2 text-sm text-yellow-300">
                Bot is offline — showing last-known state
              </div>
            )}

            {data.globalStatus === 'never-seen' ? (
              <EmptyState message="Bot has never run — no activity recorded" />
            ) : data.items.length === 0 ? (
              <EmptyState
                message={
                  data.botOffline
                    ? 'Bot offline — no last-known activity'
                    : 'No active sessions'
                }
              />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800 text-left">
                    <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                      Channel
                    </th>
                    <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                      User
                    </th>
                    <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                      State
                    </th>
                    <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                      Queue
                    </th>
                    <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                      Last activity
                    </th>
                    <th className="pb-2 text-right text-xs font-medium text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(item => (
                    <Fragment key={item.channelId}>
                      <LiveRow
                        item={item}
                        onTeardown={channelId =>
                          teardownMutation.mutate(channelId)
                        }
                        teardownPending={
                          teardownMutation.isPending &&
                          teardownMutation.variables === item.channelId
                        }
                      />
                      {teardownErrors[item.channelId] && (
                        <tr>
                          <td colSpan={6} className="pb-2 text-xs text-red-400">
                            {teardownErrors[item.channelId]}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </div>
  )
}
