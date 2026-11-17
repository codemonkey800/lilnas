import {
  Avatar,
  Button,
  Combobox,
  type ComboboxItem,
  Dialog,
  Field,
  Input,
  Note,
  Segmented,
  Textarea,
  useFieldId,
} from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { useEffect, useMemo, useState } from 'react'

import { ApiRequestError } from 'src/api/api.client'
import type {
  CreateReminderBody,
  MemberInfo,
  ReminderView,
  ScheduleBody,
} from 'src/api/api.types'
import { useChannels } from 'src/queries/useChannels'
import { useMembers } from 'src/queries/useMembers'
import {
  useCreateReminder,
  useReminderPreview,
  useUpdateReminder,
} from 'src/queries/useReminders'
import { ReminderActionType } from 'src/reminders/reminder.types'

import { CRON_PRESETS, CUSTOM_PRESET, presetFor } from './cron-presets'
import { FieldSelect } from './FieldSelect'
import { ACTION_LABELS } from './format'

const WHAT_MAX = 500
const DEFAULT_CRON = CRON_PRESETS[0].cron
/** The `Select` has no "empty" value, so the default channel is a sentinel. */
const DEFAULT_CHANNEL = 'default'

const KINDS = [
  { value: 'once', label: 'One-time' },
  { value: 'recurring', label: 'Recurring' },
] as const

type Kind = (typeof KINDS)[number]['value']

interface Draft {
  userId: string
  what: string
  kind: Kind
  at: string
  cron: string
  endsOn: string
  channelId: string
  targetUserIds: string[]
  actionType: ReminderActionType
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `datetime-local` value (local time) for an ISO instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toLocalDate(iso: string | null): string {
  return toLocalInput(iso).slice(0, 10)
}

function emptyDraft(): Draft {
  return {
    userId: '',
    what: '',
    kind: 'once',
    at: '',
    cron: DEFAULT_CRON,
    endsOn: '',
    channelId: DEFAULT_CHANNEL,
    targetUserIds: [],
    actionType: ReminderActionType.Default,
  }
}

function draftFrom(reminder: ReminderView): Draft {
  return {
    userId: reminder.userId,
    what: reminder.what,
    kind: reminder.isRecurring ? 'recurring' : 'once',
    at: toLocalInput(reminder.scheduledAt),
    cron: reminder.cronExpression ?? DEFAULT_CRON,
    endsOn: toLocalDate(reminder.endsAt),
    channelId: reminder.channelId ?? DEFAULT_CHANNEL,
    targetUserIds: reminder.targetUserIds,
    actionType: reminder.actionType,
  }
}

function toSchedule(draft: Draft): ScheduleBody | null {
  if (draft.kind === 'once') {
    const at = draft.at ? new Date(draft.at) : null
    return at && !Number.isNaN(at.getTime())
      ? { kind: 'once', at: at.toISOString() }
      : null
  }

  const cron = draft.cron.trim()
  if (!cron) return null

  return {
    kind: 'recurring',
    cron,
    endsAt: draft.endsOn
      ? new Date(`${draft.endsOn}T23:59:59`).toISOString()
      : null,
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])

  return debounced
}

function issueFor(error: Error | null, ...paths: string[]) {
  if (!(error instanceof ApiRequestError)) return undefined
  return error.issues.find(i => paths.includes(i.path))?.message
}

const memberLabel = (m: MemberInfo) => `${m.username} · ${m.displayName}`

function memberItem(m: MemberInfo): ComboboxItem<string> {
  return {
    value: m.id,
    label: memberLabel(m),
    icon: (
      <Avatar
        initials={m.displayName.slice(0, 2).toUpperCase()}
        size={24}
        src={m.avatarUrl ?? undefined}
        title={m.displayName}
      />
    ),
  }
}

const formatRun = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

const actionLabel = (type: ReminderActionType) =>
  ACTION_LABELS[type][0].toUpperCase() + ACTION_LABELS[type].slice(1)

const ACTION_OPTIONS = Object.values(ReminderActionType).map(type => ({
  value: type,
  label: actionLabel(type),
}))

interface ReminderDialogProps {
  open: boolean
  /** Reminder to edit; null creates a new one. */
  reminder: ReminderView | null
  onClose: () => void
}

export function ReminderDialog({
  open,
  reminder,
  onClose,
}: ReminderDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <Dialog.Popup className="max-w-[520px] gap-4">
        <ReminderForm
          key={reminder?.id ?? 'new'}
          reminder={reminder}
          onClose={onClose}
        />
      </Dialog.Popup>
    </Dialog.Root>
  )
}

/** A pill that picks a cron preset; the picked one is accent. */
function PresetPill({
  label,
  selected,
  disabled,
  onClick,
}: {
  label: string
  selected: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      aria-pressed={selected}
      className={cns(
        'inline-flex h-7 items-center rounded-full border px-3 text-cap font-medium',
        'transition-colors duration-200 ease-standard disabled:opacity-40',
        selected
          ? 'border-accent bg-accent-ghost text-ink'
          : 'border-line-control text-ink-2 hover:text-ink',
      )}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function ReminderForm({
  reminder,
  onClose,
}: {
  reminder: ReminderView | null
  onClose: () => void
}) {
  const editing = reminder !== null
  const create = useCreateReminder()
  const update = useUpdateReminder()
  const mutation = editing ? update : create
  const { data: members = [] } = useMembers()
  const { data: channels = [] } = useChannels()
  const remindId = useFieldId()

  const [draft, setDraft] = useState<Draft>(() =>
    reminder ? draftFrom(reminder) : emptyDraft(),
  )

  const edit = (patch: Partial<Draft>) => {
    mutation.reset()
    setDraft(d => ({ ...d, ...patch }))
  }

  const schedule = useMemo(() => toSchedule(draft), [draft])
  const debouncedSchedule = useDebounced(schedule, 300)
  const preview = useReminderPreview(debouncedSchedule)
  const previewError = preview.error?.message
  const settling = schedule !== null && schedule !== debouncedSchedule

  // Ids the member list doesn't know (left the server, still on a reminder)
  // stay pickable and readable instead of showing a bare id.
  const people = useMemo(() => {
    const known = new Set(members.map(m => m.id))
    const missing = [draft.userId, ...draft.targetUserIds]
      .filter(id => id && !known.has(id))
      .map(id => ({
        id,
        username: id === reminder?.userId ? reminder.userName : id,
        displayName: id === reminder?.userId ? reminder.userName : id,
        avatarUrl: null,
      }))

    return [...members, ...missing]
  }, [members, draft.userId, draft.targetUserIds, reminder])
  const items = useMemo(() => people.map(memberItem), [people])
  const targets = draft.targetUserIds.map(
    id =>
      people.find(m => m.id === id) ?? {
        id,
        username: id,
        displayName: id,
        avatarUrl: null,
      },
  )
  const presetLabel = presetFor(draft.cron)

  const whatError = issueFor(mutation.error, 'what')
  const atError = issueFor(mutation.error, 'schedule.at')
  const cronError =
    previewError ?? issueFor(mutation.error, 'schedule.cron', 'schedule')
  const missing = !draft.what.trim() || !schedule || (!editing && !draft.userId)
  const saving = mutation.isPending
  const submitDisabled =
    missing || saving || settling || !!previewError || preview.isFetching

  const issuePaths = new Set([
    'what',
    'schedule',
    'schedule.at',
    'schedule.cron',
    'schedule.endsAt',
    'channelId',
    'targetUserIds',
    'actionType',
    'userId',
  ])
  const globalError =
    mutation.error &&
    !(
      mutation.error instanceof ApiRequestError &&
      mutation.error.issues.some(i => issuePaths.has(i.path))
    )
      ? mutation.error.message
      : null

  const submit = () => {
    if (!schedule) return
    const fields = {
      what: draft.what.trim(),
      schedule,
      channelId: draft.channelId === DEFAULT_CHANNEL ? null : draft.channelId,
      targetUserIds: draft.targetUserIds,
      actionType: draft.actionType,
    }
    const options = { onSuccess: onClose }

    if (reminder) {
      update.mutate({ id: reminder.id, body: fields }, options)
    } else {
      const body: CreateReminderBody = { userId: draft.userId, ...fields }
      create.mutate(body, options)
    }
  }

  const userError = issueFor(mutation.error, 'userId')
  const targetsError = issueFor(mutation.error, 'targetUserIds')
  const endsError = issueFor(mutation.error, 'schedule.endsAt')
  const remindMessage = targetsError ? `${remindId}-error` : `${remindId}-hint`

  return (
    <>
      <Dialog.Title className="text-h2">
        {editing ? 'Edit reminder' : 'New reminder'}
      </Dialog.Title>

      <Field error={userError} hint="Username and display name" label="For">
        <Combobox
          disabled={editing || saving}
          items={items}
          label="For"
          placeholder="Pick a member"
          value={draft.userId || null}
          onValueChange={id => edit({ userId: id ?? '' })}
        />
      </Field>

      <div>
        <Field error={whatError} label="What">
          <Textarea
            disabled={saving}
            rows={3}
            value={draft.what}
            onChange={e => edit({ what: e.target.value.slice(0, WHAT_MAX) })}
          />
        </Field>
        <p className="mt-[5px] text-right font-mono text-xs text-ink-3 tabular-nums">
          {draft.what.length} / {WHAT_MAX}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink-2">Type</span>
        <Segmented
          className="self-start"
          label="Type"
          options={KINDS}
          value={draft.kind}
          onValueChange={kind => edit({ kind })}
        />
      </div>

      {draft.kind === 'once' ? (
        <Field error={atError ?? previewError} label="When">
          <Input
            disabled={saving}
            mono
            type="datetime-local"
            value={draft.at}
            onChange={e => edit({ at: e.target.value })}
          />
        </Field>
      ) : (
        <div className="flex flex-col gap-3">
          <div
            aria-label="Preset"
            className="flex flex-wrap gap-2"
            role="group"
          >
            {[...CRON_PRESETS, { label: CUSTOM_PRESET, cron: '' }].map(p => (
              <PresetPill
                key={p.label}
                disabled={saving}
                label={p.label === CUSTOM_PRESET ? 'Custom' : p.label}
                selected={presetLabel === p.label}
                onClick={() => p.cron && edit({ cron: p.cron })}
              />
            ))}
          </div>
          <Field error={cronError} label="Cron expression">
            <Input
              disabled={saving}
              mono
              value={draft.cron}
              onChange={e => edit({ cron: e.target.value })}
            />
          </Field>
          <Field error={endsError} label="Ends on (optional)">
            <Input
              disabled={saving}
              mono={!!draft.endsOn}
              placeholder="No end date"
              type="date"
              value={draft.endsOn}
              onChange={e => edit({ endsOn: e.target.value })}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Next 3 runs</span>
            <ul
              aria-label="Next 3 runs"
              className="flex min-h-[38px] flex-col rounded-md border border-line bg-bg-sunk px-3 py-2 font-mono text-mono-sm text-ink-2"
            >
              {preview.data && !settling
                ? preview.data.runs
                    .slice(0, 3)
                    .map(run => <li key={run}>{formatRun(run)}</li>)
                : null}
            </ul>
          </div>
        </div>
      )}

      <FieldSelect
        disabled={saving}
        error={issueFor(mutation.error, 'channelId')}
        hint="Default channel"
        label="Deliver to"
        options={[
          { value: DEFAULT_CHANNEL, label: 'Default channel' },
          ...channels.map(c => ({ value: c.id, label: `#${c.name}` })),
        ]}
        value={draft.channelId}
        onValueChange={channelId => edit({ channelId })}
      />

      <Field
        error={targetsError}
        hint="Tags everyone selected; defaults to the creator"
        htmlFor={remindId}
        label="Remind"
      >
        <>
          <Combobox
            aria-describedby={remindMessage}
            aria-invalid={targetsError ? true : undefined}
            disabled={saving}
            id={remindId}
            items={items.filter(i => !draft.targetUserIds.includes(i.value))}
            label="Remind"
            placeholder="Add a member"
            value={null}
            onValueChange={id => {
              if (id) edit({ targetUserIds: [...draft.targetUserIds, id] })
            }}
          />
          {targets.length > 0 && (
            <ul aria-label="Reminding" className="flex flex-wrap gap-2">
              {targets.map(m => (
                <li
                  key={m.id}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-2 pr-1 pl-3 text-cap text-ink"
                >
                  {memberLabel(m)}
                  <button
                    aria-label={`Remove ${m.username}`}
                    className="flex size-5 items-center justify-center rounded-full text-ink-3 hover:bg-line hover:text-ink disabled:opacity-40"
                    disabled={saving}
                    type="button"
                    onClick={() =>
                      edit({
                        targetUserIds: draft.targetUserIds.filter(
                          id => id !== m.id,
                        ),
                      })
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      </Field>

      <FieldSelect
        disabled={saving}
        error={issueFor(mutation.error, 'actionType')}
        label="Action"
        options={ACTION_OPTIONS}
        value={draft.actionType}
        onValueChange={actionType =>
          edit({ actionType: actionType as ReminderActionType })
        }
      />

      {globalError && <Note lead={globalError} tone="bad" />}

      <Dialog.Actions>
        <Dialog.Close render={<Button variant="ghost" />}>Cancel</Dialog.Close>
        <Button
          disabled={submitDisabled}
          loading={saving}
          variant="accent"
          onClick={submit}
        >
          {editing ? 'Save reminder' : 'Create reminder'}
        </Button>
      </Dialog.Actions>
    </>
  )
}
