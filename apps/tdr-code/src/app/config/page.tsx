'use client'

import { cns } from '@lilnas/utils/cns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { api, fetchJson, queryKeys } from 'src/app/lib/api'
import type { BotStatusDto } from 'src/bot/bot-status.dto'
import type { UpdateConfigBodyDto } from 'src/console/config.dto'

function FieldLabel({
  label,
  effectLabel,
}: {
  label: string
  effectLabel: string
}) {
  return (
    <div className="flex items-baseline justify-between">
      <label className="block text-xs font-medium text-gray-300">{label}</label>
      <span className="text-xs text-gray-500">takes effect: {effectLabel}</span>
    </div>
  )
}

export default function ConfigPage() {
  const queryClient = useQueryClient()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.config,
    queryFn: api.getConfig,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const { data: botStatus } = useQuery({
    queryKey: queryKeys.botStatus,
    queryFn: () => fetchJson<BotStatusDto>('/bot/status'),
    refetchInterval: 5_000,
    retry: false,
  })

  const botOffline =
    botStatus?.status === 'offline' ||
    botStatus?.status === 'offline-failed' ||
    botStatus?.status === 'never-seen'

  const [cwd, setCwd] = useState('')
  const [claudeCommand, setClaudeCommand] = useState('')
  const [claudeArgsJson, setClaudeArgsJson] = useState('')
  const [idleTimeoutSec, setIdleTimeoutSec] = useState('')
  const [maxConcurrentSessions, setMaxConcurrentSessions] = useState('')
  const [argsError, setArgsError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync server-fetched data into editable form state when the query resolves.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (data) {
      setCwd(data.cwd)
      setClaudeCommand(data.claudeCommand)
      setClaudeArgsJson(JSON.stringify(data.claudeArgs))
      setIdleTimeoutSec(String(data.idleTimeoutSec))
      setMaxConcurrentSessions(String(data.maxConcurrentSessions))
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [data])

  // Clear timer on unmount so a stale callback doesn't setState on a dead component.
  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    [],
  )

  const mutation = useMutation({
    mutationFn: (body: UpdateConfigBodyDto) => api.updateConfig(body),
    onSuccess: response => {
      setSaved(true)
      // Cancel any prior "saved" dismiss timer before arming a new one to
      // prevent banner flicker on rapid re-saves.
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSaved(false), 2500)
      // Write the server's echoed config directly into the cache — no refetch
      // needed and avoids the post-save invalidateQueries → useEffect re-seed
      // clobbering in-flight operator edits.
      queryClient.setQueryData(queryKeys.config, response)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaved(false)

    let parsedArgs: string[]
    try {
      const parsed = JSON.parse(claudeArgsJson)
      if (!Array.isArray(parsed) || parsed.some(a => typeof a !== 'string')) {
        setArgsError('Must be a JSON array of strings, e.g. ["--flag"]')
        return
      }
      parsedArgs = parsed as string[]
      setArgsError(null)
    } catch {
      setArgsError('Invalid JSON array')
      return
    }

    mutation.mutate({
      cwd,
      claudeCommand,
      claudeArgs: parsedArgs,
      idleTimeoutSec: Number(idleTimeoutSec),
      maxConcurrentSessions: Number(maxConcurrentSessions),
    })
  }

  if (isLoading) return <LoadingState />
  if (isError) return <ErrorState message={(error as Error).message} />

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-lg font-semibold text-white">Global config</h1>

      {botOffline && (
        <div className="rounded border border-yellow-800 bg-yellow-950 px-4 py-3 text-xs text-yellow-300">
          Bot offline — config saved and will apply at next bot start
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1">
          <FieldLabel
            label="Working directory (cwd)"
            effectLabel="new sessions only"
          />
          <input
            type="text"
            value={cwd}
            onChange={e => setCwd(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <FieldLabel label="Claude command" effectLabel="new sessions only" />
          <input
            type="text"
            value={claudeCommand}
            onChange={e => setClaudeCommand(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <FieldLabel
            label="Claude args (JSON array)"
            effectLabel="new sessions only"
          />
          <textarea
            value={claudeArgsJson}
            onChange={e => {
              setClaudeArgsJson(e.target.value)
              setArgsError(null)
            }}
            rows={2}
            className={cns(
              'w-full rounded border bg-gray-900 px-3 py-2 font-mono text-sm text-gray-100 focus:outline-none',
              argsError
                ? 'border-red-700 focus:border-red-500'
                : 'border-gray-700 focus:border-gray-500',
            )}
          />
          {argsError && <p className="text-xs text-red-400">{argsError}</p>}
        </div>

        <div className="space-y-1">
          <FieldLabel
            label="Idle timeout (seconds)"
            effectLabel="next idle-timer reset"
          />
          <input
            type="number"
            min={1}
            value={idleTimeoutSec}
            onChange={e => setIdleTimeoutSec(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
          />
        </div>

        <div className="space-y-1">
          <FieldLabel
            label="Max concurrent sessions"
            effectLabel="next create (no eviction)"
          />
          <input
            type="number"
            min={1}
            value={maxConcurrentSessions}
            onChange={e => setMaxConcurrentSessions(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-gray-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mutation.isPending}
            className={cns(
              'rounded px-4 py-2 text-sm font-medium transition-colors',
              mutation.isPending
                ? 'bg-gray-700 text-gray-400 opacity-50 cursor-not-allowed'
                : 'bg-blue-700 text-blue-100 hover:bg-blue-600',
            )}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>

          {saved && <span className="text-xs text-green-400">Saved</span>}

          {mutation.isError && !saved && (
            <span className="text-xs text-red-400">
              {(mutation.error as Error).message}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
