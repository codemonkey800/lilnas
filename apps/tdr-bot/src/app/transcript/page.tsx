'use client'

import { EmptyState, Field, Input, Note, Skeleton, Spinner } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { TranscriptTotals } from 'src/api/api.types'
import { type EmojiLookup, useEmojiLookup } from 'src/queries/useEmojiLookup'
import { useTranscript, useTranscriptChannels } from 'src/queries/useTranscript'

import { ChannelList } from './channel-list'
import { usd } from './format'
import { buildTranscriptItems, TranscriptItem } from './group-turns'
import { TranscriptTurn } from './turn'

const DAY_MS = 24 * 60 * 60 * 1000

/** How far above the top of the transcript older pages start loading. */
const PREFETCH_MARGIN = '400px'

const isoDay = (date: Date) => date.toISOString().slice(0, 10)

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
})

function TotalsStrip({
  totals,
  loading,
}: {
  totals?: TranscriptTotals
  loading: boolean
}) {
  const stats: [string, string | undefined][] = [
    ['Total cost', totals && usd(totals.costUsd, 4)],
    ['Input tokens', totals && compact.format(totals.inputTokens)],
    ['Output tokens', totals && compact.format(totals.outputTokens)],
  ]

  return (
    <dl className="grid grid-cols-3 gap-x-6 md:text-right">
      {stats.map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-label whitespace-nowrap text-ink-3 uppercase">
            {label}
          </dt>
          <dd>
            {loading || value === undefined ? (
              <Skeleton className="mt-1 h-4 w-14 rounded-xs" />
            ) : (
              <span className="font-mono text-mono font-semibold tabular-nums">
                {value}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function TranscriptBody({
  items,
  lookup,
  loading,
  error,
  sentinelRef,
  hasOlder,
  loadingOlder,
}: {
  items: TranscriptItem[]
  lookup: EmojiLookup
  loading: boolean
  error: Error | null
  sentinelRef: RefObject<HTMLDivElement | null>
  hasOlder: boolean
  loadingOlder: boolean
}) {
  if (error) {
    return (
      <Note lead="Couldn’t load this channel." tone="bad">
        The API didn’t answer, so there’s nothing to show yet. Pick the channel
        again to retry.{' '}
        <code className="font-mono text-mono-sm">{error.message}</code>
      </Note>
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4" data-testid="transcript-loading">
        {['w-1/2', 'w-2/3', 'w-2/5', 'w-3/5'].map((w, i) => (
          <div key={w} className={cns('flex', i % 2 === 0 && 'justify-end')}>
            <Skeleton className={cns('h-16 rounded-xl', w)} />
          </div>
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          body="Messages in this range show up here, with what each reply cost. Pick another channel or widen the dates."
          title="No messages yet"
        />
      </div>
    )
  }

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px shrink-0" />
      {loadingOlder ? (
        <div
          className="flex justify-center pb-1"
          data-testid="transcript-loading-older"
        >
          <span className="flex items-center gap-2 text-cap text-ink-3">
            <Spinner size={14} />
            Loading older messages…
          </span>
        </div>
      ) : (
        !hasOlder && (
          <div className="flex items-center gap-3 text-cap text-ink-3">
            <span className="h-px flex-1 bg-line" />
            Start of conversation
            <span className="h-px flex-1 bg-line" />
          </div>
        )
      )}
      {items.map((item, i) => (
        <TranscriptTurn key={i} item={item} lookup={lookup} />
      ))}
    </>
  )
}

export default function TranscriptPage() {
  const [from, setFrom] = useState(() =>
    isoDay(new Date(Date.now() - 6 * DAY_MS)),
  )
  const [to, setTo] = useState(() => isoDay(new Date()))
  const [selected, setSelected] = useState<string>()

  const channels = useTranscriptChannels()
  const channelId = selected ?? channels.data?.[0]?.channelId
  const transcript = useTranscript(channelId, { from, to })
  const lookup = useEmojiLookup()
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = transcript

  // Pages arrive newest first; a request never spans pages because each page
  // starts on a human message.
  const pages = transcript.data?.pages
  const items = useMemo(() => {
    if (!pages) return []
    const oldestFirst = pages.slice().reverse()
    return buildTranscriptItems(
      oldestFirst.flatMap(p => p.messages),
      oldestFirst.flatMap(p => p.calls),
    )
  }, [pages])

  const scrollRef = useRef<HTMLElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // Distance from the bottom, kept current so prepending older items can
  // restore it.
  const fromBottom = useRef(0)
  const restoring = useRef(false)
  const bottomedFor = useRef<string>(undefined)
  const threadKey = `${channelId}|${from}|${to}`

  const trackScroll = () => {
    const el = scrollRef.current
    if (el) fromBottom.current = el.scrollHeight - el.scrollTop
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || items.length === 0) return
    if (bottomedFor.current !== threadKey) {
      bottomedFor.current = threadKey
      restoring.current = false
      el.scrollTop = el.scrollHeight
    } else if (restoring.current) {
      el.scrollTop = el.scrollHeight - fromBottom.current
      if (!isFetchingNextPage) restoring.current = false
    }
    trackScroll()
  }, [items, isFetchingNextPage, threadKey])

  // Re-created after every fetch so a sentinel that stays in view (short
  // pages) triggers the next one.
  useEffect(() => {
    const root = scrollRef.current
    const target = sentinelRef.current
    if (!root || !target || !hasNextPage || isFetchingNextPage) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        restoring.current = true
        void fetchNextPage()
      },
      { root, rootMargin: `${PREFETCH_MARGIN} 0px 0px 0px` },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [items, hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="mx-auto flex w-full max-w-[1216px] flex-col gap-6 px-4 py-5 md:px-8 md:py-8">
      <h1 className="sr-only">Transcript</h1>
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        <div className="flex flex-col gap-4 border-b border-line p-3 md:flex-row md:items-end md:justify-between">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-[176px_176px]">
            <Field label="From">
              <Input
                mono
                max={to || undefined}
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
              />
            </Field>
            <Field label="To">
              <Input
                mono
                min={from || undefined}
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
              />
            </Field>
          </div>
          <TotalsStrip
            loading={channels.isLoading || transcript.isLoading}
            totals={pages?.[0]?.totals ?? undefined}
          />
        </div>

        <div className="flex flex-col md:grid md:grid-cols-[232px_minmax(0,1fr)] md:grid-rows-[640px]">
          <ChannelList
            channels={channels.data}
            error={channels.error}
            loading={channels.isLoading}
            selectedId={channelId}
            onSelect={setSelected}
          />
          <section
            ref={scrollRef}
            aria-label="Conversation"
            className="flex h-[70dvh] min-h-0 min-w-0 flex-col gap-3 overflow-y-auto bg-bg p-4 [overflow-anchor:none] md:h-auto md:p-5"
            onScroll={trackScroll}
          >
            <TranscriptBody
              error={transcript.error}
              hasOlder={hasNextPage}
              items={items}
              loading={
                channels.isLoading || (!!channelId && transcript.isLoading)
              }
              loadingOlder={isFetchingNextPage}
              lookup={lookup}
              sentinelRef={sentinelRef}
            />
          </section>
        </div>
      </div>
    </div>
  )
}
