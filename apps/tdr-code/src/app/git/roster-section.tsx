'use client'

import { Button, type Column, DataList, Panel, PanelHead } from '@lilnas/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type JSX, useState } from 'react'

import { EmptyState } from 'src/app/components/empty-state'
import { ErrorState } from 'src/app/components/error-state'
import { InlineConfirm } from 'src/app/components/inline-confirm'
import { LoadingState } from 'src/app/components/loading-state'
import { api, queryKeys } from 'src/app/lib/api'
import type { RosterEntryDto } from 'src/console/git-roster.dto'

import { StatusBadge } from './status-badge'

// Which row + credential type has its clear mutation in flight. A row has two
// independently clearable credentials, so the key carries both.
type RosterClearKey = `${string}:${'github' | 'ssh'}`

/**
 * Roster panel: one row per guild member with a break-glass "Clear" for each
 * of their credentials. Its loading, error and empty states are its own: a
 * roster failure never blocks the self-service panels above it.
 */
export function RosterSection(): JSX.Element {
  const queryClient = useQueryClient()

  const rosterQuery = useQuery({
    queryKey: queryKeys.gitRoster,
    queryFn: api.getGitRoster,
    refetchOnWindowFocus: false,
    retry: false,
    // Roster resolution calls listIdentities + AES-GCM decrypt per configured
    // member, so don't hammer it on every remount.
    staleTime: 30_000,
  })

  const [pendingKey, setPendingKey] = useState<RosterClearKey | null>(null)

  // Takes a Better Auth userId (RosterEntryDto.betterAuthUserId), never a
  // Discord snowflake: the route never accepts one.
  const clearGithubMutation = useMutation({
    mutationKey: ['roster-clear-github'],
    mutationFn: (betterAuthUserId: string) =>
      api.unlinkGithubOther(betterAuthUserId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitRoster })
    },
    onSettled: () => setPendingKey(null),
  })

  const clearSshMutation = useMutation({
    mutationKey: ['roster-clear-ssh'],
    mutationFn: (discordUserId: string) => api.deleteGitIdentity(discordUserId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitRoster })
    },
    onSettled: () => setPendingKey(null),
  })

  function clearControl(
    entry: RosterEntryDto,
    credential: 'github' | 'ssh',
    what: string,
    onConfirm: () => void,
  ): JSX.Element {
    const key: RosterClearKey = `${entry.discordUserId}:${credential}`

    if (pendingKey === key) {
      return (
        <Button disabled loading size="sm" variant="outline">
          Clearing…
        </Button>
      )
    }

    return (
      <InlineConfirm
        data-track-id={`roster-clear-${credential}`}
        disabled={pendingKey !== null}
        label="Clear"
        onConfirm={() => {
          setPendingKey(key)
          onConfirm()
        }}
        prompt={
          credential === 'github'
            ? `Unlink ${entry.displayName}'s ${what}?`
            : `Remove ${entry.displayName}'s ${what}?`
        }
      />
    )
  }

  const columns: Column<RosterEntryDto>[] = [
    {
      key: 'name',
      header: 'Discord user',
      primary: true,
      render: entry => entry.displayName,
    },
    {
      key: 'github',
      header: 'GitHub',
      render: entry => (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={entry.github} />
          {entry.github !== 'not-linked' &&
            entry.betterAuthUserId !== undefined &&
            clearControl(entry, 'github', 'GitHub', () =>
              clearGithubMutation.mutate(entry.betterAuthUserId!),
            )}
        </div>
      ),
    },
    {
      key: 'ssh',
      header: 'SSH',
      render: entry => (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={entry.ssh} />
          {entry.ssh !== 'not-configured' &&
            clearControl(entry, 'ssh', 'SSH key', () =>
              clearSshMutation.mutate(entry.discordUserId),
            )}
        </div>
      ),
    },
  ]

  return (
    <section aria-label="Roster">
      <Panel>
        <PanelHead
          caption="Every member of the Discord server"
          title="Roster"
        />
        {rosterQuery.isLoading ? (
          <div className="p-4">
            <LoadingState
              className="border-0 bg-transparent p-0"
              message="Fetching the roster…"
            />
          </div>
        ) : rosterQuery.isError ? (
          <div className="p-4">
            <ErrorState
              code={(rosterQuery.error as Error).message}
              lead="Couldn't load the roster."
              message="The server didn't answer. Try again in a minute."
            />
          </div>
        ) : (
          <DataList
            caption="Roster"
            columns={columns}
            empty={
              <div className="p-4">
                <EmptyState
                  body="Members of the Discord server show up here."
                  message="No guild members found"
                />
              </div>
            }
            rowKey={entry => entry.discordUserId}
            rows={rosterQuery.data ?? []}
          />
        )}
      </Panel>
    </section>
  )
}
