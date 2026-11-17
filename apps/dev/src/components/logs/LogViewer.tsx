'use client'

import {
  Button,
  Card,
  Input,
  type LogLine,
  LogLineRow,
  LogViewer as LogPane,
  Segmented,
  Select,
  StatusDot,
  type StatusDotTone,
  Switch,
} from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'
import { useId, useMemo, useState } from 'react'

import { CardHead } from 'src/components/detail/card-head'
import { formatLogTime } from 'src/components/detail/time'
import {
  BUFFER_CAP,
  type LogEntry,
  type LogStatus,
  TAIL_CHOICES,
  type TailChoice,
  useContainerLogs,
} from 'src/components/logs/use-container-logs'

const DEFAULT_TAIL: TailChoice = 500

const TAIL_OPTIONS = TAIL_CHOICES.map(n => ({
  value: String(n),
  label: String(n),
}))

/** The well is this tall whatever it holds, so the page doesn't jump. */
const WELL_HEIGHT = 300

/** The buffer as a file: Docker's timestamp (when asked for), then the line. */
export function logsToText(lines: readonly LogEntry[]): string {
  return lines.map(l => (l.ts ? `${l.ts} ${l.text}` : l.text)).join('\n') + '\n'
}

// `LogLineRow` is memoised on its `line`, so each buffered entry keeps one
// `LogLine` object per timestamp setting; rebuilding them on every flush would
// re-render all 5000 rows when one arrives.
const WITH_TIME = new WeakMap<LogEntry, LogLine>()
const WITHOUT_TIME = new WeakMap<LogEntry, LogLine>()

function toLogLine(entry: LogEntry, timestamps: boolean): LogLine {
  const cache = timestamps ? WITH_TIME : WITHOUT_TIME
  let line = cache.get(entry)
  if (!line) {
    line = {
      id: entry.id,
      ts: timestamps && entry.ts ? formatLogTime(entry.ts) : undefined,
      message: entry.text,
      stderr: entry.stream === 'stderr',
    }
    cache.set(entry, line)
  }
  return line
}

/** An id no `LogEntry` has: the one row that says something about the stream. */
const NOTE_ID = 'note'

const STATUS_LOOK: Record<
  'connecting' | 'live' | 'paused' | 'reconnecting' | 'ended',
  { dot: StatusDotTone; pulse: boolean; text: string }
> = {
  connecting: { dot: 'accent', pulse: false, text: 'text-ink-3' },
  live: { dot: 'ok', pulse: true, text: 'text-ink-3' },
  paused: { dot: 'idle', pulse: false, text: 'text-ink-3' },
  reconnecting: { dot: 'warn', pulse: false, text: 'text-warn' },
  ended: { dot: 'idle', pulse: false, text: 'text-ink-3' },
}

/** Beside the heading. Only a live follow pulses; a dropped stream is amber. */
function Status({
  follow,
  status,
}: {
  follow: boolean
  status: LogStatus
}): JSX.Element {
  const word = status === 'live' ? (follow ? 'live' : 'paused') : status
  const look = STATUS_LOOK[word]
  return (
    <span className={cns('flex items-center gap-2 text-cap', look.text)}>
      <StatusDot pulse={look.pulse} tone={look.dot} />
      {word}
    </span>
  )
}

/** A well with nothing to scroll: says what happened and what to do. */
function WellMessage({
  title,
  children,
}: {
  title: string
  children?: React.ReactNode
}): JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-line bg-bg-sunk px-6 text-center"
      style={{ height: WELL_HEIGHT }}
    >
      <p className="text-h3">{title}</p>
      {children}
    </div>
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

  const noMatch = needle !== '' && visible.length === 0 && lines.length > 0

  const rows = useMemo(() => {
    const mapped = visible.map(entry => toLogLine(entry, timestamps))
    if (status === 'reconnecting') {
      return [
        ...mapped,
        { id: NOTE_ID, message: 'disconnected — reconnecting…' },
      ]
    }
    if (lines.length === 0) {
      return [
        {
          id: NOTE_ID,
          message:
            status === 'connecting'
              ? 'Connecting…'
              : 'No output yet. New lines appear here.',
        },
      ]
    }
    return mapped
  }, [visible, timestamps, status, lines.length])

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
      <Card aria-label="Container logs" role="region">
        <CardHead
          caption="stdout and stderr · stderr is tinted"
          title="Container logs"
        />
        <WellMessage title="No containers yet">
          <p className="max-w-[40ch] text-sm text-ink-3">
            Logs show up once the stack has a container. Up creates them.
          </p>
        </WellMessage>
      </Card>
    )
  }

  return (
    <Card aria-label="Container logs" role="region">
      <CardHead
        caption="stdout and stderr · stderr is tinted"
        title="Container logs"
      >
        <Status follow={follow} status={status} />
      </CardHead>

      <div className="flex flex-col gap-3 pb-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <Select.Root
            items={Object.fromEntries(containers.map(name => [name, name]))}
            onValueChange={value => setSelected(value ?? undefined)}
            value={container}
          >
            <Select.Trigger
              aria-label="Container"
              className="w-full font-mono md:w-[250px]"
              id={selectId}
            >
              <Select.Value />
            </Select.Trigger>
            <Select.Popup>
              {containers.map(name => (
                <Select.Item className="font-mono" key={name} value={name}>
                  {name}
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Root>
          <Segmented
            label="Tail lines"
            onValueChange={value => setTail(Number(value) as TailChoice)}
            options={TAIL_OPTIONS}
            value={String(tail)}
          />
          <Switch checked={follow} label="Follow" onCheckedChange={setFollow} />
          <Switch
            checked={timestamps}
            label="Timestamps"
            onCheckedChange={setTimestamps}
          />
          <span className="flex w-full items-center gap-1.5 md:ml-auto md:w-auto [&>button]:flex-1 md:[&>button]:flex-none">
            <Button icon="x" onClick={clear} size="sm" variant="ghost">
              Clear
            </Button>
            <Button icon="download" onClick={download} size="sm">
              Download
            </Button>
          </span>
        </div>
        <Input
          aria-label="Filter lines"
          icon="search"
          mono
          onChange={event => setFilter(event.target.value)}
          placeholder="Filter lines"
          value={filter}
        />
      </div>

      {noMatch ? (
        <WellMessage title={`No lines match “${filter.trim()}”`}>
          <p className="max-w-[40ch] text-sm text-ink-3">
            The last {lines.length} lines of {container} don’t contain it. Try a
            shorter filter or a longer tail.
          </p>
          <Button className="mt-2" onClick={() => setFilter('')} size="sm">
            Clear filter
          </Button>
        </WellMessage>
      ) : (
        <LogPane
          aria-label="Container log output"
          follow={follow}
          height={WELL_HEIGHT}
          lines={rows}
          onFollowChange={setFollow}
          renderLine={line =>
            line.id === NOTE_ID ? (
              <p
                className={cns(
                  'px-3 font-mono text-mono-sm',
                  status === 'reconnecting' ? 'text-warn' : 'text-ink-3',
                )}
                role={status === 'reconnecting' ? 'status' : undefined}
              >
                {line.message}
              </p>
            ) : (
              <LogLineRow line={line} />
            )
          }
        />
      )}

      <div className="mt-2 flex items-center justify-between gap-3 text-cap text-ink-3 tabular-nums">
        <span title={`The viewer keeps the last ${BUFFER_CAP} lines.`}>
          {needle
            ? `${visible.length} of ${lines.length} lines`
            : `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`}
        </span>
        <span className="truncate font-mono text-mono-sm">{container}</span>
      </div>
    </Card>
  )
}
