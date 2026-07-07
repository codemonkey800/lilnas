'use client'

import { cns } from '@lilnas/utils/cns'
import { useEffect, useRef, useState } from 'react'

import type { LogLine } from 'src/logging/log-view.types'

// Right-docked drawer sizing. The panel now OVERLAYS the row grid (a backdrop
// sits behind it and closes the drawer on click) rather than reserving a
// right-hand column via page.tsx padding — so its width no longer has to stay
// in sync with any layout-reserving constant over in page.tsx, and it is free
// to be user-resizable. DEFAULT_WIDTH_PX preserves the previous fixed
// w-[28rem]; MIN/MAX bound the drag; MAX_WIDTH_FRACTION also caps it against
// the viewport so it can never swallow the whole screen on a narrow window.
const DEFAULT_WIDTH_PX = 448
const MIN_WIDTH_PX = 320
const MAX_WIDTH_PX = 720
const MAX_WIDTH_FRACTION = 0.9
const WIDTH_STORAGE_KEY = 'tdr-code:logs:detail-panel-width'

// Drives BOTH the CSS slide transition (duration-[200ms] below) and the
// presence hook's unmount timer — kept as one constant so the panel is never
// torn out of the DOM before its exit transition has finished, nor left
// lingering after it. If these two ever drift apart you get either a clipped
// slide-out or a frozen panel hanging after it should have gone.
const SLIDE_DURATION_MS = 200

// Selector for "things Tab should stop on" inside the panel — intentionally
// the same pragmatic subset log-row.tsx and every other interactive element
// in this app already uses, not an exhaustive a11y-spec selector. Queried
// fresh on every keydown (not memoized) because the copy button's
// "Copied"/pending label swap never adds or removes elements here today, but
// a future change to this panel's markup easily could, and re-querying is
// cheap for the handful of controls a detail panel has. The resize handle is
// deliberately NOT matched by this (it carries role="separator", no tabindex),
// so it never becomes a stop in the focus trap.
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

interface DrawerPresence {
  // Whether the drawer should be in the DOM at all. Stays true through the
  // exit slide (see the unmount timer below), so the panel can animate out
  // instead of vanishing the instant `line` goes null.
  mounted: boolean
  // The slide target: true == fully in (translate-x-0), false == fully out
  // (translate-x-full). Distinct from `mounted` precisely so the closing
  // frames (mounted && !open) can play the slide-out before unmount.
  open: boolean
  // The line to render. Follows `line` while open, but is RETAINED at its
  // last non-null value during the exit slide so the panel keeps showing the
  // line it's animating away from rather than blanking mid-transition.
  rendered: LogLine | null
}

// Presence + enter/exit-transition state machine, kept out of the component
// body so the (mount -> next-frame-open -> ... -> exit -> unmount) lifecycle
// reads as one unit. Dependency-free (no transition library): the enter uses
// a requestAnimationFrame flip and the exit uses a timeout matched to the CSS
// duration. Both effect branches return cleanups, which is what makes this
// safe under React StrictMode's dev double-invoke AND under a rapid
// open -> close -> reopen (the pending rAF / unmount timer is cancelled
// before the next transition is scheduled).
function useDrawerPresence(line: LogLine | null): DrawerPresence {
  const [mounted, setMounted] = useState(line !== null)
  const [open, setOpen] = useState(line !== null)
  const [rendered, setRendered] = useState<LogLine | null>(line)

  // Keyed on `line` ALONE and deliberately reads `open`/`mounted` from this
  // render's closure rather than the dependency array. React invokes the most
  // recent effect closure whenever a dep changes, so those reads always see
  // the latest committed values — they're used only to DECIDE whether a
  // transition needs staging, never to react to. Adding them to the deps
  // would re-fire this effect on the very setState calls it makes below and
  // schedule duplicate frames/timers, so exhaustive-deps is disabled (the
  // same pattern log-viewer.tsx uses for its own load-once effects). Both
  // branches return cleanups, so a rapid open -> close -> reopen (and React
  // StrictMode's dev double-invoke) cancels the pending frame/timer before
  // scheduling the next.
  useEffect(() => {
    if (line !== null) {
      setRendered(line)
      setMounted(true)
      // Already open (a line swap, or an initial mount that starts open) —
      // there is no closed -> open slide to stage.
      if (open) return
      // Flip to open on the NEXT frame, not synchronously: the panel must
      // first commit in its translate-x-full (off-screen) state, then move
      // to translate-x-0, or the browser has no "from" value to animate the
      // transition against and it snaps in with no slide.
      const raf = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(raf)
    }

    // Already closed and unmounted (e.g. the very first render with no
    // selection) — nothing to animate out, so don't schedule a timer.
    if (!mounted) return

    // Closing an open drawer: play the slide-out (open -> false), then drop
    // it from the DOM once the transition has had time to finish. `rendered`
    // is intentionally NOT cleared until here, so the panel keeps showing its
    // last line for the whole slide.
    setOpen(false)
    const timer = setTimeout(() => {
      setMounted(false)
      setRendered(null)
    }, SLIDE_DURATION_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line])

  return { mounted, open, rendered }
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

// The drawer SHELL: owns everything that makes the detail view a drawer
// rather than plain content — the click-to-close backdrop, the slide
// transition, drag-to-resize, and the focus trap / capture / restore. It
// renders the presentation-only LogDetailPanelContent inside.
//
// Overlays the row grid (fixed, above the sticky nav at z-30, backdrop at
// z-20) instead of reserving a column — page.tsx no longer pads for it. This
// deliberately reverses R13's original "keep timestamps/levels visible while
// reading a payload" side-dock decision in favour of an overlay drawer that
// closes on outside click; the drag-to-resize handle is the mitigation
// (widen the panel to read more of a payload without losing the row list for
// longer than a click).
//
// `key={rendered.byteOffset}` on the content forces React to tear down and
// recreate LogDetailPanelContent whenever the SELECTED line changes — which
// is what gives the inner component a fresh `useState('idle')` copy state for
// free on every line swap, without an effect to imperatively reset it. The
// SHELL itself stays mounted across swaps (only its `rendered` prop changes),
// so selecting a different row swaps the content in place with no slide — the
// slide is reserved for the genuine open (null -> line) and close
// (line -> null) transitions.
export function LogDetailPanel({
  line,
  stream,
  onClose,
  onFilterByLevel,
  onFilterByProcess,
  onFilterByEvent,
}: LogDetailPanelProps) {
  const { mounted, open, rendered } = useDrawerPresence(line)
  // Derived straight from the prop (not the hook's `open`, which lags by one
  // frame on enter) so focus capture/restore fires on the true selection
  // edge, the instant `line` flips, before any slide animation.
  const shouldBeOpen = line !== null

  const panelRef = useRef<HTMLDivElement>(null)
  // The element that had focus when the drawer opened (the clicked row) —
  // captured on the open edge, refocused on the close edge so keyboard focus
  // returns to where it was rather than falling to <body>.
  const triggerRef = useRef<HTMLElement | null>(null)

  const [width, setWidth] = useState(() => readStoredWidth())
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null)
  const [resizing, setResizing] = useState(false)

  // Capture the trigger on the open edge; restore focus to it on the close
  // edge. Keyed on the derived `shouldBeOpen` (not `rendered.byteOffset`), so
  // it fires ONLY on genuine open/close transitions — a line swap while open
  // leaves `shouldBeOpen` true and does not re-capture, so the eventual
  // restore still targets the row that first opened the drawer. Capturing
  // here (in an effect) rather than in an event handler works because nothing
  // moves focus between the row click and this commit; document.activeElement
  // is still the clicked row when this runs.
  useEffect(() => {
    if (shouldBeOpen) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    } else if (triggerRef.current) {
      triggerRef.current.focus()
      triggerRef.current = null
    }
  }, [shouldBeOpen])

  // Move focus INTO the panel on open and on every line swap. Keyed on
  // `rendered?.byteOffset` as well as `shouldBeOpen` because the inner
  // content remounts on a byteOffset change (see the `key` above), which
  // would otherwise drop focus to <body>; re-focusing the panel root keeps
  // focus inside the dialog. Lands on the root (tabIndex={-1}), not the first
  // button, so a screen reader announces the dialog before any action — the
  // focus trap's own `atRoot` branch handles Shift+Tab from here.
  useEffect(() => {
    if (shouldBeOpen) {
      panelRef.current?.focus()
    }
  }, [shouldBeOpen, rendered?.byteOffset])

  // Suppress text selection globally while a resize drag is in progress —
  // pointer capture keeps the move/up events on the handle, but a fast drag
  // can still paint a text selection across the rows behind the backdrop
  // without this.
  useEffect(() => {
    if (!resizing) return
    const previous = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.userSelect = previous
    }
  }, [resizing])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    // Focus trap: Tab/Shift+Tab cycle within the panel's own focusable
    // elements instead of escaping to the row list / rest of the page behind
    // it. Queried fresh on every keydown rather than cached once on open,
    // since the exact set of focusable elements is cheap to recompute and
    // this keeps the trap correct even if a future edit adds/removes a
    // focusable control conditionally.
    if (event.key === 'Tab' && panelRef.current) {
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      // Initial focus lands on the panel root itself (see the focus-in effect
      // above), not on `first` — deliberately, so a screen reader announces
      // the dialog before any specific action. That means Shift+Tab as the
      // very FIRST keystroke after open has `active === panelRef.current`,
      // which matches neither `first` nor `last` — without this extra check,
      // that keystroke would fall through to the browser's default
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

  function handleResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    resizeStartRef.current = { x: event.clientX, width }
    setResizing(true)
    // Pointer capture keeps move/up on this handle even when the drag crosses
    // over the backdrop. Wrapped because jsdom either lacks the method or
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
    // drag started) widens the panel; dragging right narrows it.
    setWidth(clampWidth(start.width + (start.x - event.clientX)))
  }

  function handleResizePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const start = resizeStartRef.current
    if (!start) return
    // Recompute the final width from THIS event rather than reading the
    // `width` state (which may be a render behind the last pointermove) so
    // the persisted value is exactly what the panel ends at.
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

  // Not in the DOM while fully closed (and after the exit slide finishes) —
  // the `rendered === null` half is a type guard for the content below as
  // much as a runtime one.
  if (!mounted || rendered === null) {
    return null
  }

  return (
    <>
      {/*
        Backdrop: a full-viewport click target that closes the drawer on any
        click outside the panel (which sits above it at z-30). This is the
        ONE element handling both "click the overlay" and "click outside the
        sidebar" — a click inside the panel never reaches here (siblings don't
        receive each other's bubbled events). aria-hidden because it's a
        purely decorative scrim; Escape and the Close button are the
        keyboard/AT-visible dismissals.
      */}
      <div
        aria-hidden
        data-track-id="log-detail-overlay"
        onClick={onClose}
        className={cns(
          'fixed inset-0 z-20 bg-black/40 transition-opacity duration-[200ms] motion-reduce:transition-none',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Log entry detail"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        data-track-id="log-detail-panel"
        data-state={open ? 'open' : 'closed'}
        style={{ width: `${width}px` }}
        className={cns(
          'fixed top-0 right-0 z-30 flex h-full flex-col border-l border-gray-800 bg-gray-950 shadow-xl',
          'transition-transform duration-[200ms] ease-out motion-reduce:transition-none',
          open ? 'translate-x-0' : 'translate-x-full',
          // No transform transition mid-drag (the width is changing, not the
          // slide) and no accidental text selection while dragging.
          resizing && 'transition-none select-none',
        )}
      >
        {/*
          Resize handle straddling the panel's left edge (w-2, pulled half its
          width outside via -translate-x-1/2, so the ~8px hit area sits over
          the border). role="separator" conveys the resize affordance; it has
          no tabindex, so FOCUSABLE_SELECTOR skips it and it never becomes a
          stop in the focus trap. Pointer capture (set on pointerdown) routes
          move/up back here even when the pointer is dragged over the backdrop,
          so a drag that ends outside the panel resizes rather than closing.
        */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          data-track-id="log-detail-resize-handle"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          className="absolute top-0 left-0 z-10 h-full w-2 -translate-x-1/2 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-gray-700/60"
        />

        <LogDetailPanelContent
          key={rendered.byteOffset}
          line={rendered}
          stream={stream}
          onClose={onClose}
          onFilterByLevel={onFilterByLevel}
          onFilterByProcess={onFilterByProcess}
          onFilterByEvent={onFilterByEvent}
        />
      </div>
    </>
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
            onClick={onClose}
            aria-label="Close"
            className="rounded px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-900 hover:text-gray-200"
          >
            Close
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
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
            className="mb-3 flex flex-wrap items-center gap-2 border-b border-gray-800 pb-3 text-xs"
          >
            <span className="shrink-0 text-gray-500">Filter:</span>
            {filterableLevel !== null && onFilterByLevel && (
              <button
                type="button"
                data-track-id="log-detail-panel-filter-by-level"
                onClick={() => onFilterByLevel(filterableLevel)}
                className="rounded bg-gray-800 px-2 py-1 text-gray-300 transition-colors hover:bg-gray-700"
              >
                level ≥ {levelLabel(filterableLevel)}
              </button>
            )}
            {filterableProcess !== null && onFilterByProcess && (
              <button
                type="button"
                data-track-id="log-detail-panel-filter-by-process"
                onClick={() => onFilterByProcess(filterableProcess)}
                className="rounded bg-gray-800 px-2 py-1 text-gray-300 transition-colors hover:bg-gray-700"
              >
                process={filterableProcess}
              </button>
            )}
            {filterableEvent !== null && onFilterByEvent && (
              <button
                type="button"
                data-track-id="log-detail-panel-filter-by-event"
                onClick={() => onFilterByEvent(filterableEvent)}
                className="rounded bg-gray-800 px-2 py-1 text-gray-300 transition-colors hover:bg-gray-700"
              >
                event={filterableEvent}
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
    </>
  )
}
