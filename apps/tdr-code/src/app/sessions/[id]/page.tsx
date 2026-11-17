'use client'

import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  Icon,
  Note,
  Panel,
  PanelHead,
} from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { notFound, useParams } from 'next/navigation'
import { useEffect, useState } from 'react'

import { EmptyState } from 'src/app/components/empty-state'
import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { PageContainer } from 'src/app/components/page-container'
import { RelativeTime } from 'src/app/components/relative-time'
import { api, queryKeys } from 'src/app/lib/api'
import { logReconcileResult } from 'src/app/lib/reconcile-logging'
import { useLiveStream } from 'src/app/lib/use-live-stream'
import type {
  SessionDetailResponseDto,
  TurnContentBlockDto,
  TurnDetailDto,
} from 'src/console/sessions.dto'
import { sessionTopic } from 'src/sse/sse.types'

// Trailing-throttle window for this page's session:<id> topic (see U7 of
// docs/archive/plans/2026-07-05-002-feat-tdr-code-sse-push-plan.md). This is the
// highest-churn topic — an active agent turn can emit many chunks/tool-call-
// updates per second — so unlike the low-volume live/bot-status callers,
// this is the first useLiveStream() call site to turn the throttle on.
// 300ms: the midpoint of the plan's own 250-400ms band. Fast enough that a
// burst still reads as live to the eye; slow enough to keep the refetch rate
// comfortably under the plan's own <=4 refetches/sec acceptance bar with
// margin (a 300ms trailing throttle caps sustained-burst refetches at
// ~3.3/sec, before even accounting for diff-truncation cuts to per-refetch
// cost).
const SESSION_STREAM_THROTTLE_MS = 300

// Plan-mode support: display label for a settled ExitPlanMode gate's
// planOutcome (see ToolCallPayload in db/schema.ts). Absent entirely while
// still pending — no 'pending' entry needed.
const PLAN_OUTCOME_LABEL: Record<
  'accepted' | 'rejected' | 'cancelled' | 'superseded',
  string
> = {
  accepted: 'Plan approved',
  rejected: 'Plan rejected',
  cancelled: 'Plan cancelled',
  superseded: 'Superseded by follow-up',
}

const TURN_BADGE: Record<
  TurnDetailDto['status'],
  { tone: BadgeTone; label: string; live?: boolean }
> = {
  completed: { tone: 'ok', label: 'Completed' },
  running: { tone: 'accent', label: 'Running', live: true },
  errored: { tone: 'bad', label: 'Errored' },
  cancelled: { tone: 'warn', label: 'Cancelled' },
  interrupted: { tone: 'mute', label: 'Interrupted' },
}

const BLOCK_LABEL = 'shrink-0 text-label text-ink-3 uppercase'

// A turn's blocks sit on three surfaces so it scans: the person's prompt is a
// raised well, the agent's text and diffs a sunk one, a tool call an outlined
// row.
function ContentBlock({ block }: { block: TurnContentBlockDto }) {
  switch (block.kind) {
    case 'prompt':
      return (
        <div className="rounded-md bg-surface-2 px-3 py-2">
          <p className={cns(BLOCK_LABEL, 'mb-1')}>Prompt</p>
          <p className="text-sm whitespace-pre-wrap text-ink">{block.text}</p>
          {block.images && block.images.length > 0 && (
            <p className="mt-1.5 text-cap text-ink-3">
              {block.images.length}{' '}
              {block.images.length === 1 ? 'image' : 'images'} attached
            </p>
          )}
        </div>
      )
    case 'agent_text':
      return (
        <div className="rounded-md border border-line-soft bg-bg-sunk px-3 py-2">
          <p className={cns(BLOCK_LABEL, 'mb-1')}>Agent</p>
          <p className="text-sm whitespace-pre-wrap text-ink-2">{block.text}</p>
        </div>
      )
    case 'tool_call':
      return (
        <div className="rounded-md border border-line px-3 py-2">
          <p className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className={BLOCK_LABEL}>Tool</span>
            <span className="min-w-0 truncate font-mono text-mono-sm text-ink">
              {block.title}
            </span>
          </p>
          <p className="mt-0.5 font-mono text-mono-sm text-ink-3">
            {block.toolKind} ·{' '}
            <span className={block.status === 'failed' ? 'text-bad' : ''}>
              {block.status}
            </span>
            {block.planOutcome && ` · ${PLAN_OUTCOME_LABEL[block.planOutcome]}`}
          </p>
          {block.planText && (
            <p className="mt-1.5 text-sm whitespace-pre-wrap text-ink-2">
              {block.planText}
            </p>
          )}
        </div>
      )
    case 'diff':
      return (
        <div className="rounded-md border border-line-soft bg-bg-sunk px-3 py-2">
          <p className="mb-1 flex min-w-0 items-baseline gap-2">
            <span className={BLOCK_LABEL}>Diff</span>
            <span className="min-w-0 truncate font-mono text-mono-sm text-ink-2">
              {block.path}
            </span>
          </p>
          <pre className="max-h-40 overflow-auto font-mono text-mono-sm text-ink-2">
            {block.newText}
          </pre>
        </div>
      )
    default:
      block satisfies never
      return null
  }
}

function TurnCard({ turn }: { turn: TurnDetailDto }) {
  const { tone, label, live } = TURN_BADGE[turn.status]
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-h3">Turn {turn.turnIndex}</h3>
        <div className="flex items-center gap-3">
          <Badge live={live} tone={tone}>
            {label}
          </Badge>
          {turn.endedAt && (
            <span className="text-cap text-ink-3 tabular-nums">
              <RelativeTime value={turn.endedAt} />
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {turn.content.length === 0 ? (
          <p className="text-cap text-ink-3">No content blocks</p>
        ) : (
          turn.content.map(block => (
            <ContentBlock key={block.id} block={block} />
          ))
        )}
      </div>
    </Card>
  )
}

// A count takes the colour of what it means only when it's non-zero: matched
// is ok, missing is bad, extra and mismatched are warn.
const COUNT_TONE = {
  ok: 'text-ok',
  bad: 'text-bad',
  warn: 'text-warn',
} as const

function ReconcileCount({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: keyof typeof COUNT_TONE
}) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2">
      <dd
        className={cns(
          'text-h2 tabular-nums',
          value > 0 ? COUNT_TONE[tone] : 'text-ink-3',
        )}
      >
        {value}
      </dd>
      <dt className="text-label text-ink-3 uppercase">{label}</dt>
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

  // Logs what reconcile actually found, not just that someone ran it — a
  // clean result and a drift result are distinguishable in the log without
  // anyone needing to be looking at this page when it happens. `data` only
  // ever resolves once per mount (staleTime: Infinity, no re-trigger
  // affordance once triggered), so this fires at most once per visit.
  useEffect(() => {
    if (!data) return
    logReconcileResult(sessionId, data)
  }, [data, sessionId])

  return (
    <Panel>
      <PanelHead title="Verify against claude's JSONL">
        {!triggered && (
          <Button
            data-track-id="session-run-reconcile"
            onClick={() => setTriggered(true)}
            size="sm"
          >
            Run reconcile
          </Button>
        )}
      </PanelHead>

      {(isFetching || isError || data) && (
        <div className="flex flex-col gap-3 p-4">
          {isFetching && <LoadingState message="Comparing transcript…" />}
          {isError && (
            <ErrorState
              lead="Couldn't compare the transcript."
              message={(error as Error)?.message}
            />
          )}

          {data?.verdict === 'cannot-reconcile' && (
            <Note lead="Nothing to compare against." tone="warn">
              <span className="font-mono text-mono-sm">{data.reason}</span>
            </Note>
          )}
          {data?.verdict === 'reconciled' && (
            <>
              <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <ReconcileCount
                  label="Matched"
                  tone="ok"
                  value={data.matched}
                />
                <ReconcileCount
                  label="Missing in DB"
                  tone="bad"
                  value={data.missingInDb.length}
                />
                <ReconcileCount
                  label="Extra in DB"
                  tone="warn"
                  value={data.extraInDb.length}
                />
                <ReconcileCount
                  label="Mismatched"
                  tone="warn"
                  value={data.mismatched.length}
                />
              </dl>
              {data.skippedJsonlLines > 0 && (
                <p className="text-cap text-ink-3">
                  Skipped {data.skippedJsonlLines} malformed JSONL{' '}
                  {data.skippedJsonlLines === 1 ? 'line' : 'lines'}
                </p>
              )}
              {data.cappedAt !== undefined && (
                <Note lead="JSONL truncated." tone="warn">
                  Only the first{' '}
                  <span className="font-mono text-mono-sm">
                    {data.cappedAt} bytes
                  </span>{' '}
                  were compared.
                </Note>
              )}
            </>
          )}
        </div>
      )}
    </Panel>
  )
}

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>()
  const sessionId = Number(params.id)
  if (!Number.isInteger(sessionId) || sessionId <= 0) notFound()

  useLiveStream([sessionTopic(sessionId)], {
    throttleMs: SESSION_STREAM_THROTTLE_MS,
  })

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => api.getSession(sessionId),
    retry: false,
    // Poll every 5s for active sessions so the page recovers if SSE events
    // are missed (e.g. EventSource drop during a long agent turn).
    refetchInterval: query =>
      (query.state.data as SessionDetailResponseDto | undefined)?.session
        .endedAt
        ? false
        : 5_000,
  })

  if (isLoading && !data) {
    return (
      <PageContainer>
        <div className="mx-auto max-w-3xl">
          <LoadingState message={`Fetching session #${sessionId}…`} />
        </div>
      </PageContainer>
    )
  }
  if (isError && !data) {
    return (
      <PageContainer>
        <div className="mx-auto max-w-3xl">
          <ErrorState
            lead={`Couldn't load session #${sessionId}.`}
            message={(error as Error)?.message}
          />
        </div>
      </PageContainer>
    )
  }
  if (!data) return null

  const { session, turns, droppedBlocks } = data

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Link
            className="inline-flex w-fit items-center gap-1.5 text-sm text-ink-3 hover:text-ink"
            href="/sessions"
          >
            <Icon className="size-3 -scale-x-100 text-ink-4" name="arrow" />
            Sessions
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-h2">
              Session <span className="font-mono">#{session.id}</span>
            </h1>
            {session.endedAt ? (
              session.endReason && (
                <span className="font-mono text-mono-sm text-ink-3">
                  {session.endReason}
                </span>
              )
            ) : (
              <Badge live tone="ok">
                Active
              </Badge>
            )}
          </div>
        </div>

        <Card>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
            <MetaItem label="Channel">
              <span
                className="font-mono text-mono-sm text-ink"
                title={session.channelId}
              >
                {session.channelName ?? session.channelId}
              </span>
            </MetaItem>
            <MetaItem label="User">
              <span title={session.triggeringUserId}>
                {session.triggeringUserDisplayName ?? session.triggeringUserId}
              </span>
            </MetaItem>
            <MetaItem label="Created">
              <span className="tabular-nums">
                <RelativeTime value={session.createdAt} />
              </span>
            </MetaItem>
            {session.endedAt && (
              <MetaItem label="Ended">
                <span className="tabular-nums">
                  <RelativeTime value={session.endedAt} />
                </span>
              </MetaItem>
            )}
          </dl>
        </Card>

        {droppedBlocks > 0 && (
          <Note
            lead={`${droppedBlocks} malformed ${
              droppedBlocks === 1 ? 'block' : 'blocks'
            } dropped from view.`}
            tone="warn"
          />
        )}

        <section className="flex flex-col gap-3">
          <h2 className="text-h3">
            {turns.length} turn{turns.length !== 1 ? 's' : ''}
          </h2>
          {turns.length === 0 ? (
            <EmptyState
              body="The session started but hasn't been given a prompt."
              message="No turns recorded"
            />
          ) : (
            turns.map(turn => <TurnCard key={turn.id} turn={turn} />)
          )}
        </section>

        <ReconcilePanel sessionId={session.id} />
      </div>
    </PageContainer>
  )
}

function MetaItem({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 text-label text-ink-3 uppercase">{label}</dt>
      <dd className="truncate text-[13.5px]">{children}</dd>
    </div>
  )
}
