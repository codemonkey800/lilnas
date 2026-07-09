'use client'

import { cns } from '@lilnas/utils/cns'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'

import { EmptyState } from 'src/app/components/empty-state'
import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { PageContainer } from 'src/app/components/page-container'
import { RelativeTime } from 'src/app/components/relative-time'
import { api, queryKeys } from 'src/app/lib/api'
import { EVENT_LEVELS, EVENT_TYPES } from 'src/db/schema'

const LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-yellow-400',
  info: 'text-gray-400',
}

export default function EventsPage() {
  const [typeFilter, setTypeFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const [cursor, setCursor] = useState<number | undefined>(undefined)

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

  return (
    <PageContainer title="Events">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={typeFilter}
          onChange={e => {
            setTypeFilter(e.target.value)
            resetCursor()
          }}
          className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:outline-none"
        >
          <option value="">All types</option>
          {EVENT_TYPES.map(t => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          value={levelFilter}
          onChange={e => {
            setLevelFilter(e.target.value)
            resetCursor()
          }}
          className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:outline-none"
        >
          <option value="">All levels</option>
          {EVENT_LEVELS.map(l => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={channelFilter}
          onChange={e => {
            setChannelFilter(e.target.value)
            resetCursor()
          }}
          placeholder="Channel ID"
          className="w-48 rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none"
        />

        {(typeFilter || levelFilter || channelFilter) && (
          <button
            onClick={() => {
              setTypeFilter('')
              setLevelFilter('')
              setChannelFilter('')
              resetCursor()
            }}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Clear filters
          </button>
        )}
      </div>

      {isLoading && !data && <LoadingState />}
      {isError && !data && <ErrorState message={(error as Error)?.message} />}

      {data && (
        <>
          {data.items.length === 0 ? (
            <EmptyState message="No events found" />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-left">
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                    Time
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                    Level
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                    Type
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                    Channel
                  </th>
                  <th className="pb-2 text-xs font-medium text-gray-500">
                    Session
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(evt => (
                  <tr
                    key={evt.id}
                    className="border-b border-gray-800 hover:bg-gray-900"
                  >
                    <td className="py-3 pr-4 text-xs text-gray-500">
                      <RelativeTime value={evt.createdAt} />
                    </td>
                    <td
                      className={cns(
                        'py-3 pr-4 text-xs font-medium',
                        LEVEL_COLORS[evt.level] ?? 'text-gray-400',
                      )}
                    >
                      {evt.level}
                    </td>
                    <td className="py-3 pr-4 text-xs text-gray-300">
                      {evt.type}
                    </td>
                    <td className="max-w-[12rem] py-3 pr-4 text-xs text-gray-400">
                      {evt.channelId ? (
                        <span className="block truncate" title={evt.channelId}>
                          {evt.channelName ?? evt.channelId}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 text-xs text-gray-400">
                      {evt.sessionId ? (
                        <Link
                          href={`/sessions/${evt.sessionId}`}
                          className="text-blue-400 hover:underline"
                        >
                          #{evt.sessionId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {data.nextCursor !== null && (
            <button
              onClick={() => setCursor(data.nextCursor!)}
              className="mt-2 rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700"
            >
              Load more
            </button>
          )}
        </>
      )}
    </PageContainer>
  )
}
