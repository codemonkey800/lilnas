import { formatRuntime, UNKNOWN_VALUE } from 'src/lib/format'

/**
 * Everything the in-app player decides, kept in a module of its own rather
 * than inside `video-player.tsx`.
 *
 * Two reasons, the same two every other pure module in this directory was
 * split out for:
 *
 * 1. `video-player.tsx` is `'use client'`, so none of its exports can be
 *    called from a server component.
 * 2. jsdom implements no media playback at all - `play()` is a stub,
 *    `duration` is `NaN` forever, `requestFullscreen` does not exist - so
 *    logic left inside the component is logic that cannot be tested. Every
 *    decision the player makes therefore lives here, behind structural
 *    parameter types (`MediaElementLike`, `FullscreenDocumentLike`) that a
 *    plain object literal satisfies, and the component is the thin wiring
 *    that hands those functions a real element.
 */

/**
 * What the elapsed readout shows when playback has not started.
 *
 * ⚠️ `formatRuntime(0, 'clock')` returns {@link UNKNOWN_VALUE}, which is
 * correct for a detail page's runtime - upstream reports `0` for a title
 * whose runtime it does not know, and `0m` would read as a fact rather than
 * a gap - and wrong for a player sitting at the start of a file it has
 * already loaded. `0:00` there is a fact. The two cases are split across
 * {@link formatElapsed} and {@link formatDuration} rather than papered over,
 * and `src/lib/format.ts` is left alone.
 */
export const ELAPSED_ZERO = '0:00'

/**
 * The elapsed side of the readout.
 *
 * Floored, not rounded, which is what every player does: `0:30.6` is still
 * `0:30`, because a readout that rounds up shows the next second early and
 * shows the whole duration a half-second before the video ends.
 */
export function formatElapsed(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return ELAPSED_ZERO
  }

  const whole = Math.floor(seconds)

  // Also the guard that keeps `formatRuntime`'s em dash out: anything that
  // floors to zero or below is the start of the file, not an unknown.
  return whole <= 0 ? ELAPSED_ZERO : formatRuntime(whole, 'clock')
}

/**
 * The total side of the readout.
 *
 * Here {@link UNKNOWN_VALUE} *is* right, and is deliberately reached through
 * `formatRuntime`: before `loadedmetadata` the element reports `NaN`, and a
 * file the browser cannot measure (a live stream, a truncated download)
 * reports `Infinity` or `0`. All of those are genuinely "unknown", and the em
 * dash is what the rest of the app renders for one.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return UNKNOWN_VALUE
  }

  return formatRuntime(Math.floor(seconds), 'clock')
}

/** The bar's visible readout: `5:20 / 14:02`. */
export function formatTimecode(
  currentTime: number | null | undefined,
  duration: number | null | undefined,
): string {
  return `${formatElapsed(currentTime)} / ${formatDuration(duration)}`
}

/**
 * The seek bar's `aria-valuetext`.
 *
 * Without it a screen reader announces the raw percentage, which is the one
 * number nobody watching a video wants. `of` rather than the readout's slash
 * because this one is spoken.
 */
export function seekValueText(
  currentTime: number | null | undefined,
  duration: number | null | undefined,
): string {
  return `${formatElapsed(currentTime)} of ${formatDuration(duration)}`
}

/** How far one arrow press moves playback. */
export const SEEK_STEP_SECONDS = 5

/**
 * The slice of a media element this module reads.
 *
 * Structural rather than `HTMLMediaElement` so the unit tests - which run in
 * the `node` Jest project, where there is no DOM at all - can pass an object
 * literal.
 */
export type MediaElementLike = {
  currentTime: number
  duration: number
  muted: boolean
  paused: boolean
  volume: number
}

/** The player's view of the element, as of the last event it fired. */
export type MediaSnapshot = MediaElementLike

/**
 * The snapshot before anything has loaded, and the server snapshot.
 *
 * A single frozen object rather than a factory: `useSyncExternalStore`
 * compares snapshots by identity, so the server render and the hydrating
 * render have to return the *same* object or React re-renders immediately.
 */
export const MEDIA_SNAPSHOT_INITIAL: MediaSnapshot = Object.freeze({
  currentTime: 0,
  duration: 0,
  muted: false,
  paused: true,
  volume: 1,
})

/**
 * The element events that can change anything in a {@link MediaSnapshot}.
 *
 * `emptied` and `ended` are in the list even though neither changes a field
 * on its own, because both land the element in a state the bar has to repaint
 * for: a swapped `src` resets the duration, and the end of a file leaves
 * `paused` true with the play glyph needing to come back.
 */
export const MEDIA_EVENTS = [
  'durationchange',
  'emptied',
  'ended',
  'loadedmetadata',
  'pause',
  'play',
  'playing',
  'seeked',
  'seeking',
  'timeupdate',
  'volumechange',
] as const

/**
 * Reads an element into a snapshot, normalising the two fields that arrive
 * non-finite. `duration` is `NaN` until metadata loads and `Infinity` for a
 * stream; both collapse to `0`, which every consumer here already treats as
 * "unknown" - and which, unlike `NaN`, compares equal to itself, so
 * {@link sameMediaSnapshot} can skip the re-render.
 */
export function readMediaSnapshot(
  element: MediaElementLike | null | undefined,
): MediaSnapshot {
  if (!element) {
    return MEDIA_SNAPSHOT_INITIAL
  }

  return {
    currentTime: Number.isFinite(element.currentTime) ? element.currentTime : 0,
    duration: Number.isFinite(element.duration) ? element.duration : 0,
    muted: element.muted,
    paused: element.paused,
    volume: element.volume,
  }
}

/**
 * Whether two snapshots would render identically.
 *
 * `timeupdate` fires four or five times a second and `seeking`/`seeked`
 * bracket every drag, so without this the bar re-renders on events that
 * changed nothing.
 */
export function sameMediaSnapshot(a: MediaSnapshot, b: MediaSnapshot): boolean {
  return (
    a.currentTime === b.currentTime &&
    a.duration === b.duration &&
    a.muted === b.muted &&
    a.paused === b.paused &&
    a.volume === b.volume
  )
}

/** The scrubber's range, shared with the `<input type="range">` that drives it. */
export const PCT_MIN = 0
export const PCT_MAX = 100

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * How much of the file has played, 0-100.
 *
 * The scrubber is expressed as a percentage rather than as seconds because
 * that is what the mockup's slider is (`aria-valuemin=0`,
 * `aria-valuemax=100`), and because a range input needs a usable `max` before
 * the duration is known - `max={0}` is a degenerate control, `max={100}` is
 * not.
 */
export function playedPct(snapshot: {
  currentTime: number
  duration: number
}): number {
  if (!Number.isFinite(snapshot.duration) || snapshot.duration <= 0) {
    return PCT_MIN
  }

  if (!Number.isFinite(snapshot.currentTime)) {
    return PCT_MIN
  }

  return clamp(
    (snapshot.currentTime / snapshot.duration) * PCT_MAX,
    PCT_MIN,
    PCT_MAX,
  )
}

/** Turns a scrubber value back into a time to assign to `currentTime`. */
export function seekTimeFromPct(pct: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(pct)) {
    return 0
  }

  return (clamp(pct, PCT_MIN, PCT_MAX) / PCT_MAX) * duration
}

/**
 * Where an arrow press lands. Clamped to the file, and clamped at zero even
 * when the duration is unknown - seeking to a negative time throws.
 */
export function seekBy(
  currentTime: number,
  seconds: number,
  duration: number,
): number {
  const from = Number.isFinite(currentTime) ? currentTime : 0
  const target = from + seconds

  if (!Number.isFinite(duration) || duration <= 0) {
    return Math.max(0, target)
  }

  return clamp(target, 0, duration)
}

/** What a keypress asked the player to do. */
export type PlayerIntent =
  | { kind: 'seek-by'; seconds: number }
  | { kind: 'toggle-fullscreen' }
  | { kind: 'toggle-mute' }
  | { kind: 'toggle-play' }

/**
 * Where inside the player a keypress came from, which decides whether the
 * element under the cursor has already claimed that key.
 *
 * - `range` - the seek bar. Home/End/PageUp/PageDown are its own, and better
 *   than anything this module would invent for them.
 * - `button` - a transport button. Space is its activation; taking Space here
 *   as well would toggle playback twice per press. Nothing else in the map
 *   collides, so `K`, `M` and `F` still work from a focused button.
 * - `surface` - the frame itself. Nothing else wants the key.
 */
export type ShortcutOrigin = 'button' | 'range' | 'surface'

/**
 * Classifies a keydown's target. Takes `unknown` so the component can pass
 * `event.target` straight through without a cast, and so the unit tests can
 * pass `{ tagName: 'INPUT', type: 'range' }`.
 */
export function shortcutOrigin(target: unknown): ShortcutOrigin {
  if (typeof target !== 'object' || target === null) {
    return 'surface'
  }

  const { tagName, type } = target as { tagName?: unknown; type?: unknown }

  if (tagName === 'BUTTON') {
    return 'button'
  }

  if (tagName === 'INPUT' && type === 'range') {
    return 'range'
  }

  return 'surface'
}

/** The parts of a keydown this module looks at. */
export type ShortcutEvent = {
  altKey?: boolean
  ctrlKey?: boolean
  key: string
  metaKey?: boolean
}

/**
 * The whole keyboard map, as data rather than as a switch inside an event
 * handler.
 *
 * - Space / K toggle playback.
 * - Left and Down seek back {@link SEEK_STEP_SECONDS}, Right and Up seek
 *   forward. All four arrows seek, and up/down are deliberately *not* a
 *   volume change: this bar - like the mockup it is ported from - has nowhere
 *   to show a volume *level*, so a keystroke that silently moved one would be
 *   creating state the UI cannot display. Mute is the volume affordance the
 *   design affords, and `M` mirrors it.
 * - M mutes, F goes fullscreen.
 *
 * A modified press is always somebody else's: Cmd/Ctrl/Alt+arrow are browser
 * and OS navigation, and swallowing them would be worse than not having
 * shortcuts at all. Shift is not checked, because nothing in the map is
 * shifted and Shift+Space is still "toggle playback" everywhere else.
 */
export function playerIntentForKey(
  event: ShortcutEvent,
  origin: ShortcutOrigin,
): PlayerIntent | null {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return null
  }

  switch (event.key) {
    case ' ':
    case 'Spacebar':
      // Only Space is given up on a button; `K` is nobody else's key.
      return origin === 'button' ? null : { kind: 'toggle-play' }
    case 'k':
    case 'K':
      return { kind: 'toggle-play' }
    case 'ArrowRight':
    case 'ArrowUp':
      return { kind: 'seek-by', seconds: SEEK_STEP_SECONDS }
    case 'ArrowLeft':
    case 'ArrowDown':
      return { kind: 'seek-by', seconds: -SEEK_STEP_SECONDS }
    case 'm':
    case 'M':
      return { kind: 'toggle-mute' }
    case 'f':
    case 'F':
      return { kind: 'toggle-fullscreen' }
    default:
      return null
  }
}

/**
 * The document-side half of the Fullscreen API, including the three vendor
 * spellings that are still the only thing that works in older WebKit and
 * Gecko. Every member is optional, so a real `document` satisfies it without
 * a cast even though its type declares none of the prefixed names.
 */
export type FullscreenDocumentLike = {
  fullscreenElement?: unknown
  webkitFullscreenElement?: unknown
  mozFullScreenElement?: unknown
  msFullscreenElement?: unknown
  exitFullscreen?: () => unknown
  webkitExitFullscreen?: () => unknown
  mozCancelFullScreen?: () => unknown
  msExitFullscreen?: () => unknown
}

/**
 * The element-side half. `webkitEnterFullscreen` is the odd one out - it
 * exists only on `HTMLVideoElement`, takes the *video* fullscreen rather than
 * its container, and is the only fullscreen that works at all on iPhone
 * Safari. The component uses it as a last resort.
 */
export type FullscreenElementLike = {
  requestFullscreen?: () => unknown
  webkitRequestFullscreen?: () => unknown
  mozRequestFullScreen?: () => unknown
  msRequestFullscreen?: () => unknown
  webkitEnterFullscreen?: () => unknown
}

/**
 * Every spelling of the change event. All four are listened to rather than
 * feature-detected, because the event name and the property name are not
 * guaranteed to come from the same vendor era.
 */
export const FULLSCREEN_EVENTS = [
  'fullscreenchange',
  'webkitfullscreenchange',
  'mozfullscreenchange',
  'MSFullscreenChange',
] as const

/** Whatever is fullscreen right now, under any of the four spellings. */
export function fullscreenElement(doc: FullscreenDocumentLike): unknown {
  return (
    doc.fullscreenElement ??
    doc.webkitFullscreenElement ??
    doc.mozFullScreenElement ??
    doc.msFullscreenElement ??
    null
  )
}

/**
 * Whether *this* element is the fullscreen one.
 *
 * Asked of the document on every render rather than tracked in a boolean,
 * which is the point: a user who leaves fullscreen with Escape, with the
 * browser's own chrome, or by taking a different element fullscreen never
 * touches this component, and a local flag would be wrong from then on.
 */
export function isFullscreen(
  doc: FullscreenDocumentLike,
  element: unknown,
): boolean {
  return (
    element !== null &&
    element !== undefined &&
    fullscreenElement(doc) === element
  )
}

type FullscreenMethod = (() => unknown) | undefined

function callFirst(
  host: object,
  methods: readonly FullscreenMethod[],
): boolean {
  for (const method of methods) {
    if (typeof method !== 'function') {
      continue
    }

    // `.call(host)` rather than `host.requestFullscreen()`: the method was
    // picked off the object by name, and the Fullscreen API throws if it is
    // invoked detached from its element.
    const result = method.call(host)

    // Modern spellings return a promise that rejects when the gesture was not
    // trusted or the element is not allowed fullscreen. That is a refusal,
    // not a crash - the button simply does nothing.
    void Promise.resolve(result).catch(() => {})

    return true
  }

  return false
}

/**
 * Takes an element fullscreen. Returns whether any spelling existed, so the
 * caller can fall back (container fullscreen -> the video's own
 * `webkitEnterFullscreen`) rather than silently doing nothing.
 */
export function enterFullscreen(element: FullscreenElementLike): boolean {
  return callFirst(element, [
    element.requestFullscreen,
    element.webkitRequestFullscreen,
    element.mozRequestFullScreen,
    element.msRequestFullscreen,
    element.webkitEnterFullscreen,
  ])
}

/** Leaves fullscreen. Returns whether any spelling existed. */
export function leaveFullscreen(doc: FullscreenDocumentLike): boolean {
  return callFirst(doc, [
    doc.exitFullscreen,
    doc.webkitExitFullscreen,
    doc.mozCancelFullScreen,
    doc.msExitFullscreen,
  ])
}
