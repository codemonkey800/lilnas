'use client'

import {
  Button,
  EmptyState,
  Icon,
  Input,
  Note,
  Skeleton,
  Tabs,
} from '@lilnas/ui'
import { useMemo, useState } from 'react'

import type { ReminderView } from 'src/api/api.types'
import type { ReminderStatus } from 'src/db/schema'
import { useReminders } from 'src/queries/useReminders'

import { CancelDialog } from './CancelDialog'
import { ReminderDialog } from './ReminderDialog'
import { ReminderList } from './ReminderList'
import { TestSendDialog } from './TestSendDialog'

type StatusFilter = ReminderStatus | 'all'

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'missed', label: 'Missed' },
  { value: 'all', label: 'All' },
]

function matches(reminder: ReminderView, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (!needle) return true

  return [reminder.what, reminder.userName, ...reminder.targetUserNames].some(
    field => field.toLowerCase().includes(needle),
  )
}

function ListSkeleton() {
  return (
    <div
      aria-label="Loading reminders"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3"
      role="status"
    >
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 flex-1 rounded-xs" />
          <Skeleton className="h-6 w-16 rounded-full md:w-20" />
          <Skeleton className="hidden h-4 w-40 rounded-xs md:block" />
          <Skeleton className="hidden h-4 w-28 rounded-xs md:block" />
        </div>
      ))}
    </div>
  )
}

export default function RemindersPage() {
  const [status, setStatus] = useState<StatusFilter>('active')
  const [text, setText] = useState('')
  const [dialog, setDialog] = useState<{
    open: boolean
    reminder: ReminderView | null
  }>({ open: false, reminder: null })
  const [cancelling, setCancelling] = useState<ReminderView | null>(null)
  const [testing, setTesting] = useState<ReminderView | null>(null)

  const all = useReminders({ status: 'all' })
  const list = useReminders({ status })

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = {
      active: 0,
      completed: 0,
      cancelled: 0,
      missed: 0,
      all: 0,
    }
    for (const r of all.data ?? []) {
      result[r.status] += 1
      result.all += 1
    }

    return result
  }, [all.data])

  const visible = useMemo(
    () => (list.data ?? []).filter(r => matches(r, text)),
    [list.data, text],
  )
  const now = new Date()
  const label = FILTERS.find(f => f.value === status)?.label.toLowerCase()
  const query = text.trim()
  const newReminder = () => setDialog({ open: true, reminder: null })

  return (
    <div className="mx-auto flex w-full max-w-[1136px] flex-col gap-6 px-4 py-5 md:px-8 md:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">Reminders</h1>
        <p className="text-sm text-ink-3">Every reminder the bot holds.</p>
      </header>

      <div className="flex flex-col gap-4">
        <Tabs.Root
          value={status}
          onValueChange={value => setStatus(value as StatusFilter)}
        >
          <Tabs.List aria-label="Status filter" scroll>
            {FILTERS.map(f => (
              <Tabs.Tab
                key={f.value}
                className="shrink-0"
                count={all.data ? counts[f.value] : undefined}
                value={f.value}
              >
                {f.label}
              </Tabs.Tab>
            ))}
            <Tabs.Indicator />
          </Tabs.List>
        </Tabs.Root>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            aria-label="Filter reminders"
            icon="search"
            placeholder="Who or what…"
            value={text}
            wrapperClassName="w-full sm:max-w-xs"
            onChange={e => setText(e.target.value)}
          />
          <Button
            className="sm:ml-auto"
            icon="plus"
            variant="accent"
            onClick={newReminder}
          >
            New reminder
          </Button>
        </div>
      </div>

      {list.isLoading && <ListSkeleton />}
      {list.error && (
        <Note
          icon={<Icon name="alert" />}
          lead="Couldn’t load reminders."
          tone="bad"
        >
          The API didn’t answer. Reload the page to try again.
        </Note>
      )}
      {list.data && visible.length === 0 && (
        <div className="rounded-lg border border-line bg-surface">
          {query ? (
            <EmptyState
              action={
                <Button variant="outline" onClick={() => setText('')}>
                  Clear search
                </Button>
              }
              body={`Nothing matches “${query}”. Check the spelling, or search by what it says.`}
              title="No matching reminders"
            />
          ) : (
            <EmptyState
              action={
                <Button icon="plus" variant="accent" onClick={newReminder}>
                  New reminder
                </Button>
              }
              body="Create one here, or ask tdr-bot in Discord."
              title={
                status === 'all' ? 'No reminders' : `No ${label} reminders`
              }
            />
          )}
        </div>
      )}
      {visible.length > 0 && (
        <ReminderList
          now={now}
          reminders={visible}
          onCancel={setCancelling}
          onEdit={reminder => setDialog({ open: true, reminder })}
          onTest={setTesting}
        />
      )}

      <ReminderDialog
        open={dialog.open}
        reminder={dialog.reminder}
        onClose={() => setDialog(d => ({ ...d, open: false }))}
      />
      <CancelDialog reminder={cancelling} onClose={() => setCancelling(null)} />
      <TestSendDialog reminder={testing} onClose={() => setTesting(null)} />
    </div>
  )
}
