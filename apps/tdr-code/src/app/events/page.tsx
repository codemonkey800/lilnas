'use client'

import {
  Badge,
  type BadgeTone,
  Button,
  type Column,
  DataList,
  Input,
  Panel,
  Select,
} from '@lilnas/ui'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'

import { EmptyState } from 'src/app/components/empty-state'
import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { PageContainer } from 'src/app/components/page-container'
import { RelativeTime } from 'src/app/components/relative-time'
import { api, queryKeys } from 'src/app/lib/api'
import type { EventItemDto } from 'src/console/events.dto'
import { EVENT_LEVELS, EVENT_TYPES } from 'src/db/schema'

// A Select can't hold '' (that reads as "nothing chosen"), so "All" is a
// sentinel that the handlers map back to an empty filter.
const ALL = '__all__'

const TYPE_ITEMS: Record<string, string> = {
  [ALL]: 'All types',
  ...Object.fromEntries(EVENT_TYPES.map(t => [t, t])),
}
const LEVEL_ITEMS: Record<string, string> = {
  [ALL]: 'All levels',
  ...Object.fromEntries(EVENT_LEVELS.map(l => [l, l])),
}

const LEVEL_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  error: { tone: 'bad', label: 'Error' },
  warn: { tone: 'warn', label: 'Warn' },
  info: { tone: 'mute', label: 'Info' },
}

const BLANK = <span className="text-ink-4">—</span>

const COLUMNS: Column<EventItemDto>[] = [
  {
    key: 'time',
    header: 'Time',
    render: evt => (
      <span className="text-ink-3 tabular-nums">
        <RelativeTime value={evt.createdAt} />
      </span>
    ),
  },
  {
    key: 'level',
    header: 'Level',
    render: evt => {
      const { tone, label } = LEVEL_BADGE[evt.level] ?? LEVEL_BADGE.info
      return <Badge tone={tone}>{label}</Badge>
    },
  },
  {
    key: 'type',
    header: 'Type',
    mono: true,
    primary: true,
    render: evt => <span className="text-mono-sm">{evt.type}</span>,
  },
  {
    key: 'channel',
    header: 'Channel',
    render: evt =>
      evt.channelId ? (
        <span
          className="inline-block max-w-[12rem] truncate align-bottom"
          title={evt.channelId}
        >
          {evt.channelName ?? evt.channelId}
        </span>
      ) : (
        BLANK
      ),
  },
  {
    key: 'session',
    header: 'Session',
    mono: true,
    render: evt =>
      evt.sessionId ? (
        <Link
          className="text-mono-sm text-accent-hi hover:underline"
          href={`/sessions/${evt.sessionId}`}
        >
          #{evt.sessionId}
        </Link>
      ) : (
        BLANK
      ),
  },
]

export default function EventsPage() {
  const [typeFilter, setTypeFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [cursor, setCursor] = useState<number | undefined>(undefined)

  const filtered = Boolean(typeFilter || levelFilter || channelFilter)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.events({
      type: typeFilter || undefined,
      level: levelFilter || undefined,
      channel: channelFilter.trim() || undefined,
      cursor,
    }),
    queryFn: () =>
      api.listEvents({
        type: typeFilter || undefined,
        level: levelFilter || undefined,
        channel: channelFilter.trim() || undefined,
        cursor,
        limit: 50,
      }),
    retry: false,
  })

  function resetCursor() {
    setCursor(undefined)
  }

  function clearFilters() {
    setTypeFilter('')
    setLevelFilter('')
    setChannelFilter('')
    resetCursor()
  }

  return (
    <PageContainer title="Events">
      <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start">
        <Select.Root
          items={TYPE_ITEMS}
          onValueChange={value => {
            setTypeFilter(value === ALL || value == null ? '' : value)
            resetCursor()
          }}
          value={typeFilter || ALL}
        >
          <Select.Trigger aria-label="Event type" className="md:w-56">
            <Select.Value />
          </Select.Trigger>
          <Select.Popup>
            <Select.Item value={ALL}>All types</Select.Item>
            {EVENT_TYPES.map(t => (
              <Select.Item className="font-mono" key={t} value={t}>
                {t}
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Root>

        <Select.Root
          items={LEVEL_ITEMS}
          onValueChange={value => {
            setLevelFilter(value === ALL || value == null ? '' : value)
            resetCursor()
          }}
          value={levelFilter || ALL}
        >
          <Select.Trigger aria-label="Event level" className="md:w-36">
            <Select.Value />
          </Select.Trigger>
          <Select.Popup>
            <Select.Item value={ALL}>All levels</Select.Item>
            {EVENT_LEVELS.map(l => (
              <Select.Item key={l} value={l}>
                {l}
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Root>

        <Input
          aria-label="Channel ID"
          className="md:w-52"
          mono={channelFilter !== ''}
          onChange={e => {
            setChannelFilter(e.target.value)
            resetCursor()
          }}
          placeholder="Channel ID"
          value={channelFilter}
        />

        {filtered && (
          <Button onClick={clearFilters} size="sm" variant="ghost">
            Clear filters
          </Button>
        )}
      </div>

      {isLoading && !data && <LoadingState message="Fetching events…" />}
      {isError && !data && (
        <ErrorState
          lead="Couldn't load events."
          message={(error as Error)?.message}
        />
      )}

      {data && (
        <>
          {data.items.length === 0 ? (
            filtered ? (
              <EmptyState
                action={
                  <Button onClick={clearFilters} size="sm" variant="outline">
                    Clear filters
                  </Button>
                }
                body="Nothing was logged for those filters."
                message="No events match"
              />
            ) : (
              <EmptyState
                body="The bot writes one for every session, turn and restart."
                message="No events yet"
              />
            )
          ) : (
            <Panel>
              <DataList
                caption="Events"
                columns={COLUMNS}
                rowKey={evt => String(evt.id)}
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
