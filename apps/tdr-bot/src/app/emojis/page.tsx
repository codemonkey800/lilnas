'use client'

import {
  Badge,
  Button,
  EmptyState,
  Icon,
  Input,
  Note,
  Skeleton,
  Tabs,
} from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { useMemo, useState } from 'react'

import type { EmojiView } from 'src/api/api.types'
import {
  useEmojis,
  useReconcileEmojis,
  useRedescribeEmoji,
} from 'src/queries/useEmojis'

import { EmojiCard } from './EmojiCard'
import {
  type EmojiFilter,
  filterCounts,
  FILTERS,
  needsRedescribeConfirm,
  reconcileStatusLine,
  redescribeAllScope,
  visibleEmojis,
} from './format'
import { RedescribeAllDialog } from './RedescribeAllDialog'
import { RedescribeDialog } from './RedescribeDialog'

const GRID =
  'grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

function EmojiSkeleton() {
  return (
    <div aria-label="Loading emojis" className={cns(GRID)} role="status">
      {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="size-12 rounded-md" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-24 rounded-xs" />
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
          </div>
          <Skeleton className="h-3 w-full rounded-xs" />
          <Skeleton className="h-3 w-11/12 rounded-xs" />
          <Skeleton className="h-3 w-2/3 rounded-xs" />
        </div>
      ))}
    </div>
  )
}

export default function EmojisPage() {
  const [filter, setFilter] = useState<EmojiFilter>('all')
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<EmojiView | null>(null)
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [startedAt, setStartedAt] = useState<Date | null>(null)

  const list = useEmojis()
  const reconcile = useReconcileEmojis()
  const redescribe = useRedescribeEmoji()

  const emojis = useMemo(() => list.data?.emojis ?? [], [list.data])
  const counts = useMemo(() => filterCounts(emojis), [emojis])
  const scope = useMemo(() => redescribeAllScope(emojis), [emojis])
  const visible = useMemo(
    () => visibleEmojis(emojis, filter, text),
    [emojis, filter, text],
  )

  // The POST is pending until the refetch it triggers lands, so the buttons
  // stay busy until the poll takes over and reports the run finished.
  const running = reconcile.isPending || !!list.data?.reconcile.running
  const now = new Date()

  const failedName =
    emojis.find(e => e.id === redescribe.variables)?.name ??
    redescribe.variables

  const startReconcile = () => {
    setStartedAt(new Date())
    reconcile.mutate()
  }

  const onRedescribe = (emoji: EmojiView) => {
    if (needsRedescribeConfirm(emoji)) {
      setConfirming(emoji)
      return
    }
    redescribe.mutate(emoji.id)
  }

  const clearFilters = () => {
    setText('')
    setFilter('all')
  }

  return (
    <div className="mx-auto flex w-full max-w-[1136px] flex-col gap-6 px-4 py-5 md:px-8 md:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">Emojis</h1>
        <p className="text-sm text-ink-3">
          What each custom emoji looks like and means, so the bot can use them.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <Tabs.Root
          value={filter}
          onValueChange={value => setFilter(value as EmojiFilter)}
        >
          <Tabs.List aria-label="Emoji filter" scroll>
            {FILTERS.map(f => (
              <Tabs.Tab
                key={f.value}
                className="shrink-0"
                count={counts[f.value]}
                value={f.value}
              >
                {f.label}
              </Tabs.Tab>
            ))}
            <Tabs.Indicator />
          </Tabs.List>
        </Tabs.Root>

        <div className="flex flex-col gap-3 md:flex-row md:items-start">
          <Input
            aria-label="Search emojis"
            className="min-w-0"
            icon="search"
            placeholder="Search name or description…"
            type="search"
            value={text}
            wrapperClassName="w-full md:max-w-xs"
            onChange={e => setText(e.target.value)}
          />
          <div className="flex flex-col gap-2 md:ml-auto md:items-end">
            <div className="flex gap-2">
              <Button
                className="max-md:flex-1"
                disabled={running || scope.total === 0}
                variant="outline"
                onClick={() => setConfirmingAll(true)}
              >
                Re-describe all
              </Button>
              <Button
                className="max-md:flex-1"
                disabled={running}
                loading={running}
                variant="outline"
                onClick={startReconcile}
              >
                {running ? 'Reconciling…' : 'Run reconcile now'}
              </Button>
            </div>
            {list.data && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-cap text-ink-3">
                {running && (
                  <Badge live tone="accent">
                    Reconciling
                  </Badge>
                )}
                <span>
                  {reconcileStatusLine(
                    { ...list.data.reconcile, running },
                    now,
                    startedAt,
                  )}
                </span>
              </p>
            )}
          </div>
        </div>
      </div>

      {reconcile.error && (
        <Note
          icon={<Icon name="alert" />}
          lead="Couldn’t start a reconcile."
          tone="bad"
          onDismiss={reconcile.reset}
        >
          {reconcile.error.message}
        </Note>
      )}
      {redescribe.error && (
        <Note
          icon={<Icon name="alert" />}
          lead={`Couldn’t re-describe :${failedName}:.`}
          tone="bad"
          onDismiss={redescribe.reset}
        >
          {redescribe.error.message}
        </Note>
      )}

      {list.isLoading && <EmojiSkeleton />}
      {list.error && (
        <Note
          icon={<Icon name="alert" />}
          lead="Couldn’t load the emojis."
          tone="bad"
        >
          {list.error.message}
        </Note>
      )}
      {list.data && emojis.length === 0 && (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState
            action={
              <Button
                disabled={running}
                loading={running}
                variant="accent"
                onClick={startReconcile}
              >
                {running ? 'Reconciling…' : 'Run reconcile now'}
              </Button>
            }
            body="Run a reconcile and the server’s custom emojis will show up here."
            title="No emojis synced yet"
          />
        </div>
      )}
      {emojis.length > 0 && visible.length === 0 && (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState
            action={
              <Button variant="outline" onClick={clearFilters}>
                {text.trim() ? 'Clear search' : 'Show all'}
              </Button>
            }
            body={
              text.trim()
                ? `Nothing matches “${text.trim()}”. Check the spelling, or search by what the emoji looks like.`
                : 'No emoji is in this filter yet.'
            }
            title="No matching emojis"
          />
        </div>
      )}
      {visible.length > 0 && (
        <ul className={GRID}>
          {visible.map(emoji => (
            <EmojiCard
              key={emoji.id}
              editing={emoji.id === editingId}
              emoji={emoji}
              reconciling={running}
              redescribing={
                redescribe.isPending && redescribe.variables === emoji.id
              }
              onCloseEdit={() => setEditingId(null)}
              onEdit={e => setEditingId(e.id)}
              onRedescribe={onRedescribe}
            />
          ))}
        </ul>
      )}

      <RedescribeDialog
        emoji={confirming}
        onClose={() => setConfirming(null)}
      />
      <RedescribeAllDialog
        manual={scope.manual}
        open={confirmingAll}
        total={scope.total}
        onClose={() => setConfirmingAll(false)}
        onStarted={() => setStartedAt(new Date())}
      />
    </div>
  )
}
