'use client'

import { cns } from '@lilnas/utils/cns'
import { useEffect, useRef, useState } from 'react'

import { formatRuntime, formatTimecode } from 'src/playback/format'
import {
  buildArtworkUrl,
  findNextEntry,
  resolveNowPlaying,
} from 'src/playback/nowPlaying'
import { type QueueEntry } from 'src/playback/queue'
import { type QualityTier, type SubtitleTrack } from 'src/playback/store'

import { filterLibraryItems, type LibraryTypeFilter } from './libraryFilter'

// ---------------------------------------------------------------------------
// Presentational half of the IpadBrowser.tsx split (PLAN.md "Phase 4C —
// Tablet presence + UI mirroring" / ORCHESTRATE.md §2, unit TF1): everything
// the tablet's <Html transform occlude> panel used to render inline —
// header, search box, type-filter pills, back button, poster grid, seasons
// list, episodes list, and the playback-controls footer — now lives here as
// a pure function of props, so the exact same markup can later be fed a
// REMOTE peer's tablet state (TF3, a later unit) instead of the local
// player's own.
//
// Three rules that make that possible:
//   - Never reads any store (not usePlaybackStore, not a future
//     multiplayer/tablet store) — every value rendered here arrives as a
//     prop from the caller. IpadBrowser.tsx (the local, interactive tablet)
//     is that caller today; TF3's <RemoteIpad> will be the other one,
//     passing a peer's broadcast tablet state instead of the local player's.
//   - Holds no browse/UI state of its own — `browse`/`search`/`typeFilter`/
//     the fetched item lists are the caller's `useState`, passed straight
//     through as props.
//   - Is inert whenever `interactive` is false: every click/change handler
//     is an optional callback prop, so a non-interactive caller can simply
//     omit all of them (every handler below invokes its prop via `?.()`, a
//     no-op when the prop is absent) — and the root panel gets
//     `pointer-events-none`, so it can never become a control surface for
//     whoever is looking at someone else's tablet (PLAN.md's Phase 4C
//     security note: "the remote view is render-only").
//
// IpadBrowser.tsx owns the 3D tablet body (the RoundedBox mesh) and the
// camera-relative HUD positioning that places this panel in front of the
// player — this component has no opinion about either; it only renders the
// <Html> panel's DOM content.
// ---------------------------------------------------------------------------

// Shape of `GET /theater/items` (ORCHESTRATE.md § "Backend endpoints",
// matching `src/emby/emby.service.ts`'s `TheaterItemDto`) — not part of any
// shared types package, so hand-mirrored here (the same convention this
// app's frontend/backend boundary already uses elsewhere). `type` has to be
// kept in sync with that backend DTO by hand. Exported so IpadBrowser.tsx —
// which owns the actual `fetch`/`useState` for this data — can share this
// single definition rather than duplicating it.
export type TheaterItemType = 'movie' | 'series'

export type TheaterItem = {
  id: string
  name: string
  type: TheaterItemType
  year: number | null
  overview: string | null
  runTimeTicks: number | null
  imageTag: string | null
}

// Mirrors `TheaterSeasonDto`/`TheaterEpisodeDto` in `emby.service.ts`.
export type TheaterSeason = {
  id: string
  name: string
  indexNumber: number | null
}

export type TheaterEpisode = {
  id: string
  name: string
  indexNumber: number | null
  overview: string | null
  runTimeTicks: number | null
  imageTag: string | null
}

// A fixed-depth (grid -> seasons -> episodes) drill-down, modeled as a
// discriminated union rather than independent nullable fields so an invalid
// combination (a season selected with no series) is structurally
// unrepresentable. A purely rendering-shaped concern (which panel to show),
// so it lives here rather than in IpadBrowser.tsx, which just holds one in
// state and passes it straight through as a prop.
//
// `'queue'` (Phase 5/F7b) and `'player'` are each one of four independent
// mirrors of the wire `TabletState.view` union — `tablet.schema.ts`'s zod enum,
// `multiplayer/store.ts`'s type + `isTabletState`, this union +
// `IpadBrowser.tsx`'s `buildTabletState`, and `RemoteIpad.tsx`'s
// `TabletState -> BrowseState` reconstruction are the other three
// (ORCHESTRATE.md §3). A partial edit fails silently — a peer's tablet state
// just stops validating or renders the wrong view — so grep the union rather
// than trusting the type checker to connect the copies.
//
// Both `'queue'` and `'player'` are shaped like `'grid'` (no extra fields):
// they're views onto flat, room-wide state read from a store, not drill-down
// contexts. `'player'` deliberately does NOT carry the item it's showing —
// what's playing is whatever the room's queue cursor says, and a copy held in
// browse state could disagree with it the moment someone else jumps the queue.
export type BrowseState =
  | { view: 'grid' }
  | { view: 'seasons'; series: TheaterItem }
  | { view: 'episodes'; series: TheaterItem; season: TheaterSeason }
  | { view: 'queue' }
  | { view: 'player' }

const TYPE_FILTER_OPTIONS: { value: LibraryTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'Shows' },
]

// Artwork widths requested from the backend's Emby image proxy for the player
// page's hero. Both are wider than the panel's own 640px so the image still
// looks sharp on a high-DPI display and when the poster fallback is overscanned.
const BACKDROP_MAX_WIDTH = 1280
const POSTER_MAX_WIDTH = 600

const QUALITY_OPTIONS: { tier: QualityTier; label: string }[] = [
  { tier: 'auto', label: 'Auto' },
  { tier: '1080p', label: '1080p' },
  { tier: '720p', label: '720p' },
  { tier: '480p', label: '480p' },
  { tier: 'datasaver', label: 'Data saver' },
]

function formatItemMeta(item: TheaterItem): string {
  const parts: string[] = []
  if (item.year !== null) {
    parts.push(String(item.year))
  }
  const runtime = formatRuntime(item.runTimeTicks)
  if (runtime !== null) {
    parts.push(runtime)
  }
  return parts.join(' · ')
}

function formatEpisodeMeta(episode: TheaterEpisode): string {
  const parts: string[] = []
  if (episode.indexNumber !== null) {
    parts.push(`E${episode.indexNumber}`)
  }
  const runtime = formatRuntime(episode.runTimeTicks)
  if (runtime !== null) {
    parts.push(runtime)
  }
  return parts.join(' · ')
}

// Centered "play" affordance for tiles that actually start playback on
// click (movies, episodes) — an inline SVG since no icon library is
// installed in this app.
function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 drop-shadow" aria-hidden="true">
      <circle cx="12" cy="12" r="11" className="fill-black/55" />
      <path d="M9.5 7.5v9l7-4.5z" className="fill-white/95" />
    </svg>
  )
}

// Distinct "browse into" affordance for series tiles — clicking one opens
// the season picker rather than playing anything, so it deliberately does
// NOT reuse PlayGlyph (a play triangle there would be a false promise).
function SeriesGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 drop-shadow" aria-hidden="true">
      <rect
        x="3.5"
        y="8.5"
        width="13"
        height="10"
        rx="1.5"
        className="fill-black/55"
      />
      <rect
        x="7"
        y="5"
        width="13"
        height="10"
        rx="1.5"
        className="fill-black/80 stroke-white/70"
        strokeWidth="1"
      />
    </svg>
  )
}

// Poster/thumbnail `<img>` with a text-placeholder fallback on load failure
// — more likely to matter now that episodes commonly lack their own unique
// art in Emby-family servers (they fall back to season/series art, which is
// a client responsibility, not automatic).
function LibraryImage({
  src,
  alt,
  aspectClassName,
}: {
  src: string
  alt: string
  aspectClassName: string
}) {
  const [broken, setBroken] = useState(false)

  if (broken) {
    return (
      <div
        className={cns(
          'flex w-full items-center justify-center rounded-md border border-white/10 bg-white/5 p-1 text-center text-[8px] text-white/40',
          aspectClassName,
        )}
      >
        {alt}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
      className={cns(
        'w-full rounded-md border border-white/10 bg-white/5 object-cover',
        aspectClassName,
      )}
    />
  )
}

// The scrub bar (F7a / D4 — the tablet is the only surface with seek).
// `dragValue` is local, ephemeral DOM-interaction bookkeeping — same
// category as `LibraryImage`'s `broken` flag above, NOT app/store state —
// so it living here doesn't violate this file's "never reads a store" rule
// (ORCHESTRATE.md §3): `playhead`/`duration`/`onSeek` are still the only
// inputs, all props.
//
// It has to live here rather than in the caller (IpadBrowser.tsx) because
// `onSeek` fires exactly once, on release — the container never observes an
// in-progress drag position, so there's nothing for it to buffer. While
// `dragValue` is non-null, this renders THAT value and ignores the
// `playhead` prop entirely, which is what stops the container's throttled
// ~4 Hz updates from fighting the user mid-gesture (a re-render with an
// unchanged, pre-drag `value` would otherwise snap a controlled range
// input's thumb back to it). `onSeek` only ever fires from the three
// "gesture ended" DOM events below (mouse/touch/keyboard release) — never
// from `onChange`, which fires on every drag tick.
function ScrubBar({
  playhead,
  duration,
  onSeek,
}: {
  playhead: number
  duration: number
  onSeek?: (playhead: number) => void
}) {
  const [dragValue, setDragValue] = useState<number | null>(null)

  const max = Math.max(duration, 0)
  const displayValue = Math.min(dragValue ?? playhead, max)

  function commit(value: number): void {
    setDragValue(null)
    onSeek?.(value)
  }

  return (
    <div className="flex items-center gap-1.5 text-[9px] text-white/50">
      <span className="w-8 shrink-0 tabular-nums">
        {formatTimecode(displayValue)}
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={displayValue}
        onChange={event => setDragValue(Number(event.target.value))}
        onMouseUp={event =>
          commit(Number((event.target as HTMLInputElement).value))
        }
        onTouchEnd={event =>
          commit(Number((event.target as HTMLInputElement).value))
        }
        onKeyUp={event =>
          commit(Number((event.target as HTMLInputElement).value))
        }
        className="h-1 min-w-0 flex-1 accent-white"
      />
      <span className="w-8 shrink-0 tabular-nums">{formatTimecode(max)}</span>
    </div>
  )
}

// Transport glyphs for the player page. Inline SVG, like PlayGlyph/SeriesGlyph
// above — at this panel's scale a glyph reads faster than a `text-[9px]` word,
// which is why the primary control here isn't the footer's old "Play"/"Pause"
// text pill.
function TransportPlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M8 5v14l11-7z" className="fill-current" />
    </svg>
  )
}

function TransportPauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M7 5h3.5v14H7zm6.5 0H17v14h-3.5z" className="fill-current" />
    </svg>
  )
}

function TransportNextGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M6 5v14l9-7z" className="fill-current" />
      <rect x="16.5" y="5" width="2.5" height="14" className="fill-current" />
    </svg>
  )
}

// Wide hero artwork for the player page. Steps down through what Emby may or
// may not have for an item: a 16:9 Backdrop, then the 2:3 Primary poster
// (blurred and overscanned, since cropping a poster to a wide banner looks worse
// than blurring it), then a plain gradient.
//
// Emby 404s an image type an item doesn't have and the backend proxy forwards
// that status through, so `onError` is the only signal available that a backdrop
// is missing — the same reason LibraryImage above tracks its own `broken` flag.
// Ephemeral DOM bookkeeping like that one, so it doesn't breach this file's
// "never reads a store" rule.
//
// Callers MUST pass `key={itemId}` so a new title remounts this and restarts the
// chain — otherwise one backdrop-less item permanently demotes every later one.
function PlayerArtwork({ itemId }: { itemId: string }) {
  const [stage, setStage] = useState<'backdrop' | 'poster' | 'none'>('backdrop')

  if (stage === 'none') {
    return (
      <div className="h-28 w-full rounded-md border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent" />
    )
  }

  const isBackdrop = stage === 'backdrop'

  return (
    <div className="relative h-28 w-full overflow-hidden rounded-md border border-white/10 bg-white/5">
      <img
        src={buildArtworkUrl(itemId, {
          type: isBackdrop ? 'Backdrop' : 'Primary',
          maxWidth: isBackdrop ? BACKDROP_MAX_WIDTH : POSTER_MAX_WIDTH,
        })}
        alt=""
        onError={() => setStage(isBackdrop ? 'poster' : 'none')}
        className={cns(
          'h-full w-full object-cover',
          !isBackdrop && 'scale-110 blur-md',
        )}
      />
      {/* Keeps the overlaid title legible over arbitrary artwork. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
    </div>
  )
}

type PlayerPageProps = {
  // Now-playing metadata, resolved from the ROOM's queue cursor by the caller
  // (playback/nowPlaying.ts) — never from `browse`, so this page can't disagree
  // with what's actually on the screen.
  nowPlaying: QueueEntry | null
  // The locally-loaded item, used as an artwork fallback while the queue echo is
  // still in flight (the optimistic load in IpadBrowser.tsx beats `queue:state`).
  itemId: string | null

  playing: boolean
  playhead: number
  duration: number
  loading: boolean
  error: string | null

  volume: number
  quality: QualityTier
  subtitleIndex: number | null
  textSubtitles: SubtitleTrack[]
  // False on the last queue entry: `commandNext` there clears the room cursor
  // and stops playback for everyone rather than wrapping (presence/queue.ts's
  // applyNext), so the button is disabled instead of silently ending the night.
  hasNext: boolean

  onSeek?: (playhead: number) => void
  onPlayPause?: () => void
  onNext?: () => void
  onVolumeChange?: (volume: number) => void
  onQualityChange?: (quality: QualityTier) => void
  onSubtitleChange?: (index: number | null) => void
}

// The tablet's "now playing" page — one of the `browse` views, sibling to the
// grid/seasons/episodes/queue panels. This is where every playback control lives
// now; the footer below is reduced to a one-line strip that navigates here.
function PlayerPage({
  nowPlaying,
  itemId,
  playing,
  playhead,
  duration,
  loading,
  error,
  volume,
  quality,
  subtitleIndex,
  textSubtitles,
  hasNext,
  onSeek,
  onPlayPause,
  onNext,
  onVolumeChange,
  onQualityChange,
  onSubtitleChange,
}: PlayerPageProps) {
  const artworkItemId = nowPlaying?.itemId ?? itemId

  if (artworkItemId === null) {
    return (
      <p className="p-2 text-[11px] text-white/50">
        Nothing is playing yet — pick a title from the library.
      </p>
    )
  }

  const runtime = formatRuntime(nowPlaying?.runTimeTicks ?? null)
  const metaParts = [nowPlaying?.subtitle ?? null, runtime].filter(
    (part): part is string => part !== null && part.length > 0,
  )

  return (
    <div className="space-y-2">
      <div className="relative">
        <PlayerArtwork key={artworkItemId} itemId={artworkItemId} />
        <div className="absolute inset-x-0 bottom-0 p-2">
          <p className="truncate text-[13px] font-medium text-white">
            {nowPlaying?.title ?? 'Now playing'}
          </p>
          {metaParts.length > 0 && (
            <p className="truncate text-[9px] text-white/60">
              {metaParts.join(' · ')}
            </p>
          )}
        </div>
      </div>

      {nowPlaying !== null && (
        <p className="text-[9px] text-white/40">
          Queued by {nowPlaying.addedBy}
        </p>
      )}

      <ScrubBar playhead={playhead} duration={duration} onSeek={onSeek} />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPlayPause?.()}
          aria-label={playing ? 'Pause' : 'Play'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:bg-white/90"
        >
          {playing ? <TransportPauseGlyph /> : <TransportPlayGlyph />}
        </button>

        <button
          type="button"
          onClick={() => onNext?.()}
          disabled={!hasNext}
          aria-label="Next in queue"
          className={cns(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition',
            hasNext
              ? 'border-white/30 text-white/80 hover:border-white/60 hover:text-white'
              : 'border-white/10 text-white/20',
          )}
        >
          <TransportNextGlyph />
        </button>

        <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[9px] text-white/50">
          <span className="tracking-wide uppercase">Vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={event => onVolumeChange?.(Number(event.target.value))}
            className="h-1 min-w-0 flex-1 accent-white"
          />
        </label>
      </div>

      <div>
        <p className="mb-1 text-[9px] tracking-wide text-white/40 uppercase">
          Quality
        </p>
        <div className="flex flex-wrap gap-1">
          {QUALITY_OPTIONS.map(option => (
            <button
              key={option.tier}
              type="button"
              aria-current={quality === option.tier}
              onClick={() => onQualityChange?.(option.tier)}
              className={cns(
                'rounded-full border px-1.5 py-0.5 text-[9px] transition',
                quality === option.tier
                  ? 'border-white bg-white/15 text-white'
                  : 'border-white/25 text-white/60 hover:border-white/50 hover:text-white',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-[9px] tracking-wide text-white/40 uppercase">
          Subtitles
        </p>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            aria-current={subtitleIndex === null}
            onClick={() => onSubtitleChange?.(null)}
            className={cns(
              'rounded-full border px-1.5 py-0.5 text-[9px] transition',
              subtitleIndex === null
                ? 'border-white bg-white/15 text-white'
                : 'border-white/25 text-white/60 hover:border-white/50 hover:text-white',
            )}
          >
            Off
          </button>
          {textSubtitles.map(track => (
            <button
              key={track.index}
              type="button"
              aria-current={subtitleIndex === track.index}
              onClick={() => onSubtitleChange?.(track.index)}
              className={cns(
                'rounded-full border px-1.5 py-0.5 text-[9px] transition',
                subtitleIndex === track.index
                  ? 'border-white bg-white/15 text-white'
                  : 'border-white/25 text-white/60 hover:border-white/50 hover:text-white',
              )}
            >
              {track.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="flex items-center gap-1.5 text-[9px] text-white/50">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/60" />
          Buffering…
        </p>
      )}
      {error !== null && <p className="text-[9px] text-red-300">{error}</p>}
    </div>
  )
}

export type IpadBrowserViewProps = {
  // False for a future non-interactive remote mirror (TF3): gates the root
  // panel's `pointer-events-none` and is the reason every callback below is
  // optional — see the file banner above.
  interactive: boolean

  // Library grid + search/filter state (IpadBrowser.tsx's `useState`).
  items: TheaterItem[]
  itemsLoading: boolean
  itemsError: string | null
  search: string
  typeFilter: LibraryTypeFilter

  // Drill-down state (grid -> seasons -> episodes) and its fetched data.
  browse: BrowseState
  seasons: TheaterSeason[]
  seasonsLoading: boolean
  seasonsError: string | null
  episodes: TheaterEpisode[]
  episodesLoading: boolean
  episodesError: string | null

  // Playback-controls footer state — read from usePlaybackStore by the
  // caller; this component never touches that store (or any store) itself.
  itemId: string | null
  playing: boolean
  volume: number
  quality: QualityTier
  subtitleIndex: number | null
  subtitles: SubtitleTrack[]
  loading: boolean
  error: string | null

  // Scrub bar (F7a / D4). `playhead` is a ~4Hz-throttled sample of
  // `usePlaybackStore.getTargetPlayhead()` (IpadBrowser.tsx's useFrame) —
  // never per-frame React state, which would re-render this whole panel
  // 60x/s. `duration` changes only when a new item loads, so the caller
  // reads it straight from the store. `onSeek` fires exactly once per drag
  // gesture, on release — see ScrubBar's own comment for why the drag-vs-
  // committed distinction has to live there rather than in the caller.
  playhead: number
  duration: number
  onSeek?: (playhead: number) => void

  // Room-wide, shared queue state (F7b / PLAN.md D6) — the SAME queue for
  // every viewer, unlike everything above (browse/search/scroll are this
  // tablet's own local nav). Read from `playback/queue.ts`'s useQueueStore
  // by the caller; this component never touches that store (or any store)
  // itself — see the file banner's "never reads a store" rule.
  queue: QueueEntry[]
  currentEntryId: string | null

  // Controlled scroll position for the scrollable grid/list container below
  // — `undefined` (the local/interactive tablet) leaves scrolling entirely
  // to the user; a defined value (a future remote mirror, TF3) drives the
  // container's real `scrollTop` to visually match a peer's. See the effect
  // in the component body.
  scrollTop?: number

  // Interactive-only callbacks, one per click/change handler this component
  // used to wire directly (plus `onSeasonClick`, needed for behavior parity
  // with today's season-picker click — not itself store-driven rendering,
  // so it wasn't in the original inline-handler set, but the click still
  // has to reach the caller somehow). A future non-interactive caller (TF3)
  // supplies none of these, so every `on*?.()` call below is a no-op — the
  // tablet never writes to any store on that peer's viewer's behalf.
  onSearchChange?: (value: string) => void
  onTypeFilterChange?: (filter: LibraryTypeFilter) => void
  onItemClick?: (item: TheaterItem) => void
  onBack?: () => void
  onSeasonClick?: (season: TheaterSeason) => void
  onEpisodeClick?: (episode: TheaterEpisode) => void
  onPlayPause?: () => void
  onVolumeChange?: (volume: number) => void
  onQualityChange?: (quality: QualityTier) => void
  onSubtitleChange?: (index: number | null) => void

  // Queue-tab navigation + mutation (F7b). `onQueueJump`/`onQueueRemove`/
  // `onQueueMove` map straight onto `playback/sync.ts`'s `commandJump`/
  // `commandRemove`/`commandMove` (ORCHESTRATE.md §1) — buttons only, never
  // drag-and-drop (PLAN.md: reordering inside an <Html>-in-Canvas overlay
  // with pointer-lock active is "a pointer-event fight not worth having").
  // `onOpenQueue` is pure local nav (parallels `onBack`) — it only flips
  // this tablet's own `BrowseState`, never a room command. A future
  // non-interactive caller (RemoteIpad) supplies none of these four, same
  // as every other `on*?` prop above, so a peer's mirrored queue view is
  // read-only.
  onOpenQueue?: () => void
  onQueueJump?: (entryId: string) => void
  onQueueRemove?: (entryId: string) => void
  onQueueMove?: (entryId: string, beforeEntryId: string | null) => void

  // Player-page navigation + transport. `onOpenPlayer` is pure local nav (it
  // only flips this tablet's own `BrowseState`, like `onOpenQueue`/`onBack`);
  // `onNext` maps onto `playback/sync.ts`'s `commandNext` and IS a room command.
  onOpenPlayer?: () => void
  onNext?: () => void
}

export function IpadBrowserView({
  interactive,
  items,
  itemsLoading,
  itemsError,
  search,
  typeFilter,
  browse,
  seasons,
  seasonsLoading,
  seasonsError,
  episodes,
  episodesLoading,
  episodesError,
  itemId,
  playing,
  volume,
  quality,
  subtitleIndex,
  subtitles,
  loading,
  error,
  playhead,
  duration,
  onSeek,
  queue,
  currentEntryId,
  scrollTop,
  onSearchChange,
  onTypeFilterChange,
  onItemClick,
  onBack,
  onSeasonClick,
  onEpisodeClick,
  onPlayPause,
  onVolumeChange,
  onQualityChange,
  onSubtitleChange,
  onOpenQueue,
  onQueueJump,
  onQueueRemove,
  onQueueMove,
  onOpenPlayer,
  onNext,
}: IpadBrowserViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Remote-scroll mirroring (TF3): applies `scrollTop` to the real DOM node
  // whenever it changes, so a remote peer's tablet visually scrolls to match
  // what they're doing. A no-op while `scrollTop` is undefined — the local/
  // interactive tablet never passes it, so this never fights the user's own
  // natural scrolling.
  useEffect(() => {
    if (scrollTop === undefined) {
      return
    }
    const container = containerRef.current
    if (container) {
      container.scrollTop = scrollTop
    }
  }, [scrollTop])

  // Flat, always-nullable views of the `browse` union — used throughout
  // render instead of re-narrowing `browse` at every JSX use site (narrowing
  // a discriminated union doesn't reliably survive into nested closures,
  // e.g. an inline onClick, without re-checking `.view` again there too).
  const browsingSeries =
    browse.view === 'seasons' || browse.view === 'episodes'
      ? browse.series
      : null
  const browsingSeason = browse.view === 'episodes' ? browse.season : null

  const textSubtitles = subtitles.filter(track => track.isText)
  const filteredItems = filterLibraryItems(items, search, typeFilter)

  // Derived from the ROOM's queue + cursor props, not from `browse` — so the
  // player page, the back-bar title and the now-playing footer strip all name
  // whatever is actually on the screen, even if a peer jumped the queue while
  // this tablet sat on some other view. Pure helpers, so importing them doesn't
  // breach this file's "never reads a store" rule.
  const nowPlaying = resolveNowPlaying(queue, currentEntryId)
  const hasNext = findNextEntry(queue, currentEntryId) !== null

  return (
    <div
      className={cns(
        'flex h-full w-full flex-col overflow-hidden rounded-2xl border border-white/15',
        'bg-black/90 text-white shadow-2xl backdrop-blur',
        !interactive && 'pointer-events-none',
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[10px] font-medium tracking-[0.2em] text-white/50 uppercase">
          {browse.view === 'player' ? 'Now Playing' : 'Library'}
        </span>
      </div>

      {browse.view === 'grid' ? (
        <div className="flex flex-col gap-1.5 border-b border-white/10 px-3 py-2">
          <input
            type="text"
            value={search}
            onChange={event => onSearchChange?.(event.target.value)}
            placeholder="Search titles…"
            className={cns(
              'w-full rounded border border-white/20 bg-white/5 px-2 py-1 text-[10px] text-white',
              'placeholder:text-white/30 focus:border-white/50 focus:outline-none',
            )}
          />
          <div className="flex gap-1">
            {TYPE_FILTER_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                aria-current={typeFilter === option.value}
                onClick={() => onTypeFilterChange?.(option.value)}
                className={cns(
                  'rounded-full border px-2 py-0.5 text-[9px] transition',
                  typeFilter === option.value
                    ? 'border-white bg-white/15 text-white'
                    : 'border-white/25 text-white/60 hover:border-white/50 hover:text-white',
                )}
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onOpenQueue?.()}
              className="ml-auto shrink-0 rounded-full border border-white/25 px-2 py-0.5 text-[9px] text-white/60 transition hover:border-white/50 hover:text-white"
            >
              Queue ({queue.length})
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <button
            type="button"
            onClick={() => onBack?.()}
            className="shrink-0 rounded-full border border-white/25 px-2 py-0.5 text-[9px] text-white/60 transition hover:border-white/50 hover:text-white"
          >
            ← Back
          </button>
          <span className="truncate text-[10px] text-white/50">
            {browse.view === 'queue' && 'Queue'}
            {browse.view === 'player' && (nowPlaying?.title ?? 'Player')}
            {(browse.view === 'seasons' || browse.view === 'episodes') &&
              `${browsingSeries?.name ?? ''}${browsingSeason ? ` · ${browsingSeason.name}` : ''}`}
          </span>
        </div>
      )}

      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {browse.view === 'grid' && (
          <>
            {itemsLoading && (
              <p className="p-2 text-[11px] text-white/50">Loading titles…</p>
            )}
            {itemsError && (
              <p className="p-2 text-[11px] text-red-300">{itemsError}</p>
            )}
            {!itemsLoading && !itemsError && filteredItems.length === 0 && (
              <p className="p-2 text-[11px] text-white/50">No titles found.</p>
            )}

            <div className="grid grid-cols-4 gap-2">
              {filteredItems.map(item => {
                const meta = formatItemMeta(item)
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.overview ?? undefined}
                    onClick={() => onItemClick?.(item)}
                    className="group flex flex-col gap-1 rounded text-left transition hover:opacity-90"
                  >
                    <div className="relative">
                      <LibraryImage
                        src={`/api/theater/items/${item.id}/image`}
                        alt={item.name}
                        aspectClassName="aspect-[2/3]"
                      />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                        {item.type === 'movie' ? (
                          <PlayGlyph />
                        ) : (
                          <SeriesGlyph />
                        )}
                      </div>
                    </div>
                    <span className="truncate text-[9px] leading-tight text-white/80">
                      {item.name}
                    </span>
                    {meta && (
                      <span className="truncate text-[8px] leading-tight text-white/40">
                        {meta}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </>
        )}

        {browse.view === 'seasons' && (
          <>
            {seasonsLoading && (
              <p className="p-2 text-[11px] text-white/50">Loading seasons…</p>
            )}
            {seasonsError && (
              <p className="p-2 text-[11px] text-red-300">{seasonsError}</p>
            )}
            {!seasonsLoading && !seasonsError && seasons.length === 0 && (
              <p className="p-2 text-[11px] text-white/50">No seasons found.</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {seasons.map(season => (
                <button
                  key={season.id}
                  type="button"
                  onClick={() => onSeasonClick?.(season)}
                  className="rounded-full border border-white/25 px-3 py-1.5 text-[10px] text-white/70 transition hover:border-white/50 hover:text-white"
                >
                  {season.name}
                </button>
              ))}
            </div>
          </>
        )}

        {browse.view === 'episodes' && (
          <>
            {episodesLoading && (
              <p className="p-2 text-[11px] text-white/50">Loading episodes…</p>
            )}
            {episodesError && (
              <p className="p-2 text-[11px] text-red-300">{episodesError}</p>
            )}
            {!episodesLoading && !episodesError && episodes.length === 0 && (
              <p className="p-2 text-[11px] text-white/50">
                No episodes found.
              </p>
            )}
            <div className="flex flex-col gap-1.5">
              {episodes.map(episode => {
                const meta = formatEpisodeMeta(episode)
                return (
                  <button
                    key={episode.id}
                    type="button"
                    title={episode.overview ?? undefined}
                    onClick={() => onEpisodeClick?.(episode)}
                    className="group flex items-center gap-2 rounded text-left transition hover:opacity-90"
                  >
                    <div className="relative w-20 shrink-0">
                      <LibraryImage
                        src={`/api/theater/items/${episode.id}/image`}
                        alt={episode.name}
                        aspectClassName="aspect-video"
                      />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                        <PlayGlyph />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[10px] text-white/80">
                        {episode.name}
                      </p>
                      {meta && (
                        <p className="truncate text-[8px] text-white/40">
                          {meta}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </>
        )}

        {browse.view === 'queue' && (
          <>
            {queue.length === 0 && (
              <p className="p-2 text-[11px] text-white/50">Queue is empty.</p>
            )}
            <div className="flex flex-col gap-1.5">
              {queue.map((entry, index) => {
                const isCurrent = entry.entryId === currentEntryId
                return (
                  <div
                    key={entry.entryId}
                    className={cns(
                      'flex items-center gap-2 rounded p-1',
                      isCurrent && 'bg-white/15',
                    )}
                  >
                    <div className="w-14 shrink-0">
                      <LibraryImage
                        src={`/api/theater/items/${entry.itemId}/image`}
                        alt={entry.title}
                        aspectClassName="aspect-[2/3]"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <p
                          className={cns(
                            'truncate text-[10px]',
                            isCurrent
                              ? 'font-medium text-white'
                              : 'text-white/80',
                          )}
                        >
                          {entry.title}
                        </p>
                        {isCurrent && (
                          <span className="shrink-0 rounded-full border border-white/40 bg-white/20 px-1 text-[7px] tracking-wide text-white uppercase">
                            Now playing
                          </span>
                        )}
                      </div>
                      {entry.subtitle && (
                        <p className="truncate text-[8px] text-white/40">
                          {entry.subtitle}
                        </p>
                      )}
                      <p className="truncate text-[8px] text-white/30">
                        Added by {entry.addedBy}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label="Move up"
                        onClick={() => {
                          const previousEntry = queue[index - 1]
                          if (previousEntry) {
                            onQueueMove?.(entry.entryId, previousEntry.entryId)
                          }
                        }}
                        className="rounded border border-white/25 px-1 text-[9px] text-white/60 transition hover:border-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={index === queue.length - 1}
                        aria-label="Move down"
                        onClick={() => {
                          const afterNext = queue[index + 2]
                          onQueueMove?.(
                            entry.entryId,
                            afterNext ? afterNext.entryId : null,
                          )
                        }}
                        className="rounded border border-white/25 px-1 text-[9px] text-white/60 transition hover:border-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        ▼
                      </button>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => onQueueJump?.(entry.entryId)}
                        className="rounded-full border border-white/30 bg-white/10 px-2 py-0.5 text-[9px] font-medium text-white transition hover:bg-white/20"
                      >
                        Play
                      </button>
                      <button
                        type="button"
                        onClick={() => onQueueRemove?.(entry.entryId)}
                        className="rounded-full border border-white/25 px-2 py-0.5 text-[9px] text-white/60 transition hover:border-white/50 hover:text-white"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {browse.view === 'player' && (
          <PlayerPage
            nowPlaying={nowPlaying}
            itemId={itemId}
            playing={playing}
            playhead={playhead}
            duration={duration}
            loading={loading}
            error={error}
            volume={volume}
            quality={quality}
            subtitleIndex={subtitleIndex}
            textSubtitles={textSubtitles}
            hasNext={hasNext}
            onSeek={onSeek}
            onPlayPause={onPlayPause}
            onNext={onNext}
            onVolumeChange={onVolumeChange}
            onQualityChange={onQualityChange}
            onSubtitleChange={onSubtitleChange}
          />
        )}
      </div>

      {/* Compact now-playing strip. Every real playback control moved to the
          player page above, so this is only a status line plus two ways in: a
          mini play/pause, and the title itself as the route to the page. Hidden
          while the player page IS the view — it would just duplicate it. */}
      {browse.view !== 'player' && (
        <div className="border-t border-white/10 p-2">
          {itemId === null ? (
            <p className="text-[9px] text-white/40">Pick a title to begin.</p>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPlayPause?.()}
                aria-label={playing ? 'Pause' : 'Play'}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-black transition hover:bg-white/90"
              >
                {playing ? <TransportPauseGlyph /> : <TransportPlayGlyph />}
              </button>
              <button
                type="button"
                onClick={() => onOpenPlayer?.()}
                className="min-w-0 flex-1 text-left transition hover:opacity-80"
              >
                <p className="truncate text-[10px] text-white">
                  {nowPlaying?.title ?? 'Now playing'}
                </p>
                <p className="truncate text-[8px] text-white/40">
                  {formatTimecode(playhead)} / {formatTimecode(duration)}
                  {loading && ' · buffering…'}
                </p>
              </button>
              <span className="shrink-0 text-[9px] text-white/30">›</span>
            </div>
          )}
          {error !== null && (
            <p className="mt-1 text-[9px] text-red-300">{error}</p>
          )}
        </div>
      )}
    </div>
  )
}
