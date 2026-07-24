'use client'

import { cns } from '@lilnas/utils/cns'
import { Html, RoundedBox } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { type Group } from 'three'

import { type QualityTier, usePlaybackStore } from 'src/playback/store'

import { filterLibraryItems, type LibraryTypeFilter } from './libraryFilter'

// ---------------------------------------------------------------------------
// The 3D iPad (PLAN.md D8 / ORCHESTRATE.md "iPad (C1/Q1)"): a procedural
// tablet mesh (no GLB asset exists for this anywhere in the repo) carrying a
// drei <Html transform occlude> poster-grid UI, summoned/dismissed on Tab —
// the key handling itself lives in viewControls.ts; this component only
// reacts to the store's `ipadOpen` boolean.
//
// Positioning ("parent it to the camera", PLAN.md D8): rather than literally
// reparenting into THREE.Camera's own Object3D subtree (which complicates
// drei's <Html> raycasting/occlusion against the rest of the scene), this
// uses the idiomatic R3F "HUD" pattern — copy the camera's world position/
// quaternion onto a plain <group> every frame, then nudge it forward/down by
// a fixed local offset. Because the group's quaternion always matches the
// camera's, the camera ends up sitting along the group's local +Z axis every
// frame, so a face with no added rotation (the default "outward normal along
// +Z" convention for a box/plane front face) always faces the player,
// however they're currently looking.
//
// Summon/dismiss animation: no animation library is installed here (no
// @react-spring/three, no framer-motion) — a manual "openness" value
// (0 = fully hidden, 1 = fully in view), advanced every frame toward
// `ipadOpen ? 1 : 0`, drives both an extra hide-offset (further down, off-
// screen-bottom) and a scale-in "pop" flourish. Below a small threshold the
// <Html> panel unmounts entirely (not just visually hidden) so an idle,
// off-screen tablet never leaves an invisible-but-interactive DOM overlay
// sitting in front of the camera.
// ---------------------------------------------------------------------------

// Procedural tablet body dimensions — a simple dark rounded box, not a
// loaded model. Sized so the HTML panel below (0.70 x ~0.44 world units)
// sits inside this body with a visible ~0.04m bezel on every side — at the
// previous 0.52 x 0.34 body, the panel (0.528 x 0.36) was actually *larger*
// than the tablet on both axes, leaving next to no visible bezel at all.
const TABLET_WIDTH = 0.78
const TABLET_HEIGHT = 0.52
const TABLET_DEPTH = 0.02
const TABLET_RADIUS = 0.018

// HUD placement, camera-relative — applied via translateZ/translateY after
// copying the camera's transform onto the group each frame (see file banner
// above). RESTING_FORWARD_OFFSET is deliberately left unchanged rather than
// pushed farther out to avoid clipping the taller body: apparent on-screen
// size is dimension/distance, so increasing distance to dodge clipping would
// cancel out most of the size increase this resize is for. Instead
// RESTING_DOWN_OFFSET comes down from 0.32 — at fov=75 (vertical) and this
// forward distance, the visible half-height is 0.6*tan(37.5deg) ≈ 0.46, and
// the new taller body's bottom edge (0.18 + 0.52/2 = 0.44) sits inside that
// with a small margin, vs. the old body which was already marginally
// clipping (0.32 + 0.34/2 = 0.49 > 0.46). Horizontal fit was NOT
// independently re-verified — three.js's `fov` is vertical-only, so
// horizontal extent depends on the canvas's aspect ratio, which isn't known
// at code time. Like the original constants below, this is a best-effort,
// eyeballed pass — nobody can visually confirm the exact fit without a live
// browser (this app's own convention is not to boot one for this kind of
// check; a manual tuning pass is the follow-up).
const RESTING_FORWARD_OFFSET = 0.6 // meters in front of the camera, always
const RESTING_DOWN_OFFSET = 0.18 // meters below eye height once fully open
const HIDDEN_DROP_OFFSET = 0.55 // extra drop stacked on top while closed
const MIN_SCALE = 0.6 // scale at fully-closed — a "pop in" flourish only

// Manual open/close lerp: `openness += (target - openness) * delta * RATE`,
// clamped every step. Below this threshold the <Html> content unmounts.
const OPEN_CLOSE_RATE = 8
const VISIBLE_OPENNESS_EPSILON = 0.02

// drei's <Html transform>: with the default (unset) `distanceFactor` (=10
// internally), 1 world unit renders as `400 / 10 = 40` CSS px at `scale={1}`
// — i.e. `scale = worldSize * 40 / pxSize`. Sized up from 440x300 (see
// TABLET_WIDTH's comment above for the bezel reasoning) — still an eyeballed
// starting point, not a live-browser-verified fit.
const HTML_WIDTH_PX = 640
const HTML_HEIGHT_PX = 400
const HTML_SCALE = 0.04375
const HTML_FRONT_OFFSET = 0.001 // just off the tablet's front face

const TICKS_PER_MINUTE = 10_000_000 * 60 // Emby ticks (100ns units) per minute

// Shape of `GET /theater/items` (ORCHESTRATE.md § "Backend endpoints",
// matching `src/emby/emby.service.ts`'s `TheaterItemDto`) — not exported
// anywhere shared, so inlined here. `type` has to be kept in sync with that
// backend DTO by hand.
type TheaterItemType = 'movie' | 'series'

type TheaterItem = {
  id: string
  name: string
  type: TheaterItemType
  year: number | null
  overview: string | null
  runTimeTicks: number | null
  imageTag: string | null
}

// Mirrors `TheaterSeasonDto`/`TheaterEpisodeDto` in `emby.service.ts`.
type TheaterSeason = {
  id: string
  name: string
  indexNumber: number | null
}

type TheaterEpisode = {
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
// unrepresentable. Render code derives flat nullable `browsingSeries`/
// `browsingSeason` values from this once (see below) rather than
// re-narrowing the union at every use site.
type BrowseState =
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Mirrors `describeError` in `src/playback/store.ts` — duplicated (not
// imported; that helper isn't exported) so this component stays
// self-contained, the same reasoning `FullscreenPlayer.tsx` uses for
// duplicating store.ts's hidden-video styling.
function describeFetchError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

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

// The poster click is also the required user-gesture for the browser's
// video-autoplay policy (PLAN.md "Gesture") — load() then play() directly
// inside the click handler's own async call, nothing else in between.
async function selectItem(id: string): Promise<void> {
  await usePlaybackStore.getState().load(id)
  usePlaybackStore.getState().play()
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

export function IpadBrowser() {
  const camera = useThree(state => state.camera)

  const ipadOpen = usePlaybackStore(state => state.ipadOpen)
  const itemId = usePlaybackStore(state => state.itemId)
  const playing = usePlaybackStore(state => state.playing)
  const volume = usePlaybackStore(state => state.volume)
  const quality = usePlaybackStore(state => state.quality)
  const subtitleIndex = usePlaybackStore(state => state.subtitleIndex)
  const subtitles = usePlaybackStore(state => state.subtitles)
  const loading = usePlaybackStore(state => state.loading)
  const error = usePlaybackStore(state => state.error)

  const [items, setItems] = useState<TheaterItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<LibraryTypeFilter>('all')

  const [browse, setBrowse] = useState<BrowseState>({ view: 'grid' })
  const [seasons, setSeasons] = useState<TheaterSeason[]>([])
  const [seasonsLoading, setSeasonsLoading] = useState(false)
  const [seasonsError, setSeasonsError] = useState<string | null>(null)
  const [episodes, setEpisodes] = useState<TheaterEpisode[]>([])
  const [episodesLoading, setEpisodesLoading] = useState(false)
  const [episodesError, setEpisodesError] = useState<string | null>(null)

  // Flat, always-nullable views of the union above — used throughout render
  // instead of re-narrowing `browse` at every JSX use site (narrowing a
  // discriminated union doesn't reliably survive into nested closures, e.g.
  // an inline onClick, without re-checking `.view` again there too).
  const browsingSeries = browse.view === 'grid' ? null : browse.series
  const browsingSeason = browse.view === 'episodes' ? browse.season : null

  const groupRef = useRef<Group>(null)
  const opennessRef = useRef(0)
  const domVisibleRef = useRef(false)
  const [domVisible, setDomVisible] = useState(false)

  // Poster grid data — fetched once on mount (simplest option; this
  // component is always mounted going forward). The <img> requests
  // themselves only start once the panel first actually renders into the
  // DOM (gated on `domVisible` below), so opening the tablet before this
  // resolves just shows the loading state briefly.
  useEffect(() => {
    let cancelled = false

    async function loadItems(): Promise<void> {
      setItemsLoading(true)
      setItemsError(null)
      try {
        const response = await fetch('/api/theater/items')
        if (!response.ok) {
          throw new Error(`Failed to load library (${response.status})`)
        }
        const data = (await response.json()) as TheaterItem[]
        if (!cancelled) {
          setItems(data)
        }
      } catch (err) {
        if (!cancelled) {
          setItemsError(describeFetchError(err, 'Failed to load library'))
        }
      } finally {
        if (!cancelled) {
          setItemsLoading(false)
        }
      }
    }

    void loadItems()
    return () => {
      cancelled = true
    }
  }, [])

  // Seasons for whichever series is being browsed — mirrors `loadItems`'s
  // cancellable-effect shape above. Captures the series id into a plain
  // local before the nested async function reads it, rather than relying on
  // the union-narrowing above (`browse.view === 'seasons'`) to propagate
  // into that nested closure.
  useEffect(() => {
    if (browse.view !== 'seasons') {
      return
    }
    const seriesId = browse.series.id
    let cancelled = false

    async function loadSeasons(): Promise<void> {
      setSeasonsLoading(true)
      setSeasonsError(null)
      try {
        const response = await fetch(
          `/api/theater/items/${encodeURIComponent(seriesId)}/seasons`,
        )
        if (!response.ok) {
          throw new Error(`Failed to load seasons (${response.status})`)
        }
        const data = (await response.json()) as TheaterSeason[]
        if (!cancelled) {
          setSeasons(data)
        }
      } catch (err) {
        if (!cancelled) {
          setSeasonsError(describeFetchError(err, 'Failed to load seasons'))
        }
      } finally {
        if (!cancelled) {
          setSeasonsLoading(false)
        }
      }
    }

    void loadSeasons()
    return () => {
      cancelled = true
    }
  }, [browse])

  // Episodes for whichever season is selected — same shape again.
  useEffect(() => {
    if (browse.view !== 'episodes') {
      return
    }
    const seriesId = browse.series.id
    const seasonId = browse.season.id
    let cancelled = false

    async function loadEpisodes(): Promise<void> {
      setEpisodesLoading(true)
      setEpisodesError(null)
      try {
        const response = await fetch(
          `/api/theater/items/${encodeURIComponent(seriesId)}/episodes?seasonId=${encodeURIComponent(seasonId)}`,
        )
        if (!response.ok) {
          throw new Error(`Failed to load episodes (${response.status})`)
        }
        const data = (await response.json()) as TheaterEpisode[]
        if (!cancelled) {
          setEpisodes(data)
        }
      } catch (err) {
        if (!cancelled) {
          setEpisodesError(describeFetchError(err, 'Failed to load episodes'))
        }
      } finally {
        if (!cancelled) {
          setEpisodesLoading(false)
        }
      }
    }

    void loadEpisodes()
    return () => {
      cancelled = true
    }
  }, [browse])

  useFrame((_state, delta) => {
    const group = groupRef.current
    if (!group) {
      return
    }

    const target = ipadOpen ? 1 : 0
    const rate = clamp(delta * OPEN_CLOSE_RATE, 0, 1)
    const openness = clamp(
      opennessRef.current + (target - opennessRef.current) * rate,
      0,
      1,
    )
    opennessRef.current = openness

    group.position.copy(camera.position)
    group.quaternion.copy(camera.quaternion)
    group.translateZ(-RESTING_FORWARD_OFFSET)
    group.translateY(-RESTING_DOWN_OFFSET - (1 - openness) * HIDDEN_DROP_OFFSET)
    group.scale.setScalar(MIN_SCALE + (1 - MIN_SCALE) * openness)

    const visible = openness > VISIBLE_OPENNESS_EPSILON
    group.visible = visible
    if (visible !== domVisibleRef.current) {
      domVisibleRef.current = visible
      setDomVisible(visible)
    }
  })

  const textSubtitles = subtitles.filter(track => track.isText)
  const filteredItems = filterLibraryItems(items, search, typeFilter)

  function handleItemClick(item: TheaterItem): void {
    if (item.type === 'movie') {
      void selectItem(item.id)
      return
    }
    setBrowse({ view: 'seasons', series: item })
  }

  function handleBack(): void {
    if (browse.view === 'episodes') {
      setBrowse({ view: 'seasons', series: browse.series })
      return
    }
    setBrowse({ view: 'grid' })
  }

  return (
    <group ref={groupRef}>
      <RoundedBox
        args={[TABLET_WIDTH, TABLET_HEIGHT, TABLET_DEPTH]}
        radius={TABLET_RADIUS}
        smoothness={4}
        position={[0, 0, -TABLET_DEPTH / 2]}
      >
        <meshStandardMaterial
          color="#141418"
          roughness={0.4}
          metalness={0.2}
          emissive="#0a0a0d"
          emissiveIntensity={0.4}
        />
      </RoundedBox>

      {domVisible && (
        <Html
          transform
          occlude
          position={[0, 0, HTML_FRONT_OFFSET]}
          scale={HTML_SCALE}
        >
          {/* Native DOM events still bubble through the real DOM regardless
              of which React root rendered them (drei mounts <Html> via its
              own ReactDOM.createRoot) — Scene.tsx wraps the <Canvas> in a
              click handler that (re)requests pointer lock, so without this
              stopPropagation a poster/picker click would immediately re-lock
              the pointer while the tablet is still open. Kept self-contained
              here rather than depending on a change to that other file. */}
          <div
            onClick={event => event.stopPropagation()}
            style={{ width: HTML_WIDTH_PX, height: HTML_HEIGHT_PX }}
            className={cns(
              'flex flex-col overflow-hidden rounded-2xl border border-white/15',
              'bg-black/90 text-white shadow-2xl backdrop-blur',
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
                  onChange={event => setSearch(event.target.value)}
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
                      onClick={() => setTypeFilter(option.value)}
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
                  onClick={handleBack}
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

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {browse.view === 'grid' && (
                <>
                  {itemsLoading && (
                    <p className="p-2 text-[11px] text-white/50">
                      Loading titles…
                    </p>
                  )}
                  {itemsError && (
                    <p className="p-2 text-[11px] text-red-300">{itemsError}</p>
                  )}
                  {!itemsLoading &&
                    !itemsError &&
                    filteredItems.length === 0 && (
                      <p className="p-2 text-[11px] text-white/50">
                        No titles found.
                      </p>
                    )}

                  <div className="grid grid-cols-4 gap-2">
                    {filteredItems.map(item => {
                      const meta = formatItemMeta(item)
                      return (
                        <button
                          key={item.id}
                          type="button"
                          title={item.overview ?? undefined}
                          onClick={() => handleItemClick(item)}
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
                    <p className="p-2 text-[11px] text-white/50">
                      Loading seasons…
                    </p>
                  )}
                  {seasonsError && (
                    <p className="p-2 text-[11px] text-red-300">
                      {seasonsError}
                    </p>
                  )}
                  {!seasonsLoading && !seasonsError && seasons.length === 0 && (
                    <p className="p-2 text-[11px] text-white/50">
                      No seasons found.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    {seasons.map(season => (
                      <button
                        key={season.id}
                        type="button"
                        onClick={() => {
                          if (browsingSeries) {
                            setBrowse({
                              view: 'episodes',
                              series: browsingSeries,
                              season,
                            })
                          }
                        }}
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
                    <p className="p-2 text-[11px] text-white/50">
                      Loading episodes…
                    </p>
                  )}
                  {episodesError && (
                    <p className="p-2 text-[11px] text-red-300">
                      {episodesError}
                    </p>
                  )}
                  {!episodesLoading &&
                    !episodesError &&
                    episodes.length === 0 && (
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
                          onClick={() => void selectItem(episode.id)}
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
                <p className="text-[9px] text-white/40">
                  Pick a title to begin.
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        playing
                          ? usePlaybackStore.getState().pause()
                          : usePlaybackStore.getState().play()
                      }
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
                          usePlaybackStore
                            .getState()
                            .setVolume(Number(event.target.value))
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
                          onClick={() =>
                            usePlaybackStore.getState().setQuality(option.tier)
                          }
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
                        onClick={() =>
                          usePlaybackStore.getState().setSubtitle(null)
                        }
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
                          onClick={() =>
                            usePlaybackStore.getState().setSubtitle(track.index)
                          }
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
        </Html>
      )}
    </group>
  )
}
