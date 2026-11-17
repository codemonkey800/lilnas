'use client'

import {
  Button,
  Card,
  Checkbox,
  Field,
  Icon,
  Input,
  Note,
  Textarea,
} from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { ErrorState } from 'src/app/components/error-state'
import { LoadingState } from 'src/app/components/loading-state'
import { api, fetchJson, queryKeys } from 'src/app/lib/api'
import { logEvent, logToServer } from 'src/app/lib/browser-logger'
import { useLiveStream } from 'src/app/lib/use-live-stream'
import type { BotStatusDto } from 'src/bot/bot-status.dto'
import type {
  ConfigResponseDto,
  UpdateConfigBodyDto,
} from 'src/console/config.dto'
import { LOG_EVENTS } from 'src/logging/log-events'

const CUSTOM_PROMPT_MAX = 20_000

// Names — never values — of the config fields whose submitted value differs
// from the last-persisted config, for the config-saved audit log. cwd and
// customSystemPrompt in particular are sensitive, so only field NAMES are
// ever surfaced; claudeArgs is an array, compared structurally.
function changedConfigFields(
  prev: ConfigResponseDto,
  next: UpdateConfigBodyDto,
): string[] {
  const changed: string[] = []
  if (prev.cwd !== next.cwd) changed.push('cwd')
  if (prev.claudeCommand !== next.claudeCommand) changed.push('claudeCommand')
  if (JSON.stringify(prev.claudeArgs) !== JSON.stringify(next.claudeArgs)) {
    changed.push('claudeArgs')
  }
  if (prev.idleTimeoutSec !== next.idleTimeoutSec) {
    changed.push('idleTimeoutSec')
  }
  if (prev.maxConcurrentSessions !== next.maxConcurrentSessions) {
    changed.push('maxConcurrentSessions')
  }
  if (prev.customSystemPrompt !== next.customSystemPrompt) {
    changed.push('customSystemPrompt')
  }
  if (prev.autoPostDiffs !== next.autoPostDiffs) {
    changed.push('autoPostDiffs')
  }
  return changed
}

/**
 * The label line: the setting's name, and on the right how far a change
 * reaches. It sits inside the `Field` label so the pair is one name for the
 * control.
 */
function fieldLabel(label: string, effect: string) {
  return (
    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span>{label}</span>
      <span className="shrink-0 text-cap font-normal text-ink-3">
        Takes effect: {effect}
      </span>
    </span>
  )
}

export default function ConfigPage() {
  const queryClient = useQueryClient()

  useLiveStream(['bot-status'])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.config,
    queryFn: api.getConfig,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const { data: botStatus } = useQuery({
    queryKey: queryKeys.botStatus,
    queryFn: () => fetchJson<BotStatusDto>('/bot/status'),
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
  const [customSystemPrompt, setCustomSystemPrompt] = useState('')
  const [autoPostDiffs, setAutoPostDiffs] = useState(false)
  const [argsError, setArgsError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Field names changed in the pending save, computed at submit time (when
  // both the previous config and the new body are in hand) and read back in
  // onSuccess for the config-saved audit.
  const changedFieldsRef = useRef<string[]>([])

  // Sync server-fetched data into editable form state when the query resolves.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (data) {
      setCwd(data.cwd)
      setClaudeCommand(data.claudeCommand)
      setClaudeArgsJson(JSON.stringify(data.claudeArgs))
      setIdleTimeoutSec(String(data.idleTimeoutSec))
      setMaxConcurrentSessions(String(data.maxConcurrentSessions))
      setCustomSystemPrompt(data.customSystemPrompt)
      setAutoPostDiffs(data.autoPostDiffs)
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
    mutationKey: ['config-save'],
    mutationFn: (body: UpdateConfigBodyDto) => api.updateConfig(body),
    onSuccess: response => {
      // Domain-specific save audit the generic mutation-success chokepoint
      // can't give: WHICH fields changed (names only) and whether the bot was
      // offline (a deferred-effect save that applies at next bot start).
      logEvent(LOG_EVENTS.configSaved, {
        botOffline,
        changedFields: changedFieldsRef.current,
      })
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
        setArgsError('Must be a JSON array of strings, like ["--flag"].')
        logToServer(
          'warn',
          LOG_EVENTS.clientValidationRejected,
          'config validation failed',
          { field: 'claudeArgs', reason: 'not-string-array' },
        )
        return
      }
      parsedArgs = parsed as string[]
      setArgsError(null)
    } catch {
      setArgsError(
        'That isn\'t JSON. Use an array of strings, like ["--flag"].',
      )
      logToServer(
        'warn',
        LOG_EVENTS.clientValidationRejected,
        'config validation failed',
        { field: 'claudeArgs', reason: 'invalid-json' },
      )
      return
    }

    const body: UpdateConfigBodyDto = {
      cwd,
      claudeCommand,
      claudeArgs: parsedArgs,
      idleTimeoutSec: Number(idleTimeoutSec),
      maxConcurrentSessions: Number(maxConcurrentSessions),
      customSystemPrompt,
      autoPostDiffs,
    }
    // Field-name diff for the config-saved audit (see changedConfigFields).
    // `data` is the last-persisted config the form was seeded from.
    changedFieldsRef.current = data ? changedConfigFields(data, body) : []
    mutation.mutate(body)
  }

  const customPromptNearCap =
    customSystemPrompt.length >= CUSTOM_PROMPT_MAX * 0.9

  if (isLoading) {
    return (
      <ConfigLayout>
        <LoadingState message="Fetching config…" />
      </ConfigLayout>
    )
  }
  if (isError) {
    return (
      <ConfigLayout>
        <ErrorState
          code={(error as Error).message}
          lead="Couldn't load the config."
          message="The server didn't answer. Try again in a minute."
        />
      </ConfigLayout>
    )
  }

  return (
    <ConfigLayout>
      {botOffline && (
        <Note lead="Bot is offline." tone="warn">
          Changes are saved now and apply at the next bot start.
        </Note>
      )}

      <Card>
        <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
          <Field
            label={fieldLabel('Working directory (cwd)', 'new sessions only')}
          >
            <Input mono value={cwd} onChange={e => setCwd(e.target.value)} />
          </Field>

          <Field label={fieldLabel('Claude command', 'new sessions only')}>
            <Input
              mono
              value={claudeCommand}
              onChange={e => setClaudeCommand(e.target.value)}
            />
          </Field>

          <Field
            error={argsError}
            label={fieldLabel('Claude args (JSON array)', 'new sessions only')}
          >
            <Textarea
              mono
              rows={2}
              value={claudeArgsJson}
              onChange={e => {
                setClaudeArgsJson(e.target.value)
                setArgsError(null)
              }}
            />
          </Field>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field
              label={fieldLabel(
                'Idle timeout (seconds)',
                'next idle-timer reset',
              )}
            >
              <Input
                min={1}
                type="number"
                value={idleTimeoutSec}
                onChange={e => setIdleTimeoutSec(e.target.value)}
              />
            </Field>

            <Field
              label={fieldLabel(
                'Max concurrent sessions',
                'next create (no eviction)',
              )}
            >
              <Input
                min={1}
                type="number"
                value={maxConcurrentSessions}
                onChange={e => setMaxConcurrentSessions(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex flex-col">
            <Field
              label={fieldLabel('Custom system prompt', 'new sessions only')}
            >
              <Textarea
                mono
                rows={7}
                value={customSystemPrompt}
                onChange={e => setCustomSystemPrompt(e.target.value)}
              />
            </Field>
            <p
              className={cns(
                'mt-1 text-right text-cap tabular-nums',
                customPromptNearCap ? 'text-warn' : 'text-ink-3',
              )}
            >
              {customSystemPrompt.length} / {CUSTOM_PROMPT_MAX}
            </p>
            {customPromptNearCap && (
              <Note className="mt-2" lead="Close to the limit." tone="warn">
                The prompt can be at most 20,000 characters.
              </Note>
            )}
          </div>

          <Field
            label={fieldLabel(
              'Auto-post tool diffs to Discord',
              'next tool call',
            )}
          >
            <div aria-label="Auto-post tool diffs to Discord" role="group">
              <Checkbox
                checked={autoPostDiffs}
                label="Post a diff message after each completed Edit/Read tool call"
                onCheckedChange={checked => setAutoPostDiffs(checked)}
              />
            </div>
          </Field>

          <div className="flex flex-col items-stretch gap-3 border-t border-line pt-4 md:flex-row md:items-center">
            <Button
              data-track-id="config-save"
              disabled={mutation.isPending}
              loading={mutation.isPending}
              type="submit"
              variant="accent"
            >
              {mutation.isPending ? 'Saving…' : 'Save'}
            </Button>

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

          {mutation.isError && !saved && (
            <Note lead="Couldn't save the config." tone="bad">
              The server didn&apos;t answer. Your changes are still in the form.
              <span className="mt-0.5 block font-mono text-mono-sm text-ink-3">
                {(mutation.error as Error).message}
              </span>
            </Note>
          )}
        </form>
      </Card>
    </ConfigLayout>
  )
}

function ConfigLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 md:gap-5 md:px-8">
      <h1 className="text-h2">Global config</h1>
      {children}
    </div>
  )
}
