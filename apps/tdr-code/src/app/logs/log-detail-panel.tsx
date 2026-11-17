'use client'

import { Button, Sheet } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { useEffect, useRef, useState } from 'react'

import type { LogLine } from 'src/logging/log-view.types'

// Right-docked sheet sizing. The sheet OVERLAYS the row grid (its scrim closes
// it on outside click) rather than reserving a right-hand column, so it is
// free to be user-resizable. DEFAULT_WIDTH_PX preserves the previous fixed
// w-[28rem]; MIN/MAX bound the drag; MAX_WIDTH_FRACTION also caps it against
// the viewport so it can never swallow the whole screen on a narrow window.
// On a phone the popup's own `maxWidth: 100%` takes over and the sheet is
// full width, whatever width was dragged or persisted.
const DEFAULT_WIDTH_PX = 448
const MIN_WIDTH_PX = 320
const MAX_WIDTH_PX = 720
const MAX_WIDTH_FRACTION = 0.9
const WIDTH_STORAGE_KEY = 'tdr-code:logs:detail-panel-width'

const COPIED_RESET_MS = 1800

type ClipboardState = 'idle' | 'copied' | 'unavailable'

// U12: the SAME TRACE/DEBUG/INFO/WARN/ERROR/FATAL naming log-row.tsx's own
// (unexported) LEVEL_LABELS establishes for the row display and log-filters
// .tsx's own level <select> reuses — duplicated locally rather than
// imported, for the identical reason formatUtcTimestamp below is duplicated
// rather than imported: a small lookup neither file owns more than the
// other, matching this file's own established "don't couple to a sibling
// component module for a one-off detail" convention.
const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

function levelLabel(level: number): string {
  return LEVEL_LABELS[level] ?? String(level)
}

// `time` is epoch-ms (same convention as log-row.tsx's formatUtcTitle).
// Duplicated locally rather than imported from log-row.tsx: it's a two-line
// helper, and importing it would make this file depend on a sibling
// component module for a one-off formatting detail neither owns more than
// the other.
function formatUtcTimestamp(time: unknown): string | null {
  if (typeof time !== 'number' || !Number.isFinite(time)) return null
  return `${new Date(time).toISOString()} UTC`
}

// Hand-rolled, dependency-free JSON tokenizer — good enough for pino-shaped
// JSON (flat-ish objects, string/number/boolean/null values), not a
// general-purpose highlighter. Splits the already-pretty-printed text into
// {text, className} tokens by scanning character-by-character rather than
// via a single combined regex, so punctuation/whitespace/structure all fall
// out of the same loop instead of needing a separate "everything else"
// branch to reassemble spacing/indentation exactly.
interface HighlightToken {
  text: string
  className?: string
}

function tokenizeJson(pretty: string): HighlightToken[] {
  const tokens: HighlightToken[] = []
  let i = 0

  function pushPlain(text: string) {
    if (text.length === 0) return
    const last = tokens[tokens.length - 1]
    if (last && last.className === undefined) {
      last.text += text
    } else {
      tokens.push({ text })
    }
  }

  while (i < pretty.length) {
    const ch = pretty[i]

    if (ch === '"') {
      // Scan to the matching unescaped quote. A run of JSON.stringify output
      // never contains a literal newline inside a string, so this cannot
      // runaway past the intended token.
      let j = i + 1
      while (j < pretty.length) {
        if (pretty[j] === '\\') {
          j += 2
          continue
        }
        if (pretty[j] === '"') {
          j += 1
          break
        }
        j += 1
      }
      const rawToken = pretty.slice(i, j)
      // A string token is a KEY if, after optional whitespace, the next
      // non-space character is a colon — otherwise it's a value.
      let k = j
      while (k < pretty.length && (pretty[k] === ' ' || pretty[k] === '\n')) {
        k += 1
      }
      const isKey = pretty[k] === ':'
      tokens.push({
        text: rawToken,
        className: isKey ? 'text-accent-hi' : 'text-ok',
      })
      i = j
      continue
    }

    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i
      if (pretty[j] === '-') j += 1
      while (j < pretty.length && /[0-9.eE+-]/.test(pretty[j])) {
        j += 1
      }
      tokens.push({ text: pretty.slice(i, j), className: 'text-ink' })
      i = j
      continue
    }

    if (pretty.startsWith('true', i) || pretty.startsWith('false', i)) {
      const word = pretty.startsWith('true', i) ? 'true' : 'false'
      tokens.push({ text: word, className: 'text-ink' })
      i += word.length
      continue
    }

    if (pretty.startsWith('null', i)) {
      tokens.push({ text: 'null', className: 'text-ink' })
      i += 4
      continue
    }

    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ':') {
      tokens.push({ text: ch, className: 'text-ink-2' })
      i += 1
      continue
    }

    pushPlain(ch)
    i += 1
  }

  return tokens
}

function HighlightedJson({ text }: { text: string }) {
  const tokens = tokenizeJson(text)
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} className={token.className}>
          {token.text}
        </span>
      ))}
    </>
  )
}

// Clamp a candidate width to [MIN_WIDTH_PX, min(MAX_WIDTH_PX, 90% viewport)].
// The viewport cap is recomputed on every call (never cached) so a persisted
// width read on a wide monitor can't force an oversized panel after the
// window shrinks — the next drag (or the initial read below) re-clamps it.
function clampWidth(px: number): number {
  const viewportCap =
    typeof window !== 'undefined'
      ? window.innerWidth * MAX_WIDTH_FRACTION
      : MAX_WIDTH_PX
  const max = Math.min(MAX_WIDTH_PX, viewportCap)
  return Math.max(MIN_WIDTH_PX, Math.min(px, max))
}

// Seeds the panel width from localStorage, falling back to the default when
// nothing valid is stored (or when running server-side, where there is no
// window/localStorage). Safe to call from a useState initializer: the panel
// is never server-rendered with content (the drawer only mounts once a line
// is selected, which is a client-only interaction — see LogDetailPanel's
// `mounted` gate), so there is no hydration mismatch to worry about here.
function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH_PX
  const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY)
  const parsed = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_WIDTH_PX
}

function storeWidth(px: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(px))
  } catch {
    // Storage can throw (private mode, quota) — persistence is a nicety, not
    // load-bearing, so a failure here just means the width won't survive a
    // reload, never a crash.
  }
}

export interface LogDetailPanelProps {
  line: LogLine | null
  stream: string
  onClose: () => void
  // U12: the deferred "filter by this field/value" actions (completing
  // R13's Phase 1 read-only half — see this file's own former "Phase 2
  // seam" comment below, now replaced with the real wiring). Each callback
  // is fired with THIS line's own value for that field. All three are
  // optional and default to not rendering the corresponding action — a
  // pre-U12 caller that never passes any of them keeps compiling and
  // rendering exactly as before (no action row at all), matching this
  // codebase's own established "additive, backward-compatible prop"
  // convention (e.g. LogViewer's own isActive/filters props).
  onFilterByLevel?: (level: number) => void
  onFilterByProcess?: (process: string) => void
  onFilterByEvent?: (eventSlug: string) => void
}

// The sheet SHELL: `Sheet side="right"` (a Base UI dialog) supplies the scrim,
// the slide, Escape / outside-press dismissal, the focus trap and focus
// restore; this adds the drag-to-resize handle and the retained line.
//
// `rendered` follows `line` while one is selected and keeps its last value
// while the sheet slides out, so the popup doesn't blank mid-exit; the
// popup unmounts itself once the exit transition ends.
//
// `key={rendered.byteOffset}` on the content forces React to tear down and
// recreate LogDetailPanelContent whenever the SELECTED line changes — which
// is what gives the inner component a fresh `useState('idle')` copy state for
// free on every line swap, without an effect to imperatively reset it. The
// sheet itself stays open across swaps, so selecting a different row swaps
// the content in place with no slide.
export function LogDetailPanel({
  line,
  stream,
  onClose,
  onFilterByLevel,
  onFilterByProcess,
  onFilterByEvent,
}: LogDetailPanelProps) {
  const [rendered, setRendered] = useState<LogLine | null>(line)
  if (line !== null && line !== rendered) setRendered(line)

  const [width, setWidth] = useState(() => readStoredWidth())
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null)
  const [resizing, setResizing] = useState(false)

  // Suppress text selection globally while a resize drag is in progress —
  // pointer capture keeps the move/up events on the handle, but a fast drag
  // can still paint a text selection across the rows behind the scrim
  // without this.
  useEffect(() => {
    if (!resizing) return
    const previous = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.userSelect = previous
    }
  }, [resizing])

  function handleResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    resizeStartRef.current = { x: event.clientX, width }
    setResizing(true)
    // Pointer capture keeps move/up on this handle even when the drag crosses
    // over the scrim. Wrapped because jsdom either lacks the method or
    // throws on a pointer id it isn't tracking — capture is a nicety, not
    // load-bearing (fireEvent in tests dispatches straight to the handle).
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // ignore — unsupported / untracked pointer id
    }
  }

  function handleResizePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = resizeStartRef.current
    if (!start) return
    // Docked to the right, so dragging LEFT (a smaller clientX than where the
    // drag started) widens the sheet; dragging right narrows it.
    setWidth(clampWidth(start.width + (start.x - event.clientX)))
  }

  function handleResizePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const start = resizeStartRef.current
    if (!start) return
    // Recompute the final width from THIS event rather than reading the
    // `width` state (which may be a render behind the last pointermove) so
    // the persisted value is exactly what the sheet ends at.
    const final = clampWidth(start.width + (start.x - event.clientX))
    resizeStartRef.current = null
    setResizing(false)
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    } catch {
      // ignore — unsupported / untracked pointer id (see pointerdown)
    }
    setWidth(final)
    storeWidth(final)
  }

  return (
    <Sheet.Root
      open={line !== null}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <Sheet.Popup
        side="right"
        aria-label="Log entry detail"
        data-track-id="log-detail-panel"
        // The width is inline (not a class) because it is user-dragged state;
        // `maxWidth: 100%` overrides the Sheet's 480px cap so a wide sheet
        // can reach 720px, and still pins it to the viewport on a phone.
        style={{ width: `${width}px`, maxWidth: '100%' }}
        className={cns('gap-3', resizing && 'select-none')}
      >
        {/*
          Resize handle on the sheet's left edge, inside the popup (its
          `overflow` would clip a handle pulled outside). role="separator"
          conveys the resize affordance; it has no tabindex, so it is never a
          stop in the focus trap. Pointer capture (set on pointerdown) routes
          move/up back here even when the pointer is dragged over the scrim,
          so a drag that ends outside the sheet resizes rather than closing.
          Hidden on a phone, where the sheet is full width.
        */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          data-track-id="log-detail-resize-handle"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          className="absolute top-0 left-0 z-10 h-full w-2 cursor-col-resize touch-none bg-transparent transition-colors duration-200 ease-standard hover:bg-line-loud max-md:hidden"
        />

        {rendered && (
          <LogDetailPanelContent
            key={rendered.byteOffset}
            line={rendered}
            stream={stream}
            onClose={onClose}
            onFilterByLevel={onFilterByLevel}
            onFilterByProcess={onFilterByProcess}
            onFilterByEvent={onFilterByEvent}
          />
        )}
      </Sheet.Popup>
    </Sheet.Root>
  )
}

// Presentation-only: the header (process/timestamp + copy/close), the
// "filter by this field" action row, and the highlighted payload body. Owns
// nothing about being a drawer — no positioning, no focus trap, no
// dismissal wiring beyond forwarding onClose to its own buttons. The shell
// (LogDetailPanel) provides the fixed/animated container this renders into,
// and remounts this whole component (via `key`) on every line change, which
// is what resets the copy affordance's `useState('idle')` for free.
function LogDetailPanelContent({
  line,
  stream,
  onClose,
  onFilterByLevel,
  onFilterByProcess,
  onFilterByEvent,
}: {
  line: LogLine
  stream: string
  onClose: () => void
  onFilterByLevel?: (level: number) => void
  onFilterByProcess?: (process: string) => void
  onFilterByEvent?: (eventSlug: string) => void
}) {
  const [clipboardState, setClipboardState] = useState<ClipboardState>('idle')
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    },
    [],
  )

  const { parsed, raw } = line
  const displayText = parsed === null ? raw : JSON.stringify(parsed, null, 2)
  const timestamp = parsed !== null ? formatUtcTimestamp(parsed.time) : null
  const processLabel =
    parsed !== null && typeof parsed.process === 'string'
      ? parsed.process
      : stream

  // U12 (R13, filter-actions half): guarded field reads for the "filter by
  // this field/value" actions below — `null` both when `parsed` itself is
  // null (a malformed line, R14: nothing structured to filter by at all)
  // and when this SPECIFIC line simply doesn't carry that field (e.g. a
  // valid `debug` line legitimately has no `event` — see the structured-
  // logging convention's own level-semantics table; that is a normal
  // state, not malformed, and correctly produces no "filter by event"
  // action rather than one that would filter by `undefined`).
  const filterableLevel =
    parsed !== null && typeof parsed.level === 'number' ? parsed.level : null
  const filterableProcess =
    parsed !== null && typeof parsed.process === 'string'
      ? parsed.process
      : null
  const filterableEvent =
    parsed !== null && typeof parsed.event === 'string' ? parsed.event : null

  async function handleCopy() {
    if (!navigator.clipboard?.writeText) {
      setClipboardState('unavailable')
      return
    }
    try {
      await navigator.clipboard.writeText(displayText)
      setClipboardState('copied')
    } catch {
      setClipboardState('unavailable')
      return
    }
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    resetTimerRef.current = setTimeout(
      () => setClipboardState('idle'),
      COPIED_RESET_MS,
    )
  }

  const copyLabel =
    clipboardState === 'copied'
      ? 'Copied'
      : clipboardState === 'unavailable'
        ? 'Copy unavailable'
        : 'Copy'

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line pb-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium text-ink">
            {processLabel}
          </p>
          {timestamp && (
            <p className="truncate font-mono text-mono-sm text-ink-3">
              {timestamp}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            className={cns(
              clipboardState === 'copied' && 'text-ok! hover:text-ok!',
            )}
            data-track-id="log-detail-panel-copy"
            icon={clipboardState === 'copied' ? 'check' : undefined}
            onClick={() => void handleCopy()}
            size="sm"
            variant={clipboardState === 'unavailable' ? 'outline' : 'ghost'}
            aria-disabled={clipboardState === 'unavailable' || undefined}
          >
            {copyLabel}
          </Button>
          <Button
            aria-label="Close"
            data-track-id="log-detail-panel-close"
            icon="x"
            onClick={onClose}
            size="sm"
            variant="ghost"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {/*
          U12 (R13, filter-actions half): rendered ONLY when at least one
          guarded field value AND its corresponding callback are both present
          — a malformed line (parsed === null) has every filterable* value
          null, so this entire row correctly disappears rather than rendering
          a row of dead/no-op buttons. Each button's own value comes straight
          from THIS line's parsed field, never a placeholder.
        */}
        {(filterableLevel !== null && onFilterByLevel) ||
        (filterableProcess !== null && onFilterByProcess) ||
        (filterableEvent !== null && onFilterByEvent) ? (
          <div
            data-track-id="log-detail-panel-filter-actions"
            className="flex flex-wrap items-center gap-2 border-b border-line pb-3"
          >
            <span className="shrink-0 text-cap text-ink-3">Filter</span>
            {filterableLevel !== null && onFilterByLevel && (
              <Button
                className="font-mono"
                data-track-id="log-detail-panel-filter-by-level"
                onClick={() => onFilterByLevel(filterableLevel)}
                size="sm"
                variant="outline"
              >
                level ≥ {levelLabel(filterableLevel)}
              </Button>
            )}
            {filterableProcess !== null && onFilterByProcess && (
              <Button
                className="font-mono"
                data-track-id="log-detail-panel-filter-by-process"
                onClick={() => onFilterByProcess(filterableProcess)}
                size="sm"
                variant="outline"
              >
                process={filterableProcess}
              </Button>
            )}
            {filterableEvent !== null && onFilterByEvent && (
              <Button
                className="font-mono"
                data-track-id="log-detail-panel-filter-by-event"
                onClick={() => onFilterByEvent(filterableEvent)}
                size="sm"
                variant="outline"
              >
                event={filterableEvent}
              </Button>
            )}
          </div>
        ) : null}
        <pre
          className={cns(
            'font-mono text-mono-sm leading-relaxed break-words whitespace-pre-wrap',
            parsed === null ? 'text-ink' : 'text-ink-2',
          )}
        >
          {parsed === null ? (
            displayText
          ) : (
            <HighlightedJson text={displayText} />
          )}
        </pre>
      </div>
    </>
  )
}
