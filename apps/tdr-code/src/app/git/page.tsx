'use client'

import { cns } from '@lilnas/utils/cns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { EmptyState } from 'src/app/components/empty-state'
import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { PageContainer } from 'src/app/components/page-container'
import { api, queryKeys } from 'src/app/lib/api'
import { authClient, useSession } from 'src/app/lib/auth-client'
import type { RosterEntryDto } from 'src/console/git-roster.dto'

// ──────────────────────────────────────────────────────────────────────────────
// Shared visual language, adapted from git-identity/page.tsx's StatusChip —
// widened to cover the GitHub roster status ('linked'/'not-linked') and the
// SSH statuses ('configured'/'not-configured'/'decrypt-failed') this page
// needs, on top of the original 'configured'/'decrypt_failed' pair. Kept as
// ONE component (not a GitHub-specific and an SSH-specific chip) so both
// sections and the roster table render status pills with visually
// consistent color semantics: green = good, red = broken, gray = absent.
// ──────────────────────────────────────────────────────────────────────────────

type ChipStatus =
  | 'configured'
  | 'decrypt_failed'
  | 'linked'
  | 'not-linked'
  | 'not-configured'
  | 'decrypt-failed'

const CHIP_LABEL: Record<ChipStatus, string> = {
  configured: 'Configured',
  decrypt_failed: 'Decrypt/parse-failed',
  linked: 'Linked',
  'not-linked': 'Not linked',
  'not-configured': 'Not configured',
  'decrypt-failed': 'Decrypt/parse-failed',
}

function StatusChip({ status }: { status: ChipStatus }) {
  const isGood = status === 'configured' || status === 'linked'
  const isBad = status === 'decrypt_failed' || status === 'decrypt-failed'

  return (
    <span
      className={cns(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
        isGood && 'bg-green-900 text-green-300',
        isBad && 'bg-red-900 text-red-300',
        !isGood && !isBad && 'bg-gray-800 text-gray-400',
      )}
    >
      {CHIP_LABEL[status]}
    </span>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// (1) GitHub section — status badge, "Link GitHub" (not-linked) or
// "Unlink" + "Linked as {name} ({email})" (linked). Uses its own
// queryKeys.githubStatus query, independent of the SSH/roster sections
// below (each section owns its own query lifecycle per this unit's brief).
// ──────────────────────────────────────────────────────────────────────────────

function GithubSection({
  sessionPending,
  onDiscordUserId,
}: {
  sessionPending: boolean
  onDiscordUserId: (discordUserId: string | undefined) => void
}) {
  const queryClient = useQueryClient()

  const statusQuery = useQuery({
    queryKey: queryKeys.githubStatus,
    queryFn: api.getGithubStatus,
    refetchOnWindowFocus: false,
    retry: false,
  })

  // Surface the resolved discordUserId up to the page (the SSH section below
  // needs it too — see this page's own header comment on why the frontend
  // has to learn its own Discord snowflake from this one server round-trip
  // rather than from useSession() alone).
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
      // REQUIRED — without this, Better Auth's consent-denial/hook-failure
      // redirects fall through to the global /login error page instead of
      // landing back here on an already-authenticated user's own page (see
      // the plan's Key Technical Decisions for the full trace).
      errorCallbackURL: '/git',
    })
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-gray-300">GitHub</h2>
      <p className="text-xs text-gray-500">
        Connect your GitHub account so tdr-code can push commits, open pull
        requests, and create repositories as you. Your GitHub name and email
        become your git commit identity when linked.
      </p>

      {statusQuery.isLoading ? (
        <LoadingState />
      ) : statusQuery.isError ? (
        <ErrorState message={(statusQuery.error as Error).message} />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <StatusChip
              status={statusQuery.data?.linked ? 'linked' : 'not-linked'}
            />
            {!statusQuery.data?.linked && (
              <button
                type="button"
                onClick={handleLink}
                disabled={sessionPending}
                title="Lets tdr-code open PRs, create repos, and push on your behalf as your GitHub account"
                data-track-id="github-link"
                className={cns(
                  'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  sessionPending
                    ? 'bg-gray-700 text-gray-400 opacity-50 cursor-not-allowed'
                    : 'bg-blue-700 text-blue-100 hover:bg-blue-600',
                )}
              >
                Link GitHub
              </button>
            )}
            {statusQuery.data?.linked && (
              <button
                type="button"
                onClick={() => unlinkMutation.mutate()}
                disabled={unlinkMutation.isPending}
                data-track-id="github-unlink"
                className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50"
              >
                {unlinkMutation.isPending ? 'Unlinking…' : 'Unlink'}
              </button>
            )}
          </div>

          {statusQuery.data?.linked && (
            <p className="text-xs text-gray-400">
              Linked as {statusQuery.data.derivedName} (
              {statusQuery.data.derivedEmail})
            </p>
          )}

          {unlinkMutation.isError && (
            <p className="text-xs text-red-400">
              {(unlinkMutation.error as Error).message}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// (2) SSH key section — git-identity/page.tsx's add/replace/clear form,
// scoped to a SINGLE identity (the logged-in user's own), not a list — no
// Discord-member dropdown (R2). `discordUserId` is passed down from the page
// (resolved via the GitHub section's own status query — see this page's own
// header comment on why the frontend needs a server round-trip to learn its
// own snowflake). Until discordUserId resolves, the form's submit/clear
// actions are disabled — there is nothing to scope them to yet.
// ──────────────────────────────────────────────────────────────────────────────

function SshSection({ discordUserId }: { discordUserId: string | undefined }) {
  const queryClient = useQueryClient()

  // Reuses the SAME git-identity list endpoint the old admin-by-snowflake
  // page used — there is no dedicated "single identity" GET route, so this
  // filters the full list down to the current user's own row client-side.
  // The list is small (one row per configured member of a small personal
  // Discord server, per discord-directory.service.ts's own "not worth
  // paging past 1000 members" precedent), so this is not a meaningful cost.
  const identitiesQuery = useQuery({
    queryKey: queryKeys.gitIdentity,
    queryFn: api.listGitIdentities,
    refetchOnWindowFocus: false,
    retry: false,
  })

  // Reuses the same query GithubSection already issued — React Query serves
  // it from cache, no second network request.
  const githubStatusQuery = useQuery({
    queryKey: queryKeys.githubStatus,
    queryFn: api.getGithubStatus,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const githubLinked = githubStatusQuery.data?.linked ?? false
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

  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  // Self-clear (U5) — no discordUserId param; the server resolves the
  // acting user's own snowflake from the session. This is a DIFFERENT call
  // site from the roster's break-glass clear below (RosterSection's
  // clearSshMutation), which still targets api.deleteGitIdentity(id) for a
  // DIFFERENT (not the current) user and is intentionally left unchanged.
  const clearMutation = useMutation({
    mutationKey: ['ssh-identity-clear'],
    mutationFn: () => api.deleteGitIdentitySelf(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitIdentity })
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitRoster })
    },
    onSettled: () => {
      setConfirmClearOpen(false)
    },
  })

  function handleSubmit(e: React.FormEvent) {
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

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-medium text-gray-300">SSH key</h2>
      <p className="text-xs text-gray-500">
        Required for pushing to non-GitHub remotes over SSH (e.g., self-hosted
        Git servers). Also serves as your commit signing key. Name and email are
        only used for commit identity when GitHub is not linked.
      </p>

      {identitiesQuery.isLoading ? (
        <LoadingState />
      ) : identitiesQuery.isError ? (
        <ErrorState message={(identitiesQuery.error as Error).message} />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <StatusChip
              status={
                myIdentity
                  ? myIdentity.status === 'configured'
                    ? 'configured'
                    : 'decrypt-failed'
                  : 'not-configured'
              }
            />
            {myIdentity?.status === 'decrypt_failed' && (
              <span className="text-xs text-red-400">
                Key cannot be decrypted — pushes blocked. Re-upload a key to
                restore access.
              </span>
            )}
          </div>

          {myIdentity && (
            <p className="text-xs text-gray-500">
              {myIdentity.name} ({myIdentity.email}) — fingerprint{' '}
              <span className="font-mono">{myIdentity.fingerprint}</span>
            </p>
          )}

          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            {githubLinked && (
              <div className="sm:col-span-2 rounded border border-blue-800 bg-blue-950/50 px-3 py-2.5 text-xs text-blue-300 space-y-1">
                <p className="font-medium">
                  Name and email are sourced from your linked GitHub account.
                </p>
                <p className="text-blue-400">
                  Commits will use{' '}
                  <span className="font-mono">{githubEmail}</span> —
                  GitHub&apos;s privacy-preserving noreply format. GitHub
                  automatically resolves it to your real email when viewing
                  commit attribution.
                </p>
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-300">
                Name
              </label>
              <input
                type="text"
                value={githubLinked ? githubName : name}
                onChange={e => !githubLinked && setName(e.target.value)}
                placeholder={!githubLinked ? 'Jane Doe' : undefined}
                disabled={formDisabled || githubLinked}
                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-gray-300">
                Email
              </label>
              <input
                type="email"
                value={githubLinked ? githubEmail : email}
                onChange={e => !githubLinked && setEmail(e.target.value)}
                placeholder={!githubLinked ? 'jane@example.com' : undefined}
                disabled={formDisabled || githubLinked}
                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <label className="block text-xs font-medium text-gray-300">
                SSH private key (write-only — not displayed after save)
              </label>
              <textarea
                value={privateKey}
                onChange={e => setPrivateKey(e.target.value)}
                rows={5}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;..."
                disabled={formDisabled}
                className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100 focus:border-gray-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button
                type="submit"
                disabled={formDisabled || upsertMutation.isPending}
                data-track-id="ssh-identity-save"
                className={cns(
                  'rounded px-4 py-2 text-sm font-medium transition-colors',
                  formDisabled || upsertMutation.isPending
                    ? 'bg-gray-700 text-gray-400 opacity-50 cursor-not-allowed'
                    : 'bg-blue-700 text-blue-100 hover:bg-blue-600',
                )}
              >
                {upsertMutation.isPending
                  ? 'Saving…'
                  : myIdentity
                    ? 'Replace key'
                    : 'Save key'}
              </button>

              {myIdentity && !confirmClearOpen && (
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(true)}
                  disabled={clearMutation.isPending}
                  data-track-id="ssh-identity-clear"
                  className="rounded bg-gray-800 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                >
                  Clear
                </button>
              )}
              {myIdentity && confirmClearOpen && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    Remove your SSH key?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (discordUserId) clearMutation.mutate()
                    }}
                    disabled={clearMutation.isPending}
                    data-track-id="ssh-identity-clear-confirm"
                    className="rounded bg-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-800 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearOpen(false)}
                    disabled={clearMutation.isPending}
                    data-track-id="ssh-identity-clear-cancel"
                    className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {saved && <span className="text-xs text-green-400">Saved</span>}
              {upsertMutation.isError && !saved && (
                <span className="text-xs text-red-400">
                  {(upsertMutation.error as Error).message}
                </span>
              )}
              {clearMutation.isError && (
                <span className="text-xs text-red-400">
                  {(clearMutation.error as Error).message}
                </span>
              )}
            </div>
          </form>
        </>
      )}
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// (3) Roster section — read-only table, one row per guild member, with
// independent break-glass "Clear" actions for GitHub and SSH. Renders its
// OWN LoadingState/ErrorState/EmptyState, entirely independent of the
// GitHub/SSH sections' own query state above (per this unit's brief: a
// roster-fetch failure must never block the self-service sections).
// ──────────────────────────────────────────────────────────────────────────────

// Tracks which row+credential-type currently has its inline confirm/cancel
// toggle open or its clear mutation in flight, so two different rows'
// confirm panels never interfere with each other (mirrors
// git-identity/page.tsx's own clearPendingFor-by-discordUserId pattern,
// widened here to also key on credential type since a single row has TWO
// independent clearable credentials).
type RosterClearKey = `${string}:${'github' | 'ssh'}`

function RosterRow({
  entry,
  confirmKey,
  onOpenConfirm,
  onCancelConfirm,
  onClearGithub,
  onClearSsh,
  pendingKey,
}: {
  entry: RosterEntryDto
  confirmKey: RosterClearKey | null
  onOpenConfirm: (key: RosterClearKey) => void
  onCancelConfirm: () => void
  // Better Auth userId, NOT a Discord snowflake — see RosterEntryDto's
  // betterAuthUserId doc comment for why.
  onClearGithub: (betterAuthUserId: string) => void
  onClearSsh: (discordUserId: string) => void
  pendingKey: RosterClearKey | null
}) {
  const githubKey: RosterClearKey = `${entry.discordUserId}:github`
  const sshKey: RosterClearKey = `${entry.discordUserId}:ssh`

  function renderClearControl(
    key: RosterClearKey,
    label: string,
    disabled: boolean,
    onConfirm: () => void,
  ) {
    if (pendingKey === key) {
      return (
        <button
          disabled
          className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-500 opacity-50"
        >
          Clearing…
        </button>
      )
    }
    if (confirmKey === key) {
      return (
        <div className="flex items-center gap-1">
          <button
            onClick={onConfirm}
            disabled={disabled}
            data-track-id={`roster-clear-${key.split(':')[1]}-confirm`}
            className="rounded bg-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-800 disabled:opacity-50"
          >
            Confirm
          </button>
          <button
            onClick={onCancelConfirm}
            data-track-id={`roster-clear-${key.split(':')[1]}-cancel`}
            className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      )
    }
    return (
      <button
        onClick={() => onOpenConfirm(key)}
        disabled={disabled}
        data-track-id={`roster-clear-${key.split(':')[1]}`}
        className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
      >
        {label}
      </button>
    )
  }

  const anyPending = pendingKey !== null

  return (
    <tr className="border-b border-gray-800">
      <td className="py-3 pr-4 text-xs text-gray-200">{entry.displayName}</td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <StatusChip status={entry.github} />
          {entry.github === 'linked' &&
            entry.betterAuthUserId !== undefined &&
            renderClearControl(githubKey, 'Clear', anyPending, () =>
              onClearGithub(entry.betterAuthUserId!),
            )}
        </div>
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <StatusChip status={entry.ssh} />
          {entry.ssh !== 'not-configured' &&
            renderClearControl(sshKey, 'Clear', anyPending, () =>
              onClearSsh(entry.discordUserId),
            )}
        </div>
      </td>
    </tr>
  )
}

function RosterSection() {
  const queryClient = useQueryClient()

  const rosterQuery = useQuery({
    queryKey: queryKeys.gitRoster,
    queryFn: api.getGitRoster,
    refetchOnWindowFocus: false,
    retry: false,
    // Roster resolution calls listIdentities + AES-GCM decrypt per configured
    // member — avoid hammering on every remount.
    staleTime: 30_000,
  })

  const [confirmKey, setConfirmKey] = useState<RosterClearKey | null>(null)
  const [pendingKey, setPendingKey] = useState<RosterClearKey | null>(null)

  // Break-glass clear takes a Better Auth userId (RosterEntryDto's
  // betterAuthUserId — see that field's own doc comment for why: the route
  // never accepts a Discord snowflake, and the two ids are never the same
  // value for any user in this app).
  const clearGithubMutation = useMutation({
    mutationKey: ['roster-clear-github'],
    mutationFn: (betterAuthUserId: string) =>
      api.unlinkGithubOther(betterAuthUserId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitRoster })
    },
    onSettled: () => {
      setPendingKey(null)
      setConfirmKey(null)
    },
  })

  const clearSshMutation = useMutation({
    mutationKey: ['roster-clear-ssh'],
    mutationFn: (discordUserId: string) => api.deleteGitIdentity(discordUserId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitRoster })
    },
    onSettled: () => {
      setPendingKey(null)
      setConfirmKey(null)
    },
  })

  function handleOpenConfirm(key: RosterClearKey) {
    setConfirmKey(key)
  }

  function handleCancelConfirm() {
    setConfirmKey(null)
  }

  // Called with the row's betterAuthUserId — see RosterRow's onClearGithub
  // prop. pendingKey/confirmKey are still tracked by discordUserId (matching
  // RosterRow's own githubKey derivation), so the Better Auth id is threaded
  // through only to the mutation call itself.
  function handleClearGithub(discordUserId: string, betterAuthUserId: string) {
    const key: RosterClearKey = `${discordUserId}:github`
    setPendingKey(key)
    clearGithubMutation.mutate(betterAuthUserId)
  }

  function handleClearSsh(discordUserId: string) {
    const key: RosterClearKey = `${discordUserId}:ssh`
    setPendingKey(key)
    clearSshMutation.mutate(discordUserId)
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-gray-300">Roster</h2>

      {rosterQuery.isLoading ? (
        <LoadingState />
      ) : rosterQuery.isError ? (
        <ErrorState message={(rosterQuery.error as Error).message} />
      ) : !rosterQuery.data || rosterQuery.data.length === 0 ? (
        <EmptyState message="No guild members found." />
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                Discord user
              </th>
              <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                GitHub
              </th>
              <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                SSH
              </th>
            </tr>
          </thead>
          <tbody>
            {rosterQuery.data.map(entry => (
              <RosterRow
                key={entry.discordUserId}
                entry={entry}
                confirmKey={confirmKey}
                onOpenConfirm={handleOpenConfirm}
                onCancelConfirm={handleCancelConfirm}
                onClearGithub={betterAuthUserId =>
                  handleClearGithub(entry.discordUserId, betterAuthUserId)
                }
                onClearSsh={handleClearSsh}
                pendingKey={pendingKey}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export default function GitPage() {
  const { isPending: sessionPending } = useSession()
  const [discordUserId, setDiscordUserId] = useState<string | undefined>(
    undefined,
  )

  return (
    <PageContainer title="Git" spacing={10}>

      <GithubSection
        sessionPending={sessionPending}
        onDiscordUserId={setDiscordUserId}
      />

      <SshSection discordUserId={discordUserId} />

      <RosterSection />
    </PageContainer>
  )
}
