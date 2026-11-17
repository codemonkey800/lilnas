'use client'

import { cns } from '@lilnas/utils/cns'
import type { CSSProperties, JSX, ReactNode } from 'react'
import { Fragment, memo, useLayoutEffect, useRef } from 'react'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export type LogLine = {
  id: string | number
  ts?: string
  level?: LogLevel
  source?: string
  message: string
  /** Tinted, whatever the level. */
  stderr?: boolean
  /** Arrived just now; rises in unless the list is virtualised. */
  fresh?: boolean
}

const LEVEL_COLORS: Record<LogLevel, string> = {
  DEBUG: 'text-ink-4',
  INFO: 'text-accent-hi',
  WARN: 'text-warn',
  ERROR: 'text-bad',
}

/** Farther than this from the bottom counts as the reader scrolling up. */
const BOTTOM_SLACK_PX = 24

export type LogLineRowProps = {
  line: LogLine
  /**
   * Recycled rows flicker if they animate, so a virtualised list sets this
   * and `fresh` is ignored.
   */
  virtualized?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * One log line, without the container: tdr-code's virtualised list uses it
 * directly with `virtualized`.
 */
export const LogLineRow = memo(function LogLineRow({
  line,
  virtualized = false,
  className,
  style,
}: LogLineRowProps): JSX.Element {
  return (
    <div
      className={cns(
        'flex gap-3 border-l-2 px-3 font-mono text-mono-sm leading-[1.65]',
        line.stderr
          ? 'border-bad bg-bad-ghost text-bad'
          : 'border-transparent text-ink-2',
        line.fresh && !virtualized && 'animate-rise',
        className,
      )}
      data-stream={line.stderr ? 'stderr' : undefined}
      style={style}
    >
      {line.ts ? (
        <span className="shrink-0 text-ink-3 tabular-nums">{line.ts}</span>
      ) : null}
      {line.level ? (
        <span
          className={cns(
            'w-[5ch] shrink-0 font-medium',
            LEVEL_COLORS[line.level],
          )}
          data-level={line.level}
        >
          {line.level}
        </span>
      ) : null}
      {line.source ? (
        <span className="shrink-0 text-ink">{line.source}</span>
      ) : null}
      <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">
        {line.message}
      </span>
    </div>
  )
})

export type LogViewerProps = {
  lines: readonly LogLine[]
  /** Keep the view on the newest line. Scrolling up asks to turn it off. */
  follow?: boolean
  onFollowChange?: (follow: boolean) => void
  /** CSS height of the well; it scrolls inside it. */
  height?: number | string
  /** Replaces the default row; a virtualised consumer supplies its own. */
  renderLine?: (line: LogLine, index: number) => ReactNode
  /** Rows are recycled by the consumer, so nothing animates in. */
  virtualize?: boolean
  'aria-label'?: string
  className?: string
}

/**
 * A sunk, scrolling well of monospaced log lines. While `follow` is on it
 * sticks to the bottom, but only while the reader is there: scrolling up
 * releases it (and asks for `follow` to go off) so new lines don't yank them
 * back down.
 */
export function LogViewer({
  lines,
  follow = false,
  onFollowChange,
  height = '20rem',
  renderLine,
  virtualize = false,
  'aria-label': ariaLabel = 'Logs',
  className,
}: LogViewerProps): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  function toBottom() {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // Turning follow on is the reader asking to be at the bottom.
  useLayoutEffect(() => {
    if (!follow) return
    pinned.current = true
    toBottom()
  }, [follow])

  useLayoutEffect(() => {
    if (follow && pinned.current) toBottom()
  }, [follow, lines])

  function onScroll() {
    const el = scroller.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = gap <= BOTTOM_SLACK_PX
    pinned.current = atBottom
    if (follow && !atBottom) onFollowChange?.(false)
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-live="polite"
      className={cns(
        'overflow-auto rounded-lg border border-line bg-bg-sunk py-3',
        className,
      )}
      onScroll={onScroll}
      ref={scroller}
      role="log"
      style={{ height }}
      tabIndex={0}
    >
      {lines.map((line, index) =>
        renderLine ? (
          <Fragment key={line.id}>{renderLine(line, index)}</Fragment>
        ) : (
          <LogLineRow key={line.id} line={line} virtualized={virtualize} />
        ),
      )}
    </div>
  )
}
