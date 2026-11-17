'use client'

import {
  Button,
  Card,
  ConfirmDialog,
  Field,
  Icon,
  Note,
  Radio,
  RadioGroup,
  Skeleton,
  Slider,
  StatusDot,
  Textarea,
  useToast,
} from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { ReactNode, useMemo, useState } from 'react'

import { ApiRequestError } from 'src/api/api.client'
import type { SettingsResponse } from 'src/api/api.types'
import { ModelSelect } from 'src/components/ModelSelect'
import type { Settings } from 'src/llm/settings/settings.schema'
import { useModels } from 'src/queries/useModels'
import {
  useResetSettings,
  useSettings,
  useUpdateSettings,
} from 'src/queries/useSettings'

const PROMPT_MAX = 20_000
const EFFORTS = ['low', 'medium', 'high'] as const

type Draft = Settings

function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <Card>
      <div className="mb-3 flex flex-col gap-0.5">
        <h2 className="text-h3">{title}</h2>
        {subtitle && <p className="text-cap text-ink-3">{subtitle}</p>}
      </div>
      {children}
    </Card>
  )
}

function issueFor(error: Error | null, path: string): string | undefined {
  if (!(error instanceof ApiRequestError)) return undefined
  return error.issues.find(i => i.path === path)?.message
}

type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error'

/** The line beside Save: unsaved / saving / saved / error, each in its own tone. */
function SettingsStatus({
  status,
  savedAt,
  className,
}: {
  status: SaveStatus
  savedAt: string
  className?: string
}) {
  const savedText = `Saved ${formatSavedAt(savedAt)}`
  const states: Record<
    SaveStatus,
    { tone: string; text: string; dot?: 'warn'; icon?: 'check' | 'alert' }
  > = {
    clean: { tone: 'text-ink-3', text: savedText },
    dirty: { tone: 'text-warn', text: 'Unsaved changes', dot: 'warn' },
    saving: { tone: 'text-ink-3', text: 'Saving…' },
    saved: { tone: 'text-ok', text: savedText, icon: 'check' },
    error: {
      tone: 'text-bad',
      text: 'Can’t save — fix the highlighted field',
      icon: 'alert',
    },
  }
  const { tone, text, dot, icon } = states[status]

  return (
    <span
      className={cns(
        'inline-flex items-center gap-1.5 text-cap',
        tone,
        className,
      )}
      role="status"
    >
      {dot && <StatusDot tone={dot} />}
      {icon && <Icon name={icon} size={14} />}
      {text}
    </span>
  )
}

function SettingsForm({
  settings,
  justSaved,
  onJustSavedChange,
}: {
  settings: SettingsResponse
  justSaved: boolean
  onJustSavedChange: (saved: boolean) => void
}) {
  const update = useUpdateSettings()
  const reset = useResetSettings()
  const toast = useToast()
  const { data: chatModels = [] } = useModels('chat')

  const [draft, setDraft] = useState<Draft>({
    models: settings.models,
    temperature: settings.temperature,
    reasoningEffort: settings.reasoningEffort,
    systemPrompt: settings.systemPrompt,
  })
  const [confirmOpen, setConfirmOpen] = useState(false)

  const dirty = useMemo(
    () =>
      draft.models.chat !== settings.models.chat ||
      draft.models.reasoning !== settings.models.reasoning ||
      draft.models.image !== settings.models.image ||
      draft.temperature !== settings.temperature ||
      draft.reasoningEffort !== settings.reasoningEffort ||
      draft.systemPrompt !== settings.systemPrompt,
    [draft, settings],
  )

  const chatSpec = chatModels.find(m => m.id === draft.models.chat)
  const hasTemperature = chatSpec?.capabilities.temperature ?? true
  const saving = update.isPending || reset.isPending
  const saveDisabled = !dirty || saving

  const edit = (next: Draft) => {
    onJustSavedChange(false)
    update.reset()
    setDraft(next)
  }

  // A successful write invalidates the settings query, and the page re-keys
  // this form on the new `updatedAt`. Mutate-level callbacks die with the
  // unmounted form, so the follow-up runs off the promise and the "just
  // saved" flag lives in the page.
  const save = () => {
    update
      .mutateAsync(draft)
      .then(() => {
        onJustSavedChange(true)
        toast.show({ title: 'Settings saved', tone: 'ok' })
      })
      .catch(() => undefined)
  }

  const confirmReset = () => {
    reset
      .mutateAsync()
      .then(() => {
        onJustSavedChange(true)
        toast.show({ title: 'Settings reset to the defaults', tone: 'ok' })
      })
      .catch(() => undefined)
      .finally(() => setConfirmOpen(false))
  }

  const failure = update.error ?? reset.error
  const globalError =
    failure && !(failure instanceof ApiRequestError && failure.issues.length)
      ? failure.message
      : null

  const temperatureIssue = issueFor(update.error, 'temperature')
  const effortIssue = issueFor(update.error, 'reasoningEffort')
  const promptIssue = issueFor(update.error, 'systemPrompt')

  const status: SaveStatus = saving
    ? 'saving'
    : update.isError
      ? 'error'
      : dirty
        ? 'dirty'
        : justSaved
          ? 'saved'
          : 'clean'

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Models"
        subtitle="One model per role. Prices are USD per 1M tokens."
      >
        <div className="flex flex-col gap-4">
          {(
            [
              ['chat', 'Chat'],
              ['reasoning', 'Reasoning'],
              ['image', 'Image'],
            ] as const
          ).map(([role, label]) => (
            <ModelSelect
              key={role}
              disabled={saving}
              error={issueFor(update.error, `models.${role}`)}
              label={label}
              role={role}
              value={draft.models[role]}
              onChange={id =>
                edit({ ...draft, models: { ...draft.models, [role]: id } })
              }
            />
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Generation"
        subtitle={
          hasTemperature
            ? 'Temperature applies to this chat model.'
            : `${chatSpec?.label ?? draft.models.chat} is a reasoning model and has no temperature.`
        }
      >
        {hasTemperature ? (
          <div className="flex flex-col gap-1.5">
            <Slider
              disabled={saving}
              format={v => v.toFixed(1)}
              label="Temperature"
              max={2}
              min={0}
              step={0.1}
              value={draft.temperature}
              onValueChange={temperature => edit({ ...draft, temperature })}
            />
            <div className="flex justify-between text-cap text-ink-3">
              <span>0 · precise</span>
              <span>2 · creative</span>
            </div>
            {temperatureIssue && (
              <p className="text-cap text-bad">{temperatureIssue}</p>
            )}
          </div>
        ) : (
          <fieldset className="flex flex-col gap-2" disabled={saving}>
            <legend className="mb-2 text-sm font-medium text-ink-2">
              Reasoning effort
            </legend>
            <RadioGroup
              aria-label="Reasoning effort"
              className="max-sm:gap-3 sm:flex-row sm:gap-6"
              disabled={saving}
              value={draft.reasoningEffort}
              onValueChange={reasoningEffort =>
                edit({ ...draft, reasoningEffort })
              }
            >
              {EFFORTS.map(level => (
                <Radio key={level} label={level} value={level} />
              ))}
            </RadioGroup>
            {effortIssue && <p className="text-cap text-bad">{effortIssue}</p>}
          </fieldset>
        )}
      </SectionCard>

      <SectionCard
        title="System prompt"
        subtitle="Prepended to every conversation."
      >
        <div className="flex flex-col gap-1.5">
          <Field
            error={promptIssue}
            label={<span className="sr-only">System prompt</span>}
          >
            <Textarea
              className="resize-y"
              disabled={saving}
              mono
              rows={7}
              value={draft.systemPrompt}
              onChange={e => edit({ ...draft, systemPrompt: e.target.value })}
            />
          </Field>
          <span
            className={cns(
              'self-end font-mono text-xs tabular-nums',
              promptIssue ? 'text-bad' : 'text-ink-3',
            )}
          >
            {draft.systemPrompt.length} / {PROMPT_MAX}
          </span>
        </div>
      </SectionCard>

      {globalError && (
        <Note
          icon={<Icon name="alert" />}
          lead="Couldn’t update settings."
          tone="bad"
        >
          {globalError}
        </Note>
      )}

      <div className="flex gap-3 max-sm:flex-col sm:items-center">
        <div className="flex gap-3">
          <Button
            className="max-sm:flex-1"
            disabled={saveDisabled}
            loading={update.isPending}
            variant="accent"
            onClick={save}
          >
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button
            className="max-sm:flex-1"
            disabled={saving}
            variant="outline"
            onClick={() => setConfirmOpen(true)}
          >
            Reset
          </Button>
        </div>
        <SettingsStatus
          className="sm:ml-auto"
          savedAt={settings.updatedAt}
          status={status}
        />
      </div>

      <ConfirmDialog
        body="The default models, temperature and system prompt replace yours. Your current ones are lost."
        cancelLabel="Keep my settings"
        confirmLabel="Reset settings"
        open={confirmOpen}
        pending={reset.isPending}
        title="Reset settings to the defaults?"
        onConfirm={confirmReset}
        onOpenChange={setConfirmOpen}
      />
    </div>
  )
}

function SettingsSkeleton() {
  return (
    <div
      aria-label="Loading settings"
      className="flex flex-col gap-4"
      role="status"
    >
      {['Models', 'Generation', 'System prompt'].map(title => (
        <SectionCard key={title} title={title}>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-full rounded-xs" />
            <Skeleton className="h-3 w-11/12 rounded-xs" />
            <Skeleton className="h-3 w-2/3 rounded-xs" />
          </div>
        </SectionCard>
      ))}
    </div>
  )
}

export default function SettingsPage() {
  const { data, isLoading, error } = useSettings()
  const [justSaved, setJustSaved] = useState(false)

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-4 py-5 md:px-8 md:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">Settings</h1>
        <p className="text-sm text-ink-3">Runtime LLM configuration.</p>
      </header>

      {isLoading && <SettingsSkeleton />}
      {error && (
        <Note
          icon={<Icon name="alert" />}
          lead="Couldn’t load settings."
          tone="bad"
        >
          The API didn’t answer. Reload the page to try again.
        </Note>
      )}
      {data && (
        <SettingsForm
          key={data.updatedAt}
          justSaved={justSaved}
          settings={data}
          onJustSavedChange={setJustSaved}
        />
      )}
    </div>
  )
}
