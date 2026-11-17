'use client'

import { Badge, Button, type Column, DataList, Input, Panel } from '@lilnas/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { EmptyState } from 'src/app/components/empty-state'
import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { PageContainer } from 'src/app/components/page-container'
import { RelativeTime } from 'src/app/components/relative-time'
import { api, queryKeys } from 'src/app/lib/api'
import type { SessionListItemDto } from 'src/console/sessions.dto'

const BLANK = <span className="text-ink-4">—</span>

const COLUMNS: Column<SessionListItemDto>[] = [
  {
    key: 'id',
    header: 'ID',
    mono: true,
    primary: true,
    render: s => (
      <Link
        className="text-mono-sm text-accent-hi hover:underline"
        href={`/sessions/${s.id}`}
      >
        #{s.id}
      </Link>
    ),
  },
  {
    key: 'channel',
    header: 'Channel',
    render: s => (
      <span
        className="inline-block max-w-[12rem] truncate align-bottom"
        title={s.channelId}
      >
        {s.channelName ?? s.channelId}
      </span>
    ),
  },
  {
    key: 'user',
    header: 'User',
    render: s => (
      <span
        className="inline-block max-w-[12rem] truncate align-bottom"
        title={s.triggeringUserId}
      >
        {s.triggeringUserDisplayName ?? s.triggeringUserId}
      </span>
    ),
  },
  {
    key: 'created',
    header: 'Created',
    render: s => (
      <span className="text-ink-3 tabular-nums">
        <RelativeTime value={s.createdAt} />
      </span>
    ),
  },
  {
    key: 'ended',
    header: 'Ended',
    render: s =>
      s.endedAt ? (
        <span className="text-ink-3 tabular-nums">
          <RelativeTime value={s.endedAt} />
        </span>
      ) : (
        <Badge live tone="ok">
          Active
        </Badge>
      ),
  },
  {
    key: 'reason',
    header: 'Reason',
    mono: true,
    render: s =>
      s.endReason ? (
        <span className="text-mono-sm text-ink-3">{s.endReason}</span>
      ) : (
        BLANK
      ),
  },
]

export default function SessionsPage() {
  const router = useRouter()
  const [channelFilter, setChannelFilter] = useState('')
  const [cursor, setCursor] = useState<number | undefined>(undefined)

  const channel = channelFilter.trim() || undefined
  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.sessions({ channel, cursor }),
    queryFn: () => api.listSessions({ channel, cursor, limit: 25 }),
    retry: false,
  })

  const handleChannelSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    setCursor(undefined)
  }, [])

  function clearFilter() {
    setChannelFilter('')
    setCursor(undefined)
  }

  return (
    <PageContainer title="Sessions">
      <form className="flex items-center gap-2" onSubmit={handleChannelSubmit}>
        <Input
          aria-label="Filter by channel ID"
          className="md:w-[340px]"
          mono={channelFilter !== ''}
          onChange={e => {
            setChannelFilter(e.target.value)
            setCursor(undefined)
          }}
          placeholder="Filter by channel ID (17–20 digits)"
          value={channelFilter}
          wrapperClassName="min-w-0 flex-1 md:flex-none"
        />
        {channelFilter && (
          <Button onClick={clearFilter} size="sm" type="button" variant="ghost">
            Clear
          </Button>
        )}
      </form>

      {isLoading && !data && <LoadingState message="Fetching sessions…" />}
      {isError && !data && (
        <ErrorState
          lead="Couldn't load sessions."
          message={(error as Error)?.message}
        />
      )}

      {data && (
        <>
          {data.items.length === 0 ? (
            channel ? (
              <EmptyState
                action={
                  <Button onClick={clearFilter} size="sm" variant="outline">
                    Clear filter
                  </Button>
                }
                body="Nothing has run there, or the ID isn't one the bot knows."
                message="No sessions in that channel"
              />
            ) : (
              <EmptyState
                body="Start one from Discord and it'll appear here."
                message="No sessions yet"
              />
            )
          ) : (
            <Panel>
              <DataList
                caption="Sessions"
                columns={COLUMNS}
                onRowClick={s => router.push(`/sessions/${s.id}`)}
                rowKey={s => String(s.id)}
                rows={data.items}
              />
            </Panel>
          )}

          {data.nextCursor !== null && (
            <div>
              <Button
                onClick={() => setCursor(data.nextCursor!)}
                variant="outline"
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </PageContainer>
  )
}
