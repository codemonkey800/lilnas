'use client'

import {
  Badge,
  type BadgeTone,
  type Column,
  DataList,
  Note,
  Panel,
} from '@lilnas/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import type { LiveChannelItemDto, LiveResponseDto } from 'src/console/live.dto'

import { BotStatusWidget } from './components/bot-status-widget'
import { EmptyState } from './components/empty-state'
import { ErrorState } from './components/error-state'
import { InlineConfirm } from './components/inline-confirm'
import { LoadingState } from './components/loading-state'
import { PageContainer } from './components/page-container'
import { RelativeTime } from './components/relative-time'
import { api, queryKeys } from './lib/api'
import { useLiveStream } from './lib/use-live-stream'

// Idle isn't a warning (it's the normal resting state), so it's the accent;
// a stale session is the one that needs a look.
const CHANNEL_STATE_BADGE: Record<
  LiveChannelItemDto['state'],
  { tone: BadgeTone; label: string; live?: boolean }
> = {
  working: { tone: 'ok', label: 'Working', live: true },
  idle: { tone: 'accent', label: 'Idle' },
  stale: { tone: 'bad', label: 'Stale' },
  'last-known': { tone: 'mute', label: 'Last known' },
}

export default function DashboardPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [restartError, setRestartError] = useState<string | null>(null)
  const [teardownErrors, setTeardownErrors] = useState<Record<string, string>>(
    {},
  )

  useLiveStream(['live'])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.live,
    queryFn: api.getLive,
    retry: false,
  })

  const restartMutation = useMutation({
    mutationKey: ['restart'],
    mutationFn: api.restart,
    onSuccess: () => {
      setRestartError(null)
      void queryClient.invalidateQueries({ queryKey: queryKeys.botStatus })
      void queryClient.invalidateQueries({ queryKey: queryKeys.live })
    },
    onError: (err: Error) => {
      setRestartError(err.message)
    },
  })

  const teardownMutation = useMutation({
    mutationKey: ['teardown'],
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
      // Bring back the row the optimistic update removed, so the message
      // shows under the row it belongs to.
      void queryClient.invalidateQueries({ queryKey: queryKeys.live })
    },
  })

  const columns: Column<LiveChannelItemDto>[] = [
    {
      key: 'channel',
      header: 'Channel',
      primary: true,
      render: item => (
        <Link
          className="inline-block max-w-[16rem] truncate align-bottom text-accent-hi hover:underline"
          href={`/sessions?channel=${item.channelId}`}
          title={item.channelId}
        >
          {item.channelName ?? item.channelId}
        </Link>
      ),
    },
    {
      key: 'user',
      header: 'User',
      render: item => (
        <span
          className="inline-block max-w-[12rem] truncate align-bottom"
          title={item.triggeringUserId ?? undefined}
        >
          {item.triggeringUserDisplayName ?? item.triggeringUserId ?? '—'}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'State',
      render: item => {
        const { tone, label, live } = CHANNEL_STATE_BADGE[item.state]
        return (
          <Badge live={live} tone={tone}>
            {label}
          </Badge>
        )
      },
    },
    {
      key: 'queue',
      header: 'Queue',
      align: 'right',
      render: item => item.queueDepth,
    },
    {
      key: 'last',
      header: 'Last activity',
      render: item => (
        <span className="text-ink-3 tabular-nums">
          <RelativeTime value={item.lastActivityAt} />
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: item => (
        <div className="flex flex-col items-start gap-1 md:items-end">
          <InlineConfirm
            data-track-id="dashboard-teardown"
            label="Tear down"
            onConfirm={() => teardownMutation.mutate(item.channelId)}
            pending={
              teardownMutation.isPending &&
              teardownMutation.variables === item.channelId
            }
            prompt="Kill active session?"
          />
          {teardownErrors[item.channelId] && (
            <p className="text-cap text-bad">
              {teardownErrors[item.channelId]}
            </p>
          )}
        </div>
      ),
    },
  ]

  return (
    <PageContainer spacing={6}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h2">Dashboard</h1>
          <BotStatusWidget />
        </div>

        <div className="flex flex-col gap-1.5 md:items-end">
          <InlineConfirm
            confirmLabel="Confirm restart"
            data-track-id="dashboard-restart"
            label="Restart bot"
            onConfirm={() => restartMutation.mutate()}
            pending={restartMutation.isPending}
            prompt="Restarts all channels"
          />
          {restartError && <p className="text-cap text-bad">{restartError}</p>}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-h3">Active sessions</h2>

        {isLoading && !data && (
          <LoadingState message="Fetching active sessions…" />
        )}
        {isError && !data && (
          <ErrorState
            lead="Couldn't load active sessions."
            message={(error as Error)?.message}
          />
        )}

        {data && (
          <>
            {data.botOffline && (
              <Note lead="Bot is offline." tone="warn">
                Showing the last-known state.
              </Note>
            )}

            {data.globalStatus === 'never-seen' ? (
              <EmptyState
                body="Once it starts, its sessions show up here."
                message="Bot has never run"
              />
            ) : data.items.length === 0 ? (
              data.botOffline ? (
                <EmptyState
                  body="The bot is offline and has nothing on record."
                  message="No last-known activity"
                />
              ) : (
                <EmptyState
                  body="Start one from Discord and it'll appear here."
                  message="No active sessions"
                />
              )
            ) : (
              <Panel>
                <DataList
                  caption="Active sessions"
                  columns={columns}
                  onRowClick={item =>
                    router.push(`/sessions?channel=${item.channelId}`)
                  }
                  rowKey={item => item.channelId}
                  rows={data.items}
                />
              </Panel>
            )}
          </>
        )}
      </section>
    </PageContainer>
  )
}
