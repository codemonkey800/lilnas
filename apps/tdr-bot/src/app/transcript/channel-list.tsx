'use client'

import { Note, Skeleton } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'

import type { TranscriptChannel } from 'src/api/api.types'

import { formatTime } from './format'

export interface ChannelListProps {
  channels: TranscriptChannel[] | undefined
  loading: boolean
  error: Error | null
  selectedId: string | undefined
  onSelect: (channelId: string) => void
}

const count = (n: number) => n.toLocaleString('en-US')

function ChannelError({ error }: { error: Error }) {
  return (
    <div className="p-3">
      <Note lead="Couldn’t load channels." tone="bad">
        {error.message}
      </Note>
    </div>
  )
}

/** A 232px sidebar from `md` up, a horizontal scroller of pills below it. */
export function ChannelList({
  channels,
  loading,
  error,
  selectedId,
  onSelect,
}: ChannelListProps) {
  return (
    <>
      <nav
        aria-label="Channels"
        className="flex gap-2 overflow-x-auto border-b border-line px-3 py-2.5 md:hidden"
      >
        {loading &&
          [0, 1, 2, 3].map(i => (
            <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
          ))}
        {error && <ChannelError error={error} />}
        {channels?.map(ch => {
          const active = ch.channelId === selectedId
          return (
            <button
              key={ch.channelId}
              aria-pressed={active}
              className={cns(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-press',
                active
                  ? 'border-accent bg-accent-ghost text-ink'
                  : 'border-line text-ink-2',
              )}
              type="button"
              onClick={() => onSelect(ch.channelId)}
            >
              # {ch.name}
              <span className="font-mono text-mono-sm text-ink-3 tabular-nums">
                {count(ch.calls)}
              </span>
            </button>
          )
        })}
      </nav>

      <aside
        aria-label="Channels"
        className="hidden overflow-y-auto border-r border-line md:block"
      >
        {loading &&
          [0, 1, 2, 3].map(i => (
            <div
              key={i}
              className="flex flex-col gap-2 border-b border-line-soft px-4 py-3"
            >
              <Skeleton className="h-3.5 w-24 rounded-xs" />
              <Skeleton className="h-3 w-32 rounded-xs" />
            </div>
          ))}
        {error && <ChannelError error={error} />}
        {channels?.map(ch => {
          const active = ch.channelId === selectedId
          return (
            <button
              key={ch.channelId}
              aria-current={active ? 'true' : undefined}
              className={cns(
                'flex w-full flex-col gap-0.5 border-b border-line-soft px-4 py-3 text-left transition-colors duration-200 ease-standard',
                active
                  ? 'bg-accent-ghost shadow-[inset_2px_0_0_var(--color-accent)]'
                  : 'hover:bg-surface-2',
              )}
              type="button"
              onClick={() => onSelect(ch.channelId)}
            >
              <span className="text-[13.5px] font-medium"># {ch.name}</span>
              <span className="flex items-baseline gap-1.5 text-cap text-ink-3">
                <span>{formatTime(ch.lastAt)}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-mono-sm tabular-nums">
                  {count(ch.calls)} calls
                </span>
              </span>
            </button>
          )
        })}
      </aside>
    </>
  )
}
