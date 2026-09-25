'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  ChangeEvent,
  ComponentPropsWithoutRef,
  JSX,
  KeyboardEvent,
  RefObject,
} from 'react'
import { useCallback, useRef, useSyncExternalStore } from 'react'

import type {
  MediaSnapshot,
  PlayerIntent,
} from 'src/components/detail/video-player-state'
import {
  enterFullscreen,
  formatTimecode,
  FULLSCREEN_EVENTS,
  isFullscreen,
  leaveFullscreen,
  MEDIA_EVENTS,
  MEDIA_SNAPSHOT_INITIAL,
  PCT_MAX,
  PCT_MIN,
  playedPct,
  playerIntentForKey,
  readMediaSnapshot,
  sameMediaSnapshot,
  seekBy,
  seekTimeFromPct,
  seekValueText,
  shortcutOrigin,
} from 'src/components/detail/video-player-state'
import { Icon } from 'src/components/ui/icon'

/** The player region's accessible name when the caller gives no title. */
export const VIDEO_PLAYER_LABEL = 'Video player'

export const SEEK_LABEL = 'Seek'
export const PLAY_LABEL = 'Play'
export const PAUSE_LABEL = 'Pause'
export const MUTE_LABEL = 'Mute'
export const UNMUTE_LABEL = 'Unmute'
export const FULLSCREEN_LABEL = 'Fullscreen'
export const EXIT_FULLSCREEN_LABEL = 'Exit fullscreen'

/**
 * The frame. `aspect-video` and `rounded-md` are `Poster`'s `wide` shape and
 * its default radius, which is the whole point of the control bar being
 * scrimmed over the video rather than sitting under it: the page's layout
 * does not change between "not downloaded yet, here is the thumbnail" and
 * "downloaded, here is the player".
 *
 * `bg-bg-sunk` rather than `Poster`'s gradient because a video is letterboxed
 * against its own bars, and a purple gradient behind a 9:16 phone clip reads
 * as a broken image rather than as a frame.
 *
 * `[&:fullscreen]` undoes the two utilities that only make sense inline. The
 * UA stylesheet already forces a fullscreen element to fill the screen with
 * `!important`, so `aspect-auto` is belt-and-braces; the corner radius is
 * not - a rounded rectangle with black beyond it is visible.
 */
const PLAYER_FRAME = cns(
  'group/player relative flex aspect-video shrink-0 items-center justify-center',
  'overflow-hidden rounded-md bg-bg-sunk',
  '[&:fullscreen]:aspect-auto [&:fullscreen]:rounded-none',
)

/**
 * `object-contain`, not `object-cover`: a thumbnail may be cropped to the
 * grid's rhythm, but a video may never be cropped to its frame.
 */
const PLAYER_VIDEO = 'absolute inset-0 h-full w-full object-contain'

/** `playerControls` from `designs/src/pages/video-detail.pug:51`. */
const CONTROL_BAR = cns(
  'absolute inset-x-0 bottom-0 flex flex-col gap-2',
  'bg-linear-to-t from-scrim/85 from-0% to-transparent to-80%',
  'px-3 pt-9 pb-2.5',
)

/**
 * A control bar button.
 *
 * The mixin's class list plus one addition: `after:-inset-2` hangs a
 * transparent 8px halo off every button, which turns the mockup's 15px icon
 * into a ~31px hit target without moving a single pixel of the layout.
 *
 * Padding would have been the obvious way to do that and is not available
 * here - the row is `gap-2.5`, so 8px of padding on each of two neighbours
 * would need a *negative* 6px gap to keep the icons where the design puts
 * them. A pseudo-element is outside flow entirely, so the icons stay exactly
 * where `video-detail.pug` puts them and the touch targets roughly double.
 *
 * Neighbouring halos overlap by 6px, which paint order resolves in the later
 * sibling's favour. That is a boundary that moves by 3px, not a dead zone.
 */
const CONTROL_BUTTON = cns(
  'relative flex text-ink/90 transition-colors duration-150 ease-uv hover:text-ink',
  "after:absolute after:-inset-2 after:content-['']",
)

/** `scrubber` from `designs/src/pages/video-detail.pug:32`. */
const SCRUBBER = 'relative flex h-3 w-full items-center'
const SCRUBBER_TRACK = 'h-[3px] w-full overflow-hidden rounded-full bg-ink/25'
const SCRUBBER_FILL = 'block h-full rounded-full bg-uv'
const SCRUBBER_THUMB = cns(
  'pointer-events-none absolute top-1/2 h-[11px] w-[11px]',
  '-translate-x-1/2 -translate-y-1/2 rounded-full bg-uv',
  'shadow-[0_0_0_2px_var(--color-scrim)]',
)

/**
 * The real control, laid invisibly over the mockup's drawing of it.
 *
 * ⚠️ The seek bar is an `<input type="range">` and not a `div` with a mouse
 * handler, which is where its keyboard model, its `slider` role, its
 * value announcements and its focus ring all come from for free. Styling one
 * to *look* like the mockup means overriding two vendor pseudo-elements in
 * every engine and still not matching; overlaying a transparent one on the
 * mixin's own markup means the rendered pixels are the mixin's, exactly.
 *
 * - `h-6` against the mockup's 12px container: the input is the hit target,
 *   and 24px is the most that fits without reaching into the `gap-2` above
 *   the transport row and stealing its clicks.
 * - The thumb is `w-px` rather than the visual 11px. A range maps its value
 *   across `width - thumbWidth`, so an 11px thumb would put the browser's
 *   idea of "38%" up to 5.5px away from where the visible dot is drawn.
 * - `bg-transparent` on the track in both engines: the visible track is the
 *   `<div>` underneath.
 */
const SCRUBBER_INPUT = cns(
  'absolute inset-x-0 top-1/2 h-6 -translate-y-1/2 appearance-none',
  'cursor-pointer bg-transparent',
  '[&::-webkit-slider-runnable-track]:h-6',
  '[&::-webkit-slider-runnable-track]:bg-transparent',
  '[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-px',
  '[&::-webkit-slider-thumb]:appearance-none',
  '[&::-webkit-slider-thumb]:bg-transparent',
  '[&::-moz-range-track]:h-6 [&::-moz-range-track]:bg-transparent',
  '[&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-px',
  '[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent',
)

/**
 * 0.1% of the file per step, so a drag is smooth on a two-hour movie. The
 * arrow keys never see this - they are intercepted and turned into a
 * five-second seek, so that a keyboard press moves the same distance whether
 * the slider has focus or the frame does.
 */
const SCRUBBER_STEP = 0.1

/**
 * ⚠️ `text-[11px]` is the mixin's own value and is deliberately off the type
 * scale - the nearest token, `text-mono-sm`, is 11.5px. Ported verbatim
 * rather than snapped to the scale: this readout sits on top of the video at
 * the smallest size in the app, and the half-pixel is a deliberate choice of
 * the design rather than a slip.
 */
const TIMECODE = 'font-mono text-[11px] tabular-nums text-ink-2'

/**
 * The muted glyph, built from the 27-name icon set rather than added to it.
 *
 * There is no `volume-off` symbol and one must not be invented here -
 * `icon.tsx` and `sprite.tsx` are closed. So the mute state is drawn the way
 * the sprite itself draws "off": `i-eye-slash` is `i-eye` plus a
 * corner-to-corner diagonal at `stroke-width: 1.3`, and this is `i-volume`
 * plus the same diagonal, scaled from the sprite's 16px viewBox to the bar's
 * 15px icon (12/16 of the box across, so ~16px long at ~1.2px thick).
 */
const MUTE_SLASH = cns(
  'pointer-events-none absolute top-1/2 left-1/2 h-[1.2px] w-4',
  '-translate-x-1/2 -translate-y-1/2 rotate-45 rounded-full bg-current',
)

const ICON_15 = 'h-[15px] w-[15px]'

/**
 * Subscribes to a media element and returns what it currently reports.
 *
 * ⚠️ `useSyncExternalStore`, not `useEffect` + `setState`. Syncing component
 * state from a DOM element's events is the exact shape
 * `react-hooks/set-state-in-effect` rejects, and it is also the shape that
 * drifts: the element is the source of truth for `paused`, `currentTime`,
 * `muted` and `duration`, and any of the four can change without this
 * component asking (the file ends, the user hits the hardware mute key, the
 * OS pauses playback for a phone call).
 *
 * The snapshot is cached in a ref and only replaced when it actually differs,
 * because `getSnapshot` has to be referentially stable between events or
 * React re-renders forever.
 */
function useMediaSnapshot(
  videoRef: RefObject<HTMLVideoElement | null>,
): MediaSnapshot {
  const snapshotRef = useRef<MediaSnapshot>(MEDIA_SNAPSHOT_INITIAL)

  const subscribe = useCallback(
    (onStoreChange: () => void): (() => void) => {
      const video = videoRef.current

      if (!video) {
        return () => {}
      }

      const sync = (): void => {
        const next = readMediaSnapshot(video)

        if (sameMediaSnapshot(next, snapshotRef.current)) {
          return
        }

        snapshotRef.current = next
        onStoreChange()
      }

      for (const type of MEDIA_EVENTS) {
        video.addEventListener(type, sync)
      }

      // Seed: subscription happens in an effect, by which point the element
      // may already have metadata (a cached file resolves that fast) and
      // will never fire those events again.
      sync()

      return () => {
        for (const type of MEDIA_EVENTS) {
          video.removeEventListener(type, sync)
        }
      }
    },
    [videoRef],
  )

  return useSyncExternalStore(
    subscribe,
    () => snapshotRef.current,
    () => MEDIA_SNAPSHOT_INITIAL,
  )
}

/**
 * Whether this element is the one the *document* considers fullscreen.
 *
 * Deliberately not a piece of local state that the fullscreen button flips.
 * Escape, F11, the browser's own exit affordance and a second element going
 * fullscreen all change the answer without going anywhere near this
 * component, and a local boolean would be stale from the first one.
 */
function useIsFullscreen(containerRef: RefObject<HTMLElement | null>): boolean {
  const subscribe = useCallback((onStoreChange: () => void): (() => void) => {
    for (const type of FULLSCREEN_EVENTS) {
      document.addEventListener(type, onStoreChange)
    }

    return () => {
      for (const type of FULLSCREEN_EVENTS) {
        document.removeEventListener(type, onStoreChange)
      }
    }
  }, [])

  return useSyncExternalStore(
    subscribe,
    // Re-read rather than cached: the value is a boolean, so there is no
    // identity to keep stable, and reading the live document is the whole
    // guarantee this hook exists to make.
    () => isFullscreen(document, containerRef.current),
    () => false,
  )
}

export type VideoPlayerProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'title'
> & {
  /**
   * The media URL to play, already resolved by the page: `downloadUrls[0]`
   * when the video has one, otherwise the media-file endpoint.
   *
   * Resolved by the caller rather than fetched here on purpose - this
   * component takes a string and never reaches for a client, so the page owns
   * the one decision that needs the `Video` in hand.
   */
  src: string
  /** `MediaBase.posterUrl`. Shown until the first frame plays. */
  poster?: string | null
  /** The video's title. Names the player region for assistive technology. */
  title?: string
  /** Escape hatch onto the `<video>` itself - `crossOrigin`, `data-testid`. */
  videoProps?: Omit<
    ComponentPropsWithoutRef<'video'>,
    'children' | 'controls' | 'poster' | 'src'
  >
}

/**
 * The in-app video player: a `<video>` with the browser's own controls
 * suppressed and the system's control bar scrimmed over the bottom of the
 * frame.
 *
 * Ported from `designs/src/pages/video-detail.pug`'s `scrubber` (32-47) and
 * `playerControls` (51-62) mixins, which draw the bar and stop there - the
 * mockups declare themselves free of behavioural JS, so every behaviour below
 * is an addition rather than a port. All of the decisions live in
 * `video-player-state.ts`; this file is the wiring.
 *
 * - Autoplay is off and `preload="metadata"` is on, so the poster holds the
 *   frame until somebody presses play but the duration is real immediately.
 * - Every control is a real, tabbable element with an accessible name, and
 *   the seek bar is a real `<input type="range">`.
 * - Keyboard: Space/K toggles playback, the arrows seek five seconds, M
 *   mutes, F goes fullscreen. The frame itself is focusable, so clicking the
 *   picture and then pressing a key works the way it does in every other
 *   player.
 * - Fullscreen reflects `document.fullscreenElement`, under all four vendor
 *   spellings, rather than a local flag.
 *
 * Known limitation, not worked around: iPhone Safari has no element
 * fullscreen at all, so the button falls back to the video's own
 * `webkitEnterFullscreen`, which hands the file to the system player. The
 * document never reports that as fullscreen, so the button's label stays
 * "Fullscreen" while it is up - correct, in that the *page* is not
 * fullscreen, and there is nothing this bar can do about it either way.
 */
export function VideoPlayer({
  className,
  poster,
  src,
  title,
  videoProps,
  onKeyDown,
  ...props
}: VideoPlayerProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const media = useMediaSnapshot(videoRef)
  const fullscreen = useIsFullscreen(containerRef)

  const pct = playedPct(media)

  const togglePlay = useCallback((): void => {
    const video = videoRef.current

    if (!video) {
      return
    }

    if (!video.paused) {
      video.pause()

      return
    }

    // `play()` rejects when the browser refuses the gesture; that is a
    // refusal to start, not an error to surface, and an unhandled rejection
    // would be noise in the console on every blocked autoplay policy.
    // `Promise.resolve` wraps it because older engines return nothing.
    void Promise.resolve(video.play()).catch(() => {})
  }, [])

  const toggleFullscreen = useCallback((): void => {
    const container = containerRef.current

    if (!container) {
      return
    }

    if (isFullscreen(document, container)) {
      leaveFullscreen(document)

      return
    }

    if (enterFullscreen(container)) {
      return
    }

    // No element fullscreen in this engine - iPhone Safari. The video's own
    // fullscreen is all that is on offer.
    const video = videoRef.current

    if (video) {
      enterFullscreen(video)
    }
  }, [])

  const toggleMute = useCallback((): void => {
    const video = videoRef.current

    if (!video) {
      return
    }

    video.muted = !video.muted
  }, [])

  const applyIntent = useCallback(
    (intent: PlayerIntent): void => {
      const video = videoRef.current

      if (!video) {
        return
      }

      switch (intent.kind) {
        case 'seek-by':
          video.currentTime = seekBy(
            video.currentTime,
            intent.seconds,
            video.duration,
          )

          return
        case 'toggle-fullscreen':
          toggleFullscreen()

          return
        case 'toggle-mute':
          toggleMute()

          return
        case 'toggle-play':
          togglePlay()

          return
      }
    },
    [toggleFullscreen, toggleMute, togglePlay],
  )

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    onKeyDown?.(event)

    if (event.defaultPrevented) {
      return
    }

    const intent = playerIntentForKey(event, shortcutOrigin(event.target))

    if (!intent) {
      return
    }

    // Space scrolls the page and the arrows scroll or step the slider; a
    // shortcut that fires *and* lets the default through is a shortcut that
    // moves the page out from under the video.
    event.preventDefault()
    applyIntent(intent)
  }

  function handleSeek(event: ChangeEvent<HTMLInputElement>): void {
    const video = videoRef.current

    if (!video) {
      return
    }

    video.currentTime = seekTimeFromPct(
      Number(event.target.value),
      video.duration,
    )
  }

  return (
    <div
      role="region"
      aria-label={
        title ? `${title} — ${VIDEO_PLAYER_LABEL}` : VIDEO_PLAYER_LABEL
      }
      {...props}
      ref={containerRef}
      className={cns(PLAYER_FRAME, className)}
      onKeyDown={handleKeyDown}
      // Focusable so that clicking the picture - the thing everybody does
      // first - puts the shortcuts within reach. Without it the keyboard map
      // only works once a control has been tabbed to.
      tabIndex={0}
    >
      {/*
        No `<track>`: a yt-dlp download carries no caption file, and an empty
        one would announce captions that do not exist. `onClick` toggles
        playback — the keyboard equivalent is on the frame, which this is
        inside of and which focuses when the picture is clicked.
      */}
      <video
        {...videoProps}
        ref={videoRef}
        className={cns(PLAYER_VIDEO, videoProps?.className)}
        playsInline
        poster={poster ?? undefined}
        preload="metadata"
        src={src}
        onClick={togglePlay}
      />

      <div className={CONTROL_BAR}>
        <div className={SCRUBBER}>
          <div className={SCRUBBER_TRACK}>
            <span className={SCRUBBER_FILL} style={{ width: `${pct}%` }} />
          </div>
          <span
            aria-hidden="true"
            className={SCRUBBER_THUMB}
            style={{ left: `${pct}%` }}
          />
          <input
            aria-label={SEEK_LABEL}
            aria-valuetext={seekValueText(media.currentTime, media.duration)}
            className={SCRUBBER_INPUT}
            max={PCT_MAX}
            min={PCT_MIN}
            step={SCRUBBER_STEP}
            type="range"
            value={pct}
            onChange={handleSeek}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label={media.paused ? PLAY_LABEL : PAUSE_LABEL}
              className={CONTROL_BUTTON}
              onClick={togglePlay}
            >
              <Icon
                name={media.paused ? 'play' : 'pause'}
                className={ICON_15}
              />
            </button>
            <span className={TIMECODE}>
              {formatTimecode(media.currentTime, media.duration)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={media.muted ? UNMUTE_LABEL : MUTE_LABEL}
              aria-pressed={media.muted}
              className={CONTROL_BUTTON}
              onClick={toggleMute}
            >
              <span className="relative flex">
                <Icon name="volume" className={ICON_15} />
                {media.muted ? <span className={MUTE_SLASH} /> : null}
              </span>
            </button>
            <button
              type="button"
              aria-label={fullscreen ? EXIT_FULLSCREEN_LABEL : FULLSCREEN_LABEL}
              aria-pressed={fullscreen}
              className={CONTROL_BUTTON}
              onClick={toggleFullscreen}
            >
              {/*
                There is no contract-from-fullscreen symbol in the 27-name
                set, and adding one would reopen `sprite.tsx`. `x` is the
                system's own "get out of this" mark — it closes the modal and
                cancels the download — and reads correctly in the one place
                this state is ever seen: a bar floating over a picture that
                has taken over the screen.
              */}
              <Icon
                name={fullscreen ? 'x' : 'expand'}
                className={fullscreen ? 'h-4 w-4' : 'h-[14px] w-[14px]'}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
