'use client'

import { useParams } from 'next/navigation'
import type { JSX } from 'react'
import { useState } from 'react'

import { EnvFilesPanel } from 'src/components/detail/env-files'
import { ReaperPanel } from 'src/components/detail/reaper-panel'
import { ServicesPanel } from 'src/components/detail/services-table'
import { StackHeader } from 'src/components/detail/stack-header'
import {
  DetailError,
  DetailSkeleton,
  NotFound,
} from 'src/components/detail/states'
import { useStack } from 'src/components/detail/use-stack'
import { LogViewer } from 'src/components/logs/LogViewer'
import { OperationLog } from 'src/components/logs/OperationLog'
import type { Operation, StackView } from 'src/lib/api'
import { serviceName } from 'src/lib/stack-display'
import { useNow } from 'src/lib/use-now'
import { POLL_MS } from 'src/lib/use-overview'

/** Route params arrive percent-encoded (`lilnas%3Adownload`). */
function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** The stack's containers that exist, running ones first. */
function existingContainers(stack: StackView): {
  names: string[]
  running: string[]
} {
  const existing = stack.services.filter(s => s.container)
  const running = existing.filter(s => s.container?.state === 'running')
  return {
    names: [...running, ...existing.filter(s => !running.includes(s))].map(
      serviceName,
    ),
    running: running.map(serviceName),
  }
}

function StackLogs({ stack }: { stack: StackView }): JSX.Element {
  const { names, running } = existingContainers(stack)
  return <LogViewer containers={names} running={running} />
}

function StackDetail({ id }: { id: string }): JSX.Element {
  const { stack, notFound, error, refetch } = useStack(id)
  const now = useNow(1000)
  const [tracked, setTracked] = useState<Operation | null>(null)

  // Follow whichever operation the stack reports as running; keep it on
  // screen after it finishes, when the stack stops reporting it.
  if (stack?.operation && stack.operation.id !== tracked?.id) {
    setTracked(stack.operation)
  }

  return (
    <main className="mx-auto w-full max-w-[1328px] px-6 pt-[18px] pb-[30px] sm:px-8 sm:pt-[30px] sm:pb-11">
      {notFound ? (
        <NotFound id={id} />
      ) : (
        <>
          {error ? (
            <div className="mb-8">
              <DetailError
                message={error}
                onRetry={refetch}
                retryInSeconds={POLL_MS / 1000}
                stale={stack !== null}
              />
            </div>
          ) : null}

          {stack === null ? (
            error ? null : (
              <DetailSkeleton />
            )
          ) : (
            <div className="flex flex-col gap-5">
              <StackHeader
                onActed={refetch}
                onStarted={setTracked}
                stack={stack}
              />
              <ServicesPanel now={now} services={stack.services} />
              <div className="grid gap-5 md:grid-cols-2">
                <EnvFilesPanel envFiles={stack.envFiles} />
                <ReaperPanel now={now} stack={stack} />
              </div>
              {tracked ? (
                <OperationLog key={tracked.id} operation={tracked} />
              ) : null}
              <StackLogs stack={stack} />
            </div>
          )}
        </>
      )}
    </main>
  )
}

/**
 * One stack in full: its containers, env files, idle-reaper clock, the output
 * of the operation that last ran and a live container log.
 */
export default function StackDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const stackId = decodeId(id)
  // Keyed so that moving from one stack to another starts from a clean slate.
  return <StackDetail id={stackId} key={stackId} />
}
