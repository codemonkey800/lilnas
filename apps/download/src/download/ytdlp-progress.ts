import type { VideoProgress } from '@lilnas/utils/download/types'
import { StringDecoder } from 'string_decoder'

/** The literal yt-dlp is told to print before each JSON tick. */
export const YTDLP_PROGRESS_PREFIX = 'LILNAS_PROGRESS '

/**
 * Args appended to every download spawn:
 *
 * - `--newline` - one line per tick instead of `\r` redraws, so a line
 *   splitter sees every tick as it happens.
 * - `--progress-delta 1` - at most one tick per second; yt-dlp otherwise
 *   prints on every chunk it writes.
 * - `--progress-template` - the whole progress dict as JSON behind a fixed
 *   prefix, so the parser never scrapes the human-readable bar (whose
 *   `_percent` is wrong for HLS anyway).
 */
export const YTDLP_PROGRESS_ARGS: readonly string[] = [
  '--newline',
  '--progress-delta',
  '1',
  '--progress-template',
  `download:${YTDLP_PROGRESS_PREFIX}%(progress)j`,
]

/**
 * A progress tick is ~1 KiB. Anything past this without a newline is not a
 * tick, and carrying it would let a newline-less stream grow without bound.
 */
const MAX_CARRY_CHARS = 64 * 1024

const LINE_BREAK = /\r\n|\r|\n/

/**
 * Splits chunks into complete lines, carrying the remainder; `flush()` yields
 * the tail. Splits on `\n`, `\r\n` and bare `\r`, and never emits an empty
 * line. Buffers go through a `StringDecoder` so a multi-byte character split
 * across two chunks is not mangled.
 */
export function createLineSplitter(onLine: (line: string) => void): {
  push(chunk: Buffer | string): void
  flush(): void
} {
  const decoder = new StringDecoder('utf8')
  let carry = ''
  // Set once the carry overflows; the rest of that line is dropped up to
  // its newline so a truncated fragment is never emitted as if whole.
  let discarding = false

  const emit = (line: string) => {
    if (line.length > 0) onLine(line)
  }

  return {
    push(chunk) {
      const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
      if (text.length === 0) return

      const parts = (carry + text).split(LINE_BREAK)
      carry = parts.pop() ?? ''

      for (const part of parts) {
        if (discarding) {
          discarding = false
          continue
        }
        emit(part)
      }

      if (carry.length > MAX_CARRY_CHARS) {
        carry = ''
        discarding = true
      }
    },
    flush() {
      const tail = carry + decoder.end()
      carry = ''
      if (discarding) {
        discarding = false
        return
      }
      for (const part of tail.split(LINE_BREAK)) emit(part)
    },
  }
}

export interface YtdlpProgressTick {
  downloadedBytes: number
  etaSeconds?: number
  filename: string
  fragmentCount?: number
  fragmentIndex?: number
  speedBps?: number
  status: 'downloading' | 'finished'
  totalBytes?: number
  totalIsEstimate?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

/** Rounded to a whole byte count; `undefined` unless at least 1 byte. */
function positiveByteCount(value: unknown): number | undefined {
  const n = finiteNonNegative(value)
  if (n === undefined) return undefined
  const rounded = Math.round(n)
  return rounded > 0 ? rounded : undefined
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/**
 * `undefined` for any line that is not a well-formed progress tick. Never
 * throws - this runs inside a stream `'data'` listener, where an exception
 * is uncaught.
 */
export function parseYtdlpProgressLine(
  line: string,
): YtdlpProgressTick | undefined {
  if (typeof line !== 'string' || !line.startsWith(YTDLP_PROGRESS_PREFIX)) {
    return undefined
  }

  let raw: unknown
  try {
    raw = JSON.parse(line.slice(YTDLP_PROGRESS_PREFIX.length))
  } catch {
    return undefined
  }
  if (!isRecord(raw)) return undefined

  const { status, filename } = raw
  if (status !== 'downloading' && status !== 'finished') return undefined
  if (typeof filename !== 'string' || filename.length === 0) return undefined

  const downloaded = finiteNonNegative(raw.downloaded_bytes)
  if (downloaded === undefined) return undefined

  const tick: YtdlpProgressTick = {
    downloadedBytes: Math.round(downloaded),
    filename,
    status,
  }

  const exactTotal = positiveByteCount(raw.total_bytes)
  const estimatedTotal = positiveByteCount(raw.total_bytes_estimate)
  if (exactTotal !== undefined) {
    tick.totalBytes = exactTotal
  } else if (estimatedTotal !== undefined) {
    tick.totalBytes = estimatedTotal
    tick.totalIsEstimate = true
  }

  const eta = finiteNonNegative(raw.eta)
  if (eta !== undefined) tick.etaSeconds = eta

  const speed = finiteNonNegative(raw.speed)
  if (speed !== undefined) tick.speedBps = speed

  const { fragment_index: fragmentIndex, fragment_count: fragmentCount } = raw
  if (
    isNonNegativeInteger(fragmentIndex) &&
    isNonNegativeInteger(fragmentCount) &&
    fragmentCount > 0
  ) {
    tick.fragmentIndex = fragmentIndex
    tick.fragmentCount = fragmentCount
  }

  return tick
}

// `[info] aqz-KE-bpKQ: Downloading 1 format(s): 160+139`
const FORMAT_COUNT_LINE = /^\[info\] .+?: Downloading \d+ format\(s\): (.+)$/

/**
 * How many files the grab will download: `2` for
 * `[info] abc: Downloading 1 format(s): 160+139`, `1` for `...: 22`;
 * `undefined` for anything else.
 */
export function parseYtdlpFormatCountLine(line: string): number | undefined {
  if (typeof line !== 'string') return undefined
  const formatList = FORMAT_COUNT_LINE.exec(line.trimEnd())?.[1]
  if (formatList === undefined) return undefined

  // `+` joins the formats merged into one output; `,` separates outputs
  // when more than one is requested. Either way each id is its own file.
  const ids = formatList
    .split(/[+,]/)
    .map(id => id.trim())
    .filter(id => id.length > 0)

  return ids.length > 0 ? ids.length : undefined
}

/** Same rule as `toQueueSnapshot`: clamped to 0-100, two decimals. */
function toPercent(downloaded: number, total: number): number {
  return (
    Math.round(Math.min(100, Math.max(0, (downloaded / total) * 100)) * 100) /
    100
  )
}

/**
 * Folds ticks into the wire snapshot: tracks `fileIndex` by `filename`
 * change, carries `fileCount` once seen, computes `percent` from bytes.
 */
export function createProgressReducer(): {
  /** Returns the next snapshot plus whether it should bypass the broadcast throttle. */
  next(line: string): { snapshot: VideoProgress; flush: boolean } | undefined
} {
  let fileCount: number | undefined
  let fileIndex = 0
  let previousFilename: string | undefined

  return {
    next(line) {
      const formatCount = parseYtdlpFormatCountLine(line)
      if (formatCount !== undefined) {
        fileCount = formatCount
        return undefined
      }

      const tick = parseYtdlpProgressLine(line)
      if (!tick) return undefined

      const isNewFile = tick.filename !== previousFilename
      if (isNewFile) {
        fileIndex += 1
        previousFilename = tick.filename
      }

      const finished = tick.status === 'finished'
      const { totalBytes } = tick

      const snapshot: VideoProgress = {
        downloadedBytes:
          finished && totalBytes !== undefined
            ? totalBytes
            : tick.downloadedBytes,
        fileIndex,
      }
      if (tick.etaSeconds !== undefined) snapshot.etaSeconds = tick.etaSeconds
      if (fileCount !== undefined) snapshot.fileCount = fileCount
      if (tick.fragmentCount !== undefined) {
        snapshot.fragmentCount = tick.fragmentCount
      }
      if (tick.fragmentIndex !== undefined) {
        snapshot.fragmentIndex = tick.fragmentIndex
      }
      if (totalBytes !== undefined) {
        snapshot.percent = finished
          ? 100
          : toPercent(tick.downloadedBytes, totalBytes)
      }
      if (tick.speedBps !== undefined) snapshot.speedBps = tick.speedBps
      if (totalBytes !== undefined) snapshot.totalBytes = totalBytes
      if (tick.totalIsEstimate) snapshot.totalIsEstimate = true

      const lastFileFinished =
        finished && (fileCount === undefined || fileIndex >= fileCount)

      return { snapshot, flush: isNewFile || lastFileFinished }
    },
  }
}
