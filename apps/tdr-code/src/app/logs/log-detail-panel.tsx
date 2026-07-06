'use client'

import { cns } from '@lilnas/utils/cns'
import { useEffect, useRef, useState } from 'react'

import type { LogLine } from 'src/logging/log-view.types'

// Right-docked panel width — the row grid narrows to make room rather than
// this panel overlaying it (R13: timestamps/levels stay visible while
// reading a payload). Not exported: nothing outside this file needs it,
// unlike ROW_PX in log-row.tsx which the virtualizer's row-height math
// depends on.
const PANEL_WIDTH = 'w-[28rem]'

// Selector for "things Tab should stop on" inside the panel — intentionally
// the same pragmatic subset log-row.tsx and every other interactive element
// in this app already uses, not an exhaustive a11y-spec selector. Queried
// fresh on every keydown (not memoized) because the copy button's
// "Copied"/pending label swap never adds or removes elements here today, but
// a future change to this panel's markup easily could, and re-querying is
// cheap for the handful of controls a detail panel has.
const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

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
        className: isKey ? 'text-sky-400' : 'text-emerald-400',
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
      tokens.push({ text: pretty.slice(i, j), className: 'text-amber-400' })
      i = j
      continue
    }

    if (pretty.startsWith('true', i) || pretty.startsWith('false', i)) {
      const word = pretty.startsWith('true', i) ? 'true' : 'false'
      tokens.push({ text: word, className: 'text-purple-400' })
      i += word.length
      continue
    }

    if (pretty.startsWith('null', i)) {
      tokens.push({ text: 'null', className: 'text-gray-500' })
      i += 4
      continue
    }

    if (ch === '{' || ch === '}' || ch === '[' || ch === ']' || ch === ':') {
      tokens.push({ text: ch, className: 'text-gray-500' })
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

// Design note on layout expectation for the (not-yet-built) host: this
// component null-renders when `line` is null and takes no layout space —
// the host is expected to render it conditionally (`{selectedLine && ... }`
// style is NOT required since this component already guards internally, so
// the host can render <LogDetailPanel line={selected} .../> unconditionally
// and rely on this component's own null-check), not keep it always-mounted
// and width-animate to 0. Conditional rendering also means the fixed-width
// column reserved by `fixed right-0` never exists in the DOM while closed,
// so there is no residual layout to clean up.
//
// This wrapper's only job is the null-check and the remount boundary: `key
// ={line.byteOffset}` forces React to tear down and recreate
// LogDetailPanelContent whenever the selected line changes (including while
// already open — "select a different row" is a byteOffset change), which is
// what gives the inner component a fresh `useState('idle')` for free instead
// of needing an effect to imperatively reset copy-affordance state on every
// line swap (React's own effects lint rule flags synchronous setState calls
// inside an effect body as cascading-render-prone — remounting sidesteps
// that entirely rather than suppressing the rule).
export function LogDetailPanel({
  line,
  stream,
  onClose,
  onFilterByLevel,
  onFilterByProcess,
  onFilterByEvent,
}: LogDetailPanelProps) {
  if (line === null) {
    return null
  }

  return (
    <LogDetailPanelContent
      key={line.byteOffset}
      line={line}
      stream={stream}
      onClose={onClose}
      onFilterByLevel={onFilterByLevel}
      onFilterByProcess={onFilterByProcess}
      onFilterByEvent={onFilterByEvent}
    />
  )
}

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
  const panelRef = useRef<HTMLDivElement>(null)
  const [clipboardState, setClipboardState] = useState<ClipboardState>('idle')
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus-capture/restore design: this panel doesn't know which row element
  // triggered it (U5's host component tree doesn't exist yet, per the unit
  // brief), so instead of requiring the caller to pass a ref/element to
  // refocus, the panel captures `document.activeElement` on mount — the
  // moment it (this specific line's content) becomes visible. That element
  // (whatever row button was focused/clicked to select this line) is
  // exactly what should regain focus when this line's panel goes away. This
  // makes the panel self-contained: any future host can render
  // `<LogDetailPanel line={selected} .../>` with zero extra wiring and
  // focus-restore still works correctly — including "select a different row
  // while the panel is already open," because the `key={byteOffset}` remount
  // above means a NEW LogDetailPanelContent instance mounts for the new
  // line and captures whatever was active at THAT moment (which, per this
  // app's LogRow, is the just-clicked new row), while the OLD instance's
  // unmount-time cleanup below fires first and restores focus to what was
  // active before the map/click chain — not a stale point from the very
  // first open.
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )

  useEffect(() => {
    // Move focus into the panel itself (the root container, which is
    // tabIndex={-1} + focusable programmatically). Runs after mount so the
    // panel's DOM already exists to receive focus.
    panelRef.current?.focus()

    // Snapshot the ref's value now rather than reading `.current` inside the
    // cleanup below — `previouslyFocusedRef` is only ever written once (in
    // the useState initializer above) for this component instance's whole
    // lifetime, so this isn't guarding against a value that could change,
    // just satisfying the exhaustive-deps rule's general "ref.current may
    // have moved on by cleanup time" concern.
    const elementToRestore = previouslyFocusedRef.current

    return () => {
      // Restore focus to whatever was active right before this line's
      // content mounted — covers both a real close (onClose) and this
      // instance unmounting because `key` changed (a different line was
      // selected).
      elementToRestore?.focus()
    }
  }, [])

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

  function handleClose() {
    onClose()
  }

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

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleClose()
      return
    }

    // Focus trap: Tab/Shift+Tab cycle within the panel's own focusable
    // elements instead of escaping to the row list / rest of the page
    // behind it. Queried fresh on every keydown rather than cached once on
    // open, since the exact set of focusable elements is cheap to
    // recompute and this keeps the trap correct even if a future edit to
    // this panel adds/removes a focusable control conditionally.
    if (event.key === 'Tab' && panelRef.current) {
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      // Initial focus lands on the panel root itself (see the mount effect
      // below), not on `first` — deliberately, so a screen reader announces
      // the dialog before any specific action. That means Shift+Tab as the
      // very FIRST keystroke after open has `active === panelRef.current`,
      // which matches neither `first` nor `last` below — without this extra
      // check, that keystroke would fall through to the browser's default
      // backward-tab behavior and escape the trap before it ever engages.
      // Forward Tab from the root needs no equivalent check: the default
      // behavior already lands on `first`, which is what we want anyway.
      const atRoot = active === panelRef.current

      if (event.shiftKey && (active === first || atRoot)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  const copyLabel =
    clipboardState === 'copied'
      ? 'Copied'
      : clipboardState === 'unavailable'
        ? 'Copy unavailable'
        : 'Copy'

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Log entry detail"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-track-id="log-detail-panel"
      className={cns(
        'fixed top-0 right-0 z-20 flex h-full flex-col border-l border-gray-800 bg-gray-950 shadow-xl',
        PANEL_WIDTH,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-200">
            {processLabel}
          </p>
          {timestamp && (
            <p className="truncate text-xs text-gray-500">{timestamp}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-track-id="log-detail-panel-copy"
            onClick={() => void handleCopy()}
            className={cns(
              'rounded px-2 py-1 text-xs transition-colors',
              clipboardState === 'copied'
                ? 'text-green-400'
                : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200',
            )}
          >
            {copyLabel}
          </button>
          <button
            type="button"
            data-track-id="log-detail-panel-close"
            onClick={handleClose}
            aria-label="Close"
            className="rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-900 hover:text-gray-200"
          >
            Close
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/*
          U12 (R13, filter-actions half): replaces the Phase 1 "Phase 2
          seam" comment this file used to carry here — the filter model
          (log-viewer.tsx's isFilteredProjection/composedPredicate, fed by
          page.tsx's own lifted filtersByStream state) now exists, so these
          actions are real. Rendered ONLY when at least one guarded field
          value AND its corresponding callback are both present — a
          malformed line (parsed === null) has every filterable* value
          null, so this entire row correctly disappears rather than
          rendering a row of dead/no-op buttons (per this unit's own brief:
          "disabled/hidden," not merely visually de-emphasized). Each
          button's own value comes straight from THIS line's parsed field,
          never a placeholder — clicking "Filter by level >= WARN" always
          filters by the value that line actually carries.
        */}
        {(filterableLevel !== null && onFilterByLevel) ||
        (filterableProcess !== null && onFilterByProcess) ||
        (filterableEvent !== null && onFilterByEvent) ? (
          <div
            data-track-id="log-detail-panel-filter-actions"
            className="mb-3 flex flex-wrap items-center gap-2 border-b border-gray-800 pb-3 text-xs"
          >
            {filterableLevel !== null && onFilterByLevel && (
              <button
                type="button"
                data-track-id="log-detail-panel-filter-by-level"
                onClick={() => onFilterByLevel(filterableLevel)}
                className="rounded bg-gray-800 px-2 py-1 text-gray-300 transition-colors hover:bg-gray-700"
              >
                Filter by level ≥ {levelLabel(filterableLevel)}
              </button>
            )}
            {filterableProcess !== null && onFilterByProcess && (
              <button
                type="button"
                data-track-id="log-detail-panel-filter-by-process"
                onClick={() => onFilterByProcess(filterableProcess)}
                className="rounded bg-gray-800 px-2 py-1 text-gray-300 transition-colors hover:bg-gray-700"
              >
                Filter by process={filterableProcess}
              </button>
            )}
            {filterableEvent !== null && onFilterByEvent && (
              <button
                type="button"
                data-track-id="log-detail-panel-filter-by-event"
                onClick={() => onFilterByEvent(filterableEvent)}
                className="rounded bg-gray-800 px-2 py-1 text-gray-300 transition-colors hover:bg-gray-700"
              >
                Filter by event={filterableEvent}
              </button>
            )}
          </div>
        ) : null}
        <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-gray-300">
          {parsed === null ? (
            displayText
          ) : (
            <HighlightedJson text={displayText} />
          )}
        </pre>
      </div>
    </div>
  )
}
