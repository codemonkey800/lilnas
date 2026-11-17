'use client'

import {
  Button,
  Field,
  Icon,
  Input,
  Note,
  Panel,
  PanelHead,
  Textarea,
} from '@lilnas/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type JSX, useEffect, useRef, useState } from 'react'

import { ErrorState } from 'src/app/components/error-state'
import { InlineConfirm } from 'src/app/components/inline-confirm'
import { LoadingState } from 'src/app/components/loading-state'
import { api, queryKeys } from 'src/app/lib/api'

import { StatusBadge } from './status-badge'

/**
 * SSH key panel: add, replace or clear the signed-in person's own identity,
 * not a list. `discordUserId` comes from the page (resolved by the GitHub
 * panel's status query); until it arrives the form is disabled, because there
 * is nothing to scope a save or clear to yet.
 */
export function SshSection({
  discordUserId,
}: {
  discordUserId: string | undefined
}): JSX.Element {
  const queryClient = useQueryClient()

  // There is no dedicated single-identity GET route, so this lists everyone's
  // (one row per configured member of a small Discord server) and picks the
  // current user's own row client-side.
  const identitiesQuery = useQuery({
    queryKey: queryKeys.gitIdentity,
    queryFn: api.listGitIdentities,
    refetchOnWindowFocus: false,
    retry: false,
  })

  // The same query the GitHub panel issued, served from cache.
  const githubStatusQuery = useQuery({
    queryKey: queryKeys.githubStatus,
    queryFn: api.getGithubStatus,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const githubLinked = githubStatusQuery.data?.status === 'linked'
  const githubName = githubStatusQuery.data?.derivedName ?? ''
  const githubEmail = githubStatusQuery.data?.derivedEmail ?? ''

  const myIdentity = identitiesQuery.data?.find(
    item => item.discordUserId === discordUserId,
  )

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [saved, setSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    [],
  )

  const upsertMutation = useMutation({
    mutationKey: ['ssh-identity-upsert'],
    mutationFn: api.upsertGitIdentity,
    onSuccess: () => {
      setSaved(true)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2500)
      setPrivateKey('')
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitIdentity })
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitRoster })
    },
  })

  // Self-clear: no discordUserId param, the server resolves the acting user's
  // own snowflake from the session. The roster's break-glass clear is a
  // different call (`api.deleteGitIdentity(id)`) for someone else.
  const clearMutation = useMutation({
    mutationKey: ['ssh-identity-clear'],
    mutationFn: () => api.deleteGitIdentitySelf(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitIdentity })
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitRoster })
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!discordUserId) return
    setSaved(false)
    upsertMutation.mutate({
      name: githubLinked && githubName ? githubName : name,
      email: githubLinked && githubEmail ? githubEmail : email,
      privateKey,
    })
  }

  const formDisabled = !discordUserId
  const identityFixed = formDisabled || githubLinked

  return (
    <section aria-label="SSH key">
      <Panel>
        <PanelHead title="SSH key" />
        <div className="flex flex-col gap-4 p-4">
          <p className="text-cap text-ink-3">
            For pushing to non-GitHub remotes over SSH, such as a self-hosted
            Git server. It also signs your commits. Name and email are used for
            commit identity only when GitHub is not linked.
          </p>

          {identitiesQuery.isLoading ? (
            <LoadingState
              className="border-0 bg-transparent p-0"
              message="Fetching your SSH identity…"
            />
          ) : identitiesQuery.isError ? (
            <ErrorState
              code={(identitiesQuery.error as Error).message}
              lead="Couldn't load your SSH identity."
              message="The server didn't answer. Try again in a minute."
            />
          ) : (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge
                    status={
                      myIdentity
                        ? myIdentity.status === 'configured'
                          ? 'configured'
                          : 'decrypt-failed'
                        : 'not-configured'
                    }
                  />
                </div>
                {myIdentity?.status === 'decrypt_failed' && (
                  <Note lead="Key unreadable." tone="bad">
                    The key can&apos;t be decrypted, so pushes are blocked.
                    Upload a key again to restore access.
                  </Note>
                )}
                {myIdentity && (
                  <p className="text-cap text-ink-3">
                    {myIdentity.name} ({myIdentity.email}) ·{' '}
                    <span className="font-mono text-mono-sm">
                      {myIdentity.fingerprint}
                    </span>
                  </p>
                )}
              </div>

              {githubLinked && (
                <Note
                  lead="Name and email come from your linked GitHub account."
                  tone="accent"
                >
                  Commits use GitHub&apos;s noreply address, which GitHub
                  resolves to your real email in commit attribution.{' '}
                  <span className="font-mono text-mono-sm">{githubEmail}</span>
                </Note>
              )}

              <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field label="Name">
                    <Input
                      disabled={identityFixed}
                      placeholder={githubLinked ? undefined : 'Jane Doe'}
                      value={githubLinked ? githubName : name}
                      onChange={e => !githubLinked && setName(e.target.value)}
                    />
                  </Field>
                  <Field label="Email">
                    <Input
                      disabled={identityFixed}
                      mono={githubLinked}
                      placeholder={
                        githubLinked ? undefined : 'jane@example.com'
                      }
                      type="email"
                      value={githubLinked ? githubEmail : email}
                      onChange={e => !githubLinked && setEmail(e.target.value)}
                    />
                  </Field>
                  <Field
                    className="md:col-span-2"
                    hint="Write-only. It isn't shown again after you save."
                    label="SSH private key"
                  >
                    <Textarea
                      disabled={formDisabled}
                      mono
                      placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…'}
                      rows={5}
                      value={privateKey}
                      onChange={e => setPrivateKey(e.target.value)}
                    />
                  </Field>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    data-track-id="ssh-identity-save"
                    disabled={formDisabled || upsertMutation.isPending}
                    loading={upsertMutation.isPending}
                    type="submit"
                    variant="accent"
                  >
                    {upsertMutation.isPending
                      ? 'Saving…'
                      : myIdentity
                        ? 'Replace key'
                        : 'Save key'}
                  </Button>

                  {myIdentity && (
                    <InlineConfirm
                      data-track-id="ssh-identity-clear"
                      label="Clear"
                      onConfirm={() => {
                        if (discordUserId) clearMutation.mutate()
                      }}
                      pending={clearMutation.isPending}
                      prompt="Remove your SSH key?"
                    />
                  )}

                  {saved && (
                    <span
                      className="inline-flex items-center gap-1.5 text-sm text-ok"
                      role="status"
                    >
                      <Icon name="check" size={14} />
                      Saved
                    </span>
                  )}
                </div>

                {upsertMutation.isError && !saved && (
                  <Note lead="Couldn't save the key." tone="bad">
                    Nothing was changed.
                    <span className="mt-0.5 block font-mono text-mono-sm text-ink-3">
                      {(upsertMutation.error as Error).message}
                    </span>
                  </Note>
                )}
                {clearMutation.isError && (
                  <Note lead="Couldn't remove the key." tone="bad">
                    Your key is still stored.
                    <span className="mt-0.5 block font-mono text-mono-sm text-ink-3">
                      {(clearMutation.error as Error).message}
                    </span>
                  </Note>
                )}
              </form>
            </>
          )}
        </div>
      </Panel>
    </section>
  )
}
