'use client'

import { Button, Note, Panel, PanelHead } from '@lilnas/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type JSX, useEffect } from 'react'

import { ErrorState } from 'src/app/components/error-state'
import { InlineConfirm } from 'src/app/components/inline-confirm'
import { LoadingState } from 'src/app/components/loading-state'
import { api, queryKeys } from 'src/app/lib/api'
import { authClient } from 'src/app/lib/auth-client'

import { StatusBadge } from './status-badge'

/**
 * GitHub panel: the status badge, "Link GitHub" (not linked) or "Unlink" and
 * "Linked as {name} ({email})" (linked). It owns its own
 * `queryKeys.githubStatus` query, independent of the SSH and roster panels.
 */
export function GithubSection({
  sessionPending,
  onDiscordUserId,
}: {
  sessionPending: boolean
  onDiscordUserId: (discordUserId: string | undefined) => void
}): JSX.Element {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: queryKeys.githubStatus,
    queryFn: api.getGithubStatus,
    refetchOnWindowFocus: false,
    retry: false,
  })

  // Surface the resolved discordUserId up to the page: the SSH panel needs it
  // too, and the frontend can only learn its own Discord snowflake from this
  // one server round-trip, not from useSession() alone.
  useEffect(() => {
    onDiscordUserId(statusQuery.data?.discordUserId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDiscordUserId is a stable setState-wrapping callback from the parent; including it would re-run this effect every parent render for no reason.
  }, [statusQuery.data?.discordUserId])

  const unlinkMutation = useMutation({
    mutationKey: ['github-unlink-self'],
    mutationFn: api.unlinkGithubSelf,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.githubStatus })
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitRoster })
    },
  })

  function handleLink() {
    void authClient.linkSocial({
      provider: 'github',
      scopes: ['repo', 'workflow', 'delete_repo'],
      callbackURL: '/git',
      // REQUIRED: without this, Better Auth's consent-denial/hook-failure
      // redirects fall through to the global /login error page instead of
      // landing back here on an already-authenticated user's own page.
      errorCallbackURL: '/git',
    })
  }

  const status = statusQuery.data?.status

  return (
    <section aria-label="GitHub">
      <Panel>
        <PanelHead title="GitHub" />
        <div className="flex flex-col gap-3 p-4">
          <p className="text-cap text-ink-3">
            Connect your account so tdr-code can push commits, open pull
            requests and create repositories as you. Your GitHub name and email
            become your commit identity.
          </p>

          {statusQuery.isLoading ? (
            <LoadingState
              className="border-0 bg-transparent p-0"
              message="Fetching GitHub status…"
            />
          ) : statusQuery.isError ? (
            <ErrorState
              code={(statusQuery.error as Error).message}
              lead="Couldn't load GitHub status."
              message="The server didn't answer. Try again in a minute."
            />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <StatusBadge
                  status={
                    status === 'linked' || status === 'decrypt-failed'
                      ? status
                      : 'not-linked'
                  }
                />
                {status !== 'linked' && (
                  <Button
                    data-track-id="github-link"
                    disabled={sessionPending}
                    onClick={handleLink}
                    title="Lets tdr-code open PRs, create repos and push as your GitHub account"
                    variant="accent"
                  >
                    {status === 'decrypt-failed'
                      ? 'Relink GitHub'
                      : 'Link GitHub'}
                  </Button>
                )}
                {status !== 'not-linked' && (
                  <InlineConfirm
                    confirmLabel="Unlink"
                    data-track-id="github-unlink"
                    label="Unlink"
                    onConfirm={() => unlinkMutation.mutate()}
                    pending={unlinkMutation.isPending}
                    prompt="Unlink your GitHub?"
                  />
                )}
              </div>

              {status === 'decrypt-failed' && (
                <Note lead="Token unreadable." tone="bad">
                  Your linked token can&apos;t be decrypted, so <code>gh</code>{' '}
                  and pushes are blocked. Relink GitHub to fix it.
                </Note>
              )}

              {status === 'linked' && (
                <p className="text-sm text-ink-2">
                  Linked as{' '}
                  <span className="font-medium text-ink">
                    {statusQuery.data?.derivedName}
                  </span>
                  <span className="font-mono text-mono-sm text-ink-3">
                    {' '}
                    ({statusQuery.data?.derivedEmail})
                  </span>
                </p>
              )}

              {unlinkMutation.isError && (
                <Note lead="Couldn't unlink GitHub." tone="bad">
                  You&apos;re still linked.
                  <span className="mt-0.5 block font-mono text-mono-sm text-ink-3">
                    {(unlinkMutation.error as Error).message}
                  </span>
                </Note>
              )}
            </div>
          )}
        </div>
      </Panel>
    </section>
  )
}
