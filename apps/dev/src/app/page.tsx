'use client'

import type { JSX } from 'react'

import {
  EmptyState,
  ErrorPanel,
  LoadingState,
} from 'src/components/overview/empty-state'
import { HostStrip } from 'src/components/overview/host-strip'
import { StackSection } from 'src/components/overview/stack-section'
import { useNow } from 'src/lib/use-now'
import { POLL_MS, useOverview } from 'src/lib/use-overview'

/**
 * The overview: every compose stack on the dev host, as a card, in two
 * groups — the lilnas apps (their deploy.dev.yml files) and the projects
 * under ~/dev.
 */
export default function HomePage(): JSX.Element {
  const { overview, error, refetch } = useOverview()
  const now = useNow(1000)

  const apps = overview?.stacks.filter(s => s.source === 'lilnas') ?? []
  const projects = overview?.stacks.filter(s => s.source === 'dev') ?? []

  return (
    <main className="mx-auto w-full max-w-[1328px] px-6 pt-[18px] pb-[30px] sm:px-8 sm:pt-[30px] sm:pb-11">
      {error ? (
        <div className="mb-8">
          <ErrorPanel
            message={error}
            onRetry={refetch}
            retryInSeconds={POLL_MS / 1000}
            stale={overview !== null}
          />
        </div>
      ) : null}

      {overview === null ? (
        error ? null : (
          <LoadingState />
        )
      ) : overview.stacks.length === 0 ? (
        <EmptyState onRefresh={refetch} />
      ) : (
        <>
          <div className="mb-8">
            <HostStrip now={now} overview={overview} />
          </div>
          <StackSection
            caption="apps/*/deploy.dev.yml"
            empty="No lilnas app has a deploy.dev.yml."
            now={now}
            onChanged={refetch}
            stacks={apps}
            title="lilnas apps"
          />
          <StackSection
            caption="~/dev/*/docker-compose*.yml"
            empty="No project under ~/dev has a docker-compose file."
            now={now}
            onChanged={refetch}
            stacks={projects}
            title="~/dev projects"
          />
        </>
      )}
    </main>
  )
}
