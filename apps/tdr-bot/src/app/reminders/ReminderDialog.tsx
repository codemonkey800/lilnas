import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
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
import { ACTION_LABELS } from './format'

const WHAT_MAX = 500
const DEFAULT_CRON = CRON_PRESETS[0].cron
const NONE = ''

type Kind = 'once' | 'recurring'

interface Draft {
  userId: string
  what: string
  kind: Kind
  at: string
  cron: string
  endsOn: string
  channelId: string
  targetUserId: string
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
    channelId: NONE,
    targetUserId: NONE,
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
    channelId: reminder.channelId ?? NONE,
    targetUserId: reminder.targetUserId ?? NONE,
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

const formatRun = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      {open && (
        <ReminderForm
          key={reminder?.id ?? 'new'}
          reminder={reminder}
          onClose={onClose}
        />
      )}
    </Dialog>
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

  const owner = members.find(m => m.id === draft.userId) ?? null
  const target = members.find(m => m.id === draft.targetUserId) ?? null
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
    'targetUserId',
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
      channelId: draft.channelId || null,
      targetUserId: draft.targetUserId || null,
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

  return (
    <>
      <DialogTitle>{editing ? 'Edit reminder' : 'New reminder'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Autocomplete
            options={members}
            value={owner}
            disabled={editing || saving}
            getOptionLabel={memberLabel}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_, m) => edit({ userId: m?.id ?? '' })}
            renderInput={params => (
              <TextField
                {...params}
                label="For"
                helperText={
                  issueFor(mutation.error, 'userId') ??
                  (editing && !owner
                    ? reminder.userName
                    : 'Username and display name')
                }
                error={!!issueFor(mutation.error, 'userId')}
              />
            )}
          />

          <TextField
            multiline
            minRows={3}
            label="What"
            value={draft.what}
            disabled={saving}
            error={!!whatError}
            helperText={
              <Box component="span" sx={{ display: 'flex' }}>
                <span>{whatError}</span>
                <Box component="span" sx={{ ml: 'auto' }}>
                  {draft.what.length} / {WHAT_MAX}
                </Box>
              </Box>
            }
            onChange={e => edit({ what: e.target.value.slice(0, WHAT_MAX) })}
          />

          <FormControl disabled={saving}>
            <FormLabel id="reminder-kind-label">Type</FormLabel>
            <RadioGroup
              row
              aria-labelledby="reminder-kind-label"
              value={draft.kind}
              onChange={e => edit({ kind: e.target.value as Kind })}
            >
              <FormControlLabel
                value="once"
                control={<Radio />}
                label="One-time"
              />
              <FormControlLabel
                value="recurring"
                control={<Radio />}
                label="Recurring"
              />
            </RadioGroup>
          </FormControl>

          {draft.kind === 'once' ? (
            <TextField
              type="datetime-local"
              label="When"
              value={draft.at}
              disabled={saving}
              error={!!(atError ?? previewError)}
              helperText={atError ?? previewError}
              onChange={e => edit({ at: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          ) : (
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {[...CRON_PRESETS, { label: CUSTOM_PRESET, cron: '' }].map(
                  p => (
                    <Chip
                      key={p.label}
                      size="small"
                      label={p.label === CUSTOM_PRESET ? 'Custom' : p.label}
                      color={presetLabel === p.label ? 'primary' : 'default'}
                      variant={presetLabel === p.label ? 'filled' : 'outlined'}
                      disabled={saving}
                      onClick={() =>
                        p.cron
                          ? edit({ cron: p.cron })
                          : edit({ cron: draft.cron })
                      }
                    />
                  ),
                )}
              </Box>
              <TextField
                label="Cron expression"
                value={draft.cron}
                disabled={saving}
                error={!!cronError}
                helperText={cronError}
                onChange={e => edit({ cron: e.target.value })}
                slotProps={{ input: { sx: { fontFamily: 'monospace' } } }}
              />
              <TextField
                type="date"
                label="Ends on (optional)"
                value={draft.endsOn}
                disabled={saving}
                error={!!issueFor(mutation.error, 'schedule.endsAt')}
                helperText={issueFor(mutation.error, 'schedule.endsAt')}
                onChange={e => edit({ endsOn: e.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          )}

          {draft.kind === 'recurring' && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Next 3 runs
              </Typography>
              <Box
                component="ul"
                sx={{
                  m: 0,
                  mt: 0.5,
                  p: 1.5,
                  listStyle: 'none',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: 'text.secondary',
                  minHeight: 32,
                }}
              >
                {preview.data && !settling
                  ? preview.data.runs
                      .slice(0, 3)
                      .map(run => <li key={run}>{formatRun(run)}</li>)
                  : null}
              </Box>
            </Box>
          )}

          <TextField
            select
            label="Deliver to"
            value={draft.channelId}
            disabled={saving}
            error={!!issueFor(mutation.error, 'channelId')}
            helperText={
              issueFor(mutation.error, 'channelId') ?? 'Default channel'
            }
            onChange={e => edit({ channelId: e.target.value })}
          >
            <MenuItem value={NONE}>Default channel</MenuItem>
            {channels.map(c => (
              <MenuItem key={c.id} value={c.id}>
                #{c.name}
              </MenuItem>
            ))}
          </TextField>

          <Autocomplete
            options={members}
            value={target}
            disabled={saving}
            getOptionLabel={memberLabel}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            onChange={(_, m) => edit({ targetUserId: m?.id ?? NONE })}
            renderInput={params => (
              <TextField
                {...params}
                label="Remind"
                error={!!issueFor(mutation.error, 'targetUserId')}
                helperText={
                  issueFor(mutation.error, 'targetUserId') ??
                  'Defaults to the creator'
                }
              />
            )}
          />

          <TextField
            select
            label="Action"
            value={draft.actionType}
            disabled={saving}
            error={!!issueFor(mutation.error, 'actionType')}
            helperText={issueFor(mutation.error, 'actionType')}
            onChange={e =>
              edit({ actionType: e.target.value as ReminderActionType })
            }
          >
            {Object.values(ReminderActionType).map(type => (
              <MenuItem key={type} value={type}>
                {ACTION_LABELS[type][0].toUpperCase() +
                  ACTION_LABELS[type].slice(1)}
              </MenuItem>
            ))}
          </TextField>

          {globalError && <Alert severity="error">{globalError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={submitDisabled}
          onClick={submit}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}
        >
          {editing ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </>
  )
}
