import { Button, Dialog, Field, Input, Note } from '@lilnas/ui'
import { useState } from 'react'

import type { ReminderView } from 'src/api/api.types'
import { useReminderRuns, useTestReminder } from 'src/queries/useReminders'

import { atTimeOfDay, formatWhen, testDateBounds, toDateInput } from './format'

interface TestSendDialogProps {
  reminder: ReminderView | null
  onClose: () => void
}

/** DMs the reminder's creator the message it would send at a chosen run. */
export function TestSendDialog({ reminder, onClose }: TestSendDialogProps) {
  const runs = useReminderRuns(reminder?.id ?? null)
  const test = useTestReminder()
  const [picked, setPicked] = useState<string | null>(null)

  // Test sends keep the reminder's time of day; only the date is chosen.
  const first = runs.data?.runs[0]
  const timeOfDay = first ? new Date(first) : null
  const bounds = timeOfDay
    ? testDateBounds(timeOfDay, reminder?.endsAt ?? null, new Date())
    : null
  const exhausted = !!bounds && !!bounds.max && bounds.min > bounds.max

  const date =
    picked ??
    (timeOfDay && bounds
      ? [toDateInput(timeOfDay), bounds.min].reduce((a, b) => (a > b ? a : b))
      : '')
  const valid =
    !!bounds &&
    !!date &&
    date >= bounds.min &&
    (!bounds.max || date <= bounds.max)
  const at =
    valid && timeOfDay ? atTimeOfDay(date, timeOfDay).toISOString() : ''

  const close = () => {
    test.reset()
    setPicked(null)
    onClose()
  }

  const send = () => {
    if (!reminder || !at) return
    test.mutate({ id: reminder.id, at })
  }

  const error =
    runs.error?.message ??
    (exhausted
      ? 'This reminder has no future dates left to test.'
      : !!date && !valid
        ? 'Pick a future date.'
        : undefined)

  return (
    <Dialog.Root
      open={!!reminder}
      onOpenChange={next => {
        if (!next) close()
      }}
    >
      <Dialog.Popup>
        <Dialog.Title>Send a test</Dialog.Title>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-body font-medium text-ink">{reminder?.what}</p>
            <Dialog.Description className="text-cap text-ink-3">
              DMs @{reminder?.userName} the message this reminder would send at
              the chosen time. Its schedule isn’t touched.
            </Dialog.Description>
          </div>
          <Field
            error={error}
            hint={
              bounds?.max
                ? `Future dates up to when it ends (${bounds.max}).`
                : undefined
            }
            label="Send as if it were"
          >
            <Input
              disabled={!runs.data || exhausted || test.isPending}
              max={bounds?.max ?? undefined}
              min={bounds?.min}
              mono
              type="date"
              value={date}
              onChange={e => {
                setPicked(e.target.value)
                test.reset()
              }}
            />
          </Field>
          {test.isSuccess && (
            <Note
              lead={`Sent to @${reminder?.userName}’s DMs as of ${formatWhen(at)}.`}
              tone="ok"
            />
          )}
          {test.error && <Note lead={test.error.message} tone="bad" />}
        </div>
        <Dialog.Actions>
          <Dialog.Close render={<Button variant="ghost" />}>Close</Dialog.Close>
          <Button
            disabled={!at}
            loading={test.isPending}
            variant="accent"
            onClick={send}
          >
            {test.isSuccess ? 'Send again' : 'Send test'}
          </Button>
        </Dialog.Actions>
      </Dialog.Popup>
    </Dialog.Root>
  )
}
