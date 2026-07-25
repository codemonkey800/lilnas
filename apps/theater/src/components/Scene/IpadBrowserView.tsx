'use client'

import { cns } from '@lilnas/utils/cns'
import { useEffect, useRef, useState } from 'react'

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

const TICKS_PER_MINUTE = 10_000_000 * 60 // Emby ticks (100ns units) per minute

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
export type BrowseState =
  | { view: 'grid' }
  | { view: 'seasons'; series: TheaterItem }
  | { view: 'episodes'; series: TheaterItem; season: TheaterSeason }

const TYPE_FILTER_OPTIONS: { value: LibraryTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'series', label: 'Shows' },
]

const QUALITY_OPTIONS: { tier: QualityTier; label: string }[] = [
  { tier: 'auto', label: 'Auto' },
  { tier: '1080p', label: '1080p' },
  { tier: '720p', label: '720p' },
  { tier: '480p', label: '480p' },
  { tier: 'datasaver', label: 'Data saver' },
]

function formatRuntime(ticks: number | null): string | null {
  if (ticks === null) {
    return null
  }
  const totalMinutes = Math.round(ticks / TICKS_PER_MINUTE)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

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
  const browsingSeries = browse.view === 'grid' ? null : browse.series
  const browsingSeason = browse.view === 'episodes' ? browse.season : null

  const textSubtitles = subtitles.filter(track => track.isText)
  const filteredItems = filterLibraryItems(items, search, typeFilter)

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
          Library
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
            {browsingSeries?.name}
            {browsingSeason ? ` · ${browsingSeason.name}` : ''}
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
      </div>

      <div className="space-y-1.5 border-t border-white/10 p-2">
        {itemId === null ? (
          <p className="text-[9px] text-white/40">Pick a title to begin.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPlayPause?.()}
                className="shrink-0 rounded-full border border-white/30 bg-white/10 px-3 py-1 text-[10px] font-medium text-white transition hover:bg-white/20"
              >
                {playing ? 'Pause' : 'Play'}
              </button>
              <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[9px] text-white/50">
                <span className="tracking-wide uppercase">Vol</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={event =>
                    onVolumeChange?.(Number(event.target.value))
                  }
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
          </>
        )}

        {loading && (
          <p className="flex items-center gap-1.5 text-[9px] text-white/50">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/60" />
            Buffering…
          </p>
        )}
        {error && <p className="text-[9px] text-red-300">{error}</p>}
      </div>
    </div>
  )
}
