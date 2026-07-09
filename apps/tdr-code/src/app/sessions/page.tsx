'use client'

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { EmptyState } from 'src/app/components/empty-state'
import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { RelativeTime } from 'src/app/components/relative-time'
import { api, queryKeys } from 'src/app/lib/api'

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

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold text-white">Sessions</h1>

      <form onSubmit={handleChannelSubmit} className="flex items-center gap-2">
        <input
          type="text"
          value={channelFilter}
          onChange={e => {
            setChannelFilter(e.target.value)
            setCursor(undefined)
          }}
          placeholder="Filter by channel ID (17-20 digits)"
          className="w-64 rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-600"
        />
        {channelFilter && (
          <button
            type="button"
            onClick={() => {
              setChannelFilter('')
              setCursor(undefined)
            }}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Clear
          </button>
        )}
      </form>

      {isLoading && !data && <LoadingState />}
      {isError && !data && <ErrorState message={(error as Error)?.message} />}

      {data && (
        <>
          {data.items.length === 0 ? (
            <EmptyState message="No sessions found" />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-left">
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                    ID
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                    Channel
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                    User
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                    Created
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                    Ended
                  </th>
                  <th className="pb-2 text-xs font-medium text-gray-500">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map(s => (
                  <tr
                    key={s.id}
                    onClick={() => router.push(`/sessions/${s.id}`)}
                    className="cursor-pointer border-b border-gray-800 hover:bg-gray-900"
                  >
                    <td className="py-3 pr-4">
                      <Link
                        href={`/sessions/${s.id}`}
                        onClick={e => e.stopPropagation()}
                        className="font-mono text-xs text-blue-400 hover:underline"
                      >
                        #{s.id}
                      </Link>
                    </td>
                    <td className="max-w-[12rem] py-3 pr-4 text-xs text-gray-300">
                      <span
                        className="block truncate"
                        title={s.channelId}
                      >
                        {s.channelName ?? s.channelId}
                      </span>
                    </td>
                    <td className="max-w-[12rem] py-3 pr-4 text-xs text-gray-400">
                      <span
                        className="block truncate"
                        title={s.triggeringUserId}
                      >
                        {s.triggeringUserDisplayName ?? s.triggeringUserId}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-gray-400">
                      <RelativeTime value={s.createdAt} />
                    </td>
                    <td className="py-3 pr-4 text-xs text-gray-400">
                      {s.endedAt ? (
                        <RelativeTime value={s.endedAt} />
                      ) : (
                        <span className="text-green-400">active</span>
                      )}
                    </td>
                    <td className="py-3 text-xs text-gray-500">
                      {s.endReason ?? '—'}
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
    </div>
  )
}
