'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'
import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { Panel, PanelHead } from 'src/components/detail/panel'
import { Segmented } from 'src/components/detail/segmented'
import { formatLogTime } from 'src/components/detail/time'
import { Toggle } from 'src/components/detail/toggle'
import {
  BUFFER_CAP,
  type LogEntry,
  type LogStatus,
  TAIL_CHOICES,
  type TailChoice,
  useContainerLogs,
} from 'src/components/logs/use-container-logs'
import { Button } from 'src/components/ui/button'
import { Icon } from 'src/components/ui/icon'
import { Dot } from 'src/components/ui/status'

/** Farther than this from the bottom counts as the reader scrolling up. */
const BOTTOM_SLACK_PX = 24

const DEFAULT_TAIL: TailChoice = 500

/** The buffer as a file: Docker's timestamp (when asked for), then the line. */
export function logsToText(lines: readonly LogEntry[]): string {
  return lines.map(l => (l.ts ? `${l.ts} ${l.text}` : l.text)).join('\n') + '\n'
}

const LogRow = memo(function LogRow({
  line,
  timestamps,
}: {
  line: LogEntry
  timestamps: boolean
}): JSX.Element {
  const err = line.stream === 'stderr'
  return (
    <div
      className={cns(
        'flex gap-3 border-l-2 px-4',
        err
          ? 'border-bad bg-bad-ghost text-bad'
          : 'border-transparent text-ink-2',
      )}
      data-stream={line.stream}
    >
      {timestamps && line.ts ? (
        <span className="shrink-0 text-ink-4 tabular-nums">
          {formatLogTime(line.ts)}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">
        {line.text}
      </span>
    </div>
  )
})

function Status({
  follow,
  status,
}: {
  follow: boolean
  status: LogStatus
}): JSX.Element {
  if (status === 'reconnecting') {
    return (
      <span className="flex items-center gap-1.5 font-mono text-mono-sm text-warn">
        <Dot tone="warn" />
        reconnecting
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1.5 font-mono text-mono-sm text-ink-3">
      <Dot tone={follow && status === 'live' ? 'live' : undefined} />
      {status === 'connecting'
        ? 'connecting'
        : status === 'ended'
          ? 'ended'
          : follow
            ? 'following'
            : 'paused'}
    </span>
  )
}

/**
 * Live container logs: pick a container, a tail and whether to follow, then
 * read, filter, clear or download them. `containers` are the stack's
 * containers that exist; the viewer streams one at a time. `running` names
 * those that are running; the rest show their tail and stop. Omitted, every
 * container counts as running.
 */
export function LogViewer({
  containers,
  running,
}: {
  containers: readonly string[]
  running?: readonly string[]
}): JSX.Element {
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [tail, setTail] = useState<TailChoice>(DEFAULT_TAIL)
  const [follow, setFollow] = useState(true)
  const [timestamps, setTimestamps] = useState(true)
  const [filter, setFilter] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const selectId = useId()

  // A container that has gone away falls back to the first one that's left.
  const container =
    selected && containers.includes(selected) ? selected : containers[0]

  const { lines, status, clear } = useContainerLogs(
    container,
    tail,
    timestamps,
    !running || (container !== undefined && running.includes(container)),
  )

  const needle = filter.trim().toLowerCase()
  const visible = useMemo(
    () =>
      needle ? lines.filter(l => l.text.toLowerCase().includes(needle)) : lines,
    [lines, needle],
  )

  useLayoutEffect(() => {
    const el = scroller.current
    if (follow && el) el.scrollTop = el.scrollHeight
  }, [follow, visible, status])

  function onScroll() {
    const el = scroller.current
    if (!el || !follow) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    if (gap > BOTTOM_SLACK_PX) setFollow(false)
  }

  function download() {
    if (!container) return
    const url = URL.createObjectURL(
      new Blob([logsToText(lines)], { type: 'text/plain' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `${container}.log`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  if (!container) {
    return (
      <Panel aria-label="Container logs">
        <PanelHead
          caption="stdout and stderr · stderr is tinted"
          title="Container logs"
        />
        <div className="flex flex-col items-center gap-1.5 bg-bg-sunk px-6 py-10 text-center">
          <p className="text-h3">No containers yet</p>
          <p className="max-w-[40ch] text-sm text-ink-3">
            Logs show up once the stack has a container. Up creates them.
          </p>
        </div>
      </Panel>
    )
  }

  return (
    <Panel aria-label="Container logs">
      <PanelHead
        caption="stdout and stderr · stderr is tinted"
        title="Container logs"
      >
        <Status follow={follow} status={status} />
      </PanelHead>

      <div className="flex flex-col gap-3 border-b border-line-soft px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <div className="w-full md:w-[250px]">
            <label className="sr-only" htmlFor={selectId}>
              Container
            </label>
            <select
              className="h-[38px] w-full rounded-md border border-line bg-bg-sunk px-3 font-mono text-mono text-ink transition-[border-color,box-shadow] duration-200 ease-uv outline-none [color-scheme:dark] focus:border-uv focus:shadow-[0_0_0_3px_var(--color-uv-ghost)]"
              id={selectId}
              onChange={event => setSelected(event.target.value)}
              value={container}
            >
              {containers.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <Segmented
            label="Tail lines"
            onChange={setTail}
            options={TAIL_CHOICES}
            value={tail}
          />
          <Toggle checked={follow} label="Follow" onChange={setFollow} />
          <Toggle
            checked={timestamps}
            label="Timestamps"
            onChange={setTimestamps}
          />
          <span className="flex w-full items-center gap-1.5 md:ml-auto md:w-auto [&>button]:flex-1 md:[&>button]:flex-none">
            <Button icon="x" onClick={clear} size="sm" variant="ghost">
              Clear
            </Button>
            <Button
              icon="download"
              onClick={download}
              size="sm"
              variant="outline"
            >
              Download
            </Button>
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-md border border-line bg-bg-sunk px-3 transition-[border-color,box-shadow] duration-200 ease-uv focus-within:border-uv focus-within:shadow-[0_0_0_3px_var(--color-uv-ghost)]">
          <Icon
            className="h-[14px] w-[14px] shrink-0 text-ink-4"
            name="search"
          />
          <input
            aria-label="Filter lines"
            className="h-[34px] min-w-0 flex-1 border-none bg-transparent font-mono text-mono text-ink outline-none placeholder:text-ink-4"
            onChange={event => setFilter(event.target.value)}
            placeholder="Filter lines"
            value={filter}
          />
        </div>
      </div>

      <div
        className="h-[300px] overflow-auto bg-bg-sunk py-3 font-mono text-[12px] leading-[1.7]"
        onScroll={onScroll}
        ref={scroller}
        role="log"
      >
        {needle && visible.length === 0 && lines.length > 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center font-sans">
            <p className="text-h3">No lines match “{filter.trim()}”</p>
            <p className="max-w-[40ch] text-sm text-ink-3">
              The last {lines.length} lines of {container} don’t contain it. Try
              a shorter filter or a longer tail.
            </p>
            <Button
              className="mt-2"
              onClick={() => setFilter('')}
              size="sm"
              variant="outline"
            >
              Clear filter
            </Button>
          </div>
        ) : (
          <div>
            {visible.map(line => (
              <LogRow key={line.id} line={line} timestamps={timestamps} />
            ))}
            {lines.length === 0 && status !== 'reconnecting' ? (
              <p className="px-4 text-ink-4">
                {status === 'connecting'
                  ? 'Connecting…'
                  : 'No output yet. New lines appear here.'}
              </p>
            ) : null}
          </div>
        )}
        {status === 'reconnecting' ? (
          <p className="px-4 text-warn" role="status">
            disconnected — reconnecting…
          </p>
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-line-soft px-5 py-2.5 font-mono text-mono-sm text-ink-4 tabular-nums">
        <span title={`The viewer keeps the last ${BUFFER_CAP} lines.`}>
          {needle
            ? `${visible.length} of ${lines.length} lines`
            : `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`}
        </span>
        <span className="truncate">{container}</span>
      </footer>
    </Panel>
  )
}
