'use client'

import { cns } from '@lilnas/utils/cns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { GitIdentityItemDto } from 'src/console/git-identity.dto'

import { api, queryKeys } from '../lib/api'
import { EmptyState } from '../components/empty-state'
import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'

type StatusBadge = 'configured' | 'decrypt_failed'

function StatusChip({ status }: { status: StatusBadge }) {
  return (
    <span
      className={cns(
        'inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium',
        status === 'configured' && 'bg-green-900 text-green-300',
        status === 'decrypt_failed' && 'bg-red-900 text-red-300',
      )}
    >
      {status === 'configured' ? 'Configured' : 'Decrypt/parse-failed'}
    </span>
  )
}

function IdentityRow({
  item,
  onReplace,
  onClear,
  clearPending,
}: {
  item: GitIdentityItemDto
  onReplace: (userId: string) => void
  onClear: (userId: string) => void
  clearPending: boolean
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <tr className="border-b border-gray-800">
      <td className="py-3 pr-4 font-mono text-xs text-gray-200">
        {item.discordUserId}
      </td>
      <td className="py-3 pr-4 text-xs text-gray-300">{item.name}</td>
      <td className="py-3 pr-4 text-xs text-gray-400">{item.email}</td>
      <td className="py-3 pr-4">
        <StatusChip status={item.status} />
      </td>
      <td className="py-3 pr-4 font-mono text-xs text-gray-500 max-w-xs truncate">
        {item.fingerprint}
      </td>
      <td className="py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => onReplace(item.discordUserId)}
            className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
          >
            Replace
          </button>
          {!confirmOpen ? (
            <button
              onClick={() => setConfirmOpen(true)}
              disabled={clearPending}
              className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700 disabled:opacity-50"
            >
              Clear
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Remove identity?</span>
              <button
                onClick={() => {
                  setConfirmOpen(false)
                  onClear(item.discordUserId)
                }}
                className="rounded bg-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-800"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

export default function GitIdentityPage() {
  const queryClient = useQueryClient()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.gitIdentity,
    queryFn: api.listGitIdentities,
    refetchOnWindowFocus: false,
    retry: false,
  })

  // Form state
  const [discordUserId, setDiscordUserId] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [saved, setSaved] = useState(false)

  const upsertMutation = useMutation({
    mutationFn: api.upsertGitIdentity,
    onSuccess: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      // Clear only the private key — retain other fields for verification.
      setPrivateKey('')
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitIdentity })
    },
  })

  const clearMutation = useMutation({
    mutationFn: (userId: string) => api.deleteGitIdentity(userId),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: queryKeys.gitIdentity }),
  })

  function handleReplace(userId: string) {
    setDiscordUserId(userId)
    // Scroll to form
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false)
    upsertMutation.mutate({ discordUserId, name, email, privateKey })
  }

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState message={(error as Error).message} />

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <h1 className="text-lg font-semibold text-white">Git identity</h1>

      {/* Add / replace form */}
      <div className="space-y-4">
        <h2 className="text-sm font-medium text-gray-300">
          Add or replace identity
        </h2>
        <p className="text-xs text-gray-500">
          Admin-managed by Discord ID. Phase D will source the snowflake from the
          session automatically.
        </p>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-300">
              Discord user ID (snowflake)
            </label>
            <input
              type="text"
              value={discordUserId}
              onChange={e => setDiscordUserId(e.target.value)}
              placeholder="123456789012345678"
              className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-300">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-gray-300">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="jane@example.com"
              className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
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
              className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-xs text-gray-100 focus:border-gray-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={upsertMutation.isPending}
              className={cns(
                'rounded px-4 py-2 text-sm font-medium transition-colors',
                upsertMutation.isPending
                  ? 'bg-gray-700 text-gray-400 opacity-50 cursor-not-allowed'
                  : 'bg-blue-700 text-blue-100 hover:bg-blue-600',
              )}
            >
              {upsertMutation.isPending ? 'Saving…' : 'Save identity'}
            </button>

            {saved && (
              <span className="text-xs text-green-400">Saved</span>
            )}
            {upsertMutation.isError && !saved && (
              <span className="text-xs text-red-400">
                {(upsertMutation.error as Error).message}
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Identity list */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-gray-300">Configured identities</h2>

        {(!data || data.length === 0) ? (
          <EmptyState message="No git identities configured — use the form above to add one." />
        ) : (
          <>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">
                    Discord ID
                  </th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">Name</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">Email</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">Status</th>
                  <th className="pb-2 pr-4 text-xs font-medium text-gray-500">Fingerprint</th>
                  <th className="pb-2 text-xs font-medium text-gray-500" />
                </tr>
              </thead>
              <tbody>
                {data.map(item => (
                  <>
                    {item.status === 'decrypt_failed' && (
                      <tr key={`${item.discordUserId}-notice`}>
                        <td
                          colSpan={6}
                          className="pt-2 pb-0 text-xs text-red-400"
                        >
                          Key cannot be decrypted — pushes blocked. Re-upload a
                          key to restore access.
                        </td>
                      </tr>
                    )}
                    <IdentityRow
                      key={item.discordUserId}
                      item={item}
                      onReplace={handleReplace}
                      onClear={userId => clearMutation.mutate(userId)}
                      clearPending={clearMutation.isPending}
                    />
                  </>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}
