'use client'

import { cns } from '@lilnas/utils/cns'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'

import { EmptyState } from 'src/app/components/empty-state'
import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { RelativeTime } from 'src/app/components/relative-time'
import { api, queryKeys } from 'src/app/lib/api'
import type {
  TurnContentBlockDto,
  TurnDetailDto,
} from 'src/console/sessions.dto'

function ContentBlock({ block }: { block: TurnContentBlockDto }) {
  switch (block.kind) {
    case 'prompt':
      return (
        <div className="rounded bg-gray-800 px-3 py-2">
          <p className="mb-1 text-xs font-medium text-gray-400">Prompt</p>
          <p className="whitespace-pre-wrap text-xs text-gray-200">
            {block.text}
          </p>
          {block.images && block.images.length > 0 && (
            <p className="mt-1 text-xs text-gray-500">
              [{block.images.length} image(s)]
            </p>
          )}
        </div>
      )
    case 'agent_text':
      return (
        <div className="rounded bg-gray-900 px-3 py-2">
          <p className="mb-1 text-xs font-medium text-gray-500">Agent</p>
          <p className="whitespace-pre-wrap text-xs text-gray-300">
            {block.text}
          </p>
        </div>
      )
    case 'tool_call':
      return (
        <div className="rounded border border-gray-700 px-3 py-2">
          <p className="text-xs font-medium text-gray-400">
            <span className="text-gray-500">Tool</span> {block.title}
          </p>
          <p className="text-xs text-gray-600">
            {block.toolKind} · {block.status}
          </p>
        </div>
      )
    case 'diff':
      return (
        <div className="rounded bg-gray-900 px-3 py-2">
          <p className="mb-1 text-xs font-medium text-gray-500">
            Diff: {block.path}
          </p>
          <pre className="max-h-40 overflow-auto text-xs text-gray-300">
            {block.newText}
          </pre>
        </div>
      )
  }
}

function TurnCard({ turn }: { turn: TurnDetailDto }) {
  return (
    <div className="rounded-lg border border-gray-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">
          Turn {turn.turnIndex}
        </span>
        <div className="flex items-center gap-3">
          <span
            className={cns(
              'rounded px-1.5 py-0.5 text-xs',
              turn.status === 'completed' && 'bg-green-900 text-green-300',
              turn.status === 'running' && 'bg-yellow-900 text-yellow-300',
              (turn.status === 'errored' || turn.status === 'cancelled') &&
                'bg-red-900 text-red-300',
              turn.status === 'interrupted' && 'bg-gray-800 text-gray-400',
            )}
          >
            {turn.status}
          </span>
          {turn.endedAt && <RelativeTime value={turn.endedAt} />}
        </div>
      </div>
      <div className="space-y-2">
        {turn.content.length === 0 ? (
          <p className="text-xs text-gray-600">No content blocks</p>
        ) : (
          turn.content.map(block => (
            <ContentBlock key={block.id} block={block} />
          ))
        )}
      </div>
    </div>
  )
}

function ReconcilePanel({ sessionId }: { sessionId: number }) {
  const [triggered, setTriggered] = useState(false)

  const { data, isFetching, isError, error } = useQuery({
    queryKey: queryKeys.reconcile(sessionId),
    queryFn: () => api.reconcile(sessionId),
    enabled: triggered,
    retry: false,
    staleTime: Infinity,
  })

  return (
    <section className="rounded-lg border border-gray-800 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-300">
          Verify against claude&apos;s JSONL
        </h2>
        {!triggered && (
          <button
            onClick={() => setTriggered(true)}
            className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700"
          >
            Run reconcile
          </button>
        )}
      </div>

      {isFetching && <LoadingState message="Comparing transcript…" />}
      {isError && <ErrorState message={(error as Error)?.message} />}

      {data && (
        <>
          {data.verdict === 'cannot-reconcile' && (
            <p className="text-sm text-yellow-400">
              Cannot reconcile:{' '}
              <span className="text-yellow-300">{data.reason}</span>
            </p>
          )}
          {data.verdict === 'reconciled' && (
            <div className="space-y-2 text-sm">
              <p className="text-gray-300">
                Matched:{' '}
                <span className="font-medium text-green-400">
                  {data.matched}
                </span>
                {' · '}
                Missing in DB:{' '}
                <span
                  className={
                    data.missingInDb.length > 0
                      ? 'text-red-400'
                      : 'text-gray-500'
                  }
                >
                  {data.missingInDb.length}
                </span>
                {' · '}
                Extra in DB:{' '}
                <span
                  className={
                    data.extraInDb.length > 0
                      ? 'text-yellow-400'
                      : 'text-gray-500'
                  }
                >
                  {data.extraInDb.length}
                </span>
                {' · '}
                Mismatched:{' '}
                <span
                  className={
                    data.mismatched.length > 0
                      ? 'text-orange-400'
                      : 'text-gray-500'
                  }
                >
                  {data.mismatched.length}
                </span>
              </p>
              {data.skippedJsonlLines > 0 && (
                <p className="text-xs text-gray-500">
                  Skipped {data.skippedJsonlLines} malformed JSONL line(s)
                </p>
              )}
              {data.cappedAt !== undefined && (
                <p className="text-xs text-yellow-500">
                  JSONL truncated at {data.cappedAt} bytes
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>()
  const sessionId = parseInt(params.id, 10)

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => api.getSession(sessionId),
    retry: false,
    refetchInterval: 5_000,
  })

  if (isLoading && !data) return <LoadingState />
  if (isError && !data)
    return <ErrorState message={(error as Error)?.message} />
  if (!data) return null

  const { session, turns, droppedBlocks } = data

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/sessions"
          className="text-xs text-gray-500 hover:text-gray-300"
        >
          ← Sessions
        </Link>
        <h1 className="text-lg font-semibold text-white">
          Session #{session.id}
        </h1>
        {session.endedAt ? (
          <span className="text-xs text-gray-500">{session.endReason}</span>
        ) : (
          <span className="rounded bg-green-900 px-1.5 py-0.5 text-xs text-green-300">
            active
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-gray-800 p-4 text-xs text-gray-400">
        <div>
          Channel:{' '}
          <span className="font-mono text-gray-200">{session.channelId}</span>
        </div>
        <div>
          User:{' '}
          <span className="font-mono text-gray-200">
            {session.triggeringUserId}
          </span>
        </div>
        <div>
          Created: <RelativeTime value={session.createdAt} />
        </div>
        {session.endedAt && (
          <div>
            Ended: <RelativeTime value={session.endedAt} />
          </div>
        )}
      </div>

      {droppedBlocks > 0 && (
        <p className="text-xs text-yellow-500">
          {droppedBlocks} malformed block(s) dropped from view
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-gray-400">
          {turns.length} turn{turns.length !== 1 ? 's' : ''}
        </h2>
        {turns.length === 0 ? (
          <EmptyState message="No turns recorded" />
        ) : (
          turns.map(turn => <TurnCard key={turn.id} turn={turn} />)
        )}
      </section>

      <ReconcilePanel sessionId={session.id} />
    </div>
  )
}
