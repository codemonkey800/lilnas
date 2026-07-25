'use client'

import { Html, RoundedBox } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { type UIEvent, useEffect, useRef, useState } from 'react'
import { type Group } from 'three'

import { getSocket } from 'src/multiplayer/store'
import { type QualityTier, usePlaybackStore } from 'src/playback/store'

import {
  type BrowseState,
  IpadBrowserView,
  type TheaterEpisode,
  type TheaterItem,
  type TheaterSeason,
} from './IpadBrowserView'
import { type LibraryTypeFilter } from './libraryFilter'

// ---------------------------------------------------------------------------
// The 3D iPad (PLAN.md D8 / ORCHESTRATE.md "iPad (C1/Q1)"): a procedural
// tablet mesh (no GLB asset exists for this anywhere in the repo) carrying a
// drei <Html transform occlude> poster-grid UI, summoned/dismissed on Tab —
// the key handling itself lives in viewControls.ts; this component only
// reacts to the store's `ipadOpen` boolean.
//
// Split (PLAN.md's "Phase 4C — Tablet presence + UI mirroring" /
// ORCHESTRATE.md §2, unit TF1): this file now owns only input + the
// camera-HUD positioning below — every piece of the <Html> panel's actual
// DOM content (search box, grid, seasons/episodes, playback footer, ...)
// lives in IpadBrowserView.tsx, rendered here with `interactive={true}` and
// every callback wired to the handlers below. That split is what lets a
// later unit (TF3) re-render the exact same panel, read-only, from a REMOTE
// peer's broadcast tablet state instead of this local one. Local behavior is
// unchanged — this file still owns 100% of the input handling and writes to
// usePlaybackStore exactly as before, just via callback props now instead of
// inline JSX handlers.
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

// The poster click is also the required user-gesture for the browser's
// video-autoplay policy (PLAN.md "Gesture") — load() then play() directly
// inside the click handler's own async call, nothing else in between.
async function selectItem(id: string): Promise<void> {
  await usePlaybackStore.getState().load(id)
  usePlaybackStore.getState().play()
}

// ---------------------------------------------------------------------------
// TF2 — broadcast this (local, interactive) tablet's UI state so peers can
// mirror it (PLAN.md "Phase 4C — Tablet presence + UI mirroring" /
// ORCHESTRATE.md §1's `tablet:state` event). Pure addition layered on top of
// state that already lives in this component for other reasons — nothing
// below changes existing rendering, state, or local interactive behavior.
//
// `TabletState` is hand-mirrored here — NOT imported from
// `src/presence/tablet.schema.ts` (the backend zod schema) or from
// `src/multiplayer/store.ts` (which keeps its OWN separate copy of this
// exact shape, for the exact same reason) — matching this app's established
// convention of hand-duplicating wire shapes at each module boundary meant to
// stay independently buildable rather than importing across it (see that
// store's "Keep in sync" comments, and this file's own `TheaterItemType`
// mirroring `emby.service.ts` across the frontend/backend boundary).
// ---------------------------------------------------------------------------

// Keep in sync with src/presence/tablet.schema.ts's `TabletState` /
// ORCHESTRATE.md §1's frozen wire contract.
type TabletState = {
  open: boolean
  view: 'grid' | 'seasons' | 'episodes'
  seriesId: string | null
  seasonId: string | null
  search: string
  typeFilter: LibraryTypeFilter
  scrollTop: number
}

// Derives the wire payload from local state. Shared by both emit sites below
// (the discrete-field change effect and the throttled scroll handler) so a
// given field is only ever computed one way.
function buildTabletState(
  ipadOpen: boolean,
  browse: BrowseState,
  search: string,
  typeFilter: LibraryTypeFilter,
  scrollTop: number,
): TabletState {
  return {
    open: ipadOpen,
    view: browse.view,
    seriesId: browse.view !== 'grid' ? browse.series.id : null,
    seasonId: browse.view === 'episodes' ? browse.season.id : null,
    search,
    typeFilter,
    scrollTop,
  }
}

// Flat field-by-field compare — cheaper and more explicit than
// JSON.stringify for a shape this small and flat — so a redundant emit can be
// skipped when nothing actually changed ("silent when nothing changed",
// PLAN.md).
function tabletStatesEqual(a: TabletState, b: TabletState): boolean {
  return (
    a.open === b.open &&
    a.view === b.view &&
    a.seriesId === b.seriesId &&
    a.seasonId === b.seasonId &&
    a.search === b.search &&
    a.typeFilter === b.typeFilter &&
    a.scrollTop === b.scrollTop
  )
}

// Throttle window for the scroll-triggered broadcast below (PLAN.md:
// "throttled ~10 Hz while open").
const SCROLL_EMIT_INTERVAL_MS = 100

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

  // The one flat, nullable view of the `browse` union this file still needs
  // directly (handleSeasonClick's state transition below) — see
  // IpadBrowserView.tsx's identical derivation (and its fuller comment) for
  // everything the *rendering* side needs from this same union.
  const browsingSeries = browse.view === 'grid' ? null : browse.series

  const groupRef = useRef<Group>(null)
  const opennessRef = useRef(0)
  const domVisibleRef = useRef(false)
  const [domVisible, setDomVisible] = useState(false)

  // TF2 broadcast bookkeeping — refs only, never React state: the scroll
  // handler below can fire far more often than the ~100ms throttle window,
  // so gating and de-duplication must not themselves trigger a re-render.
  // `scrollTopRef` is the latest known scroll position (updated on every
  // scroll tick regardless of throttling) so the change-effect below can
  // fold it into a fresh payload even when scroll isn't what triggered it.
  const scrollTopRef = useRef(0)
  const lastSentTabletStateRef = useRef<TabletState | null>(null)
  const lastScrollEmitAtRef = useRef(0)

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

  // Broadcast on any change to the fields that define what's on screen
  // (PLAN.md: "immediately on any change"). Deliberately NOT gated on
  // `ipadOpen` — `open` is itself one of the watched/sent fields below, so
  // the close transition (ipadOpen flipping to false) still runs this
  // effect and tells peers the tablet closed; the throttled SCROLL
  // broadcast (handleScroll, below) is separately inert while closed since
  // its DOM listener isn't mounted then (domVisible gates the <Html>).
  useEffect(() => {
    const next = buildTabletState(
      ipadOpen,
      browse,
      search,
      typeFilter,
      scrollTopRef.current,
    )
    const last = lastSentTabletStateRef.current
    if (last && tabletStatesEqual(last, next)) {
      return
    }
    lastSentTabletStateRef.current = next
    getSocket()?.emit('tablet:state', next)
  }, [ipadOpen, browse, search, typeFilter])

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

  function handleSeasonClick(season: TheaterSeason): void {
    if (browsingSeries) {
      setBrowse({ view: 'episodes', series: browsingSeries, season })
    }
  }

  function handleEpisodeClick(episode: TheaterEpisode): void {
    void selectItem(episode.id)
  }

  function handlePlayPause(): void {
    if (playing) {
      usePlaybackStore.getState().pause()
    } else {
      usePlaybackStore.getState().play()
    }
  }

  function handleVolumeChange(nextVolume: number): void {
    usePlaybackStore.getState().setVolume(nextVolume)
  }

  function handleQualityChange(nextQuality: QualityTier): void {
    usePlaybackStore.getState().setQuality(nextQuality)
  }

  function handleSubtitleChange(index: number | null): void {
    usePlaybackStore.getState().setSubtitle(index)
  }

  // Throttled scroll broadcast (~10 Hz, PLAN.md). `onScrollCapture` on the
  // wrapper <div> below fires on React's capture phase for a descendant's
  // native `scroll` event even though `scroll` itself doesn't bubble — see
  // that div's own comment. This can fire far more often than the throttle
  // window, so the elapsed-time gate is an inline ref-timestamp check here,
  // not a useEffect/state round-trip. Reads `event.target`, NOT
  // `event.currentTarget`: the element that actually scrolled is a
  // descendant scroll container inside IpadBrowserView, not this wrapper
  // div itself.
  function handleScroll(event: UIEvent<HTMLDivElement>): void {
    const scrollTop = (event.target as HTMLElement).scrollTop
    scrollTopRef.current = scrollTop

    const now = Date.now()
    if (now - lastScrollEmitAtRef.current < SCROLL_EMIT_INTERVAL_MS) {
      return
    }
    lastScrollEmitAtRef.current = now

    const next = buildTabletState(
      ipadOpen,
      browse,
      search,
      typeFilter,
      scrollTop,
    )
    lastSentTabletStateRef.current = next
    getSocket()?.emit('tablet:state', next)
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
              here rather than depending on a change to that other file. This
              wrapper div is deliberately kept in THIS file (rather than
              folded into IpadBrowserView's own root) — it's HUD-sizing/
              pointer-lock-guard plumbing, not view-rendering, and it's also
              the one DOM node outside IpadBrowserView.tsx that TF2's
              `handleScroll` below attaches to via `onScrollCapture`: a
              native `scroll` event on the actual scrollable container deep
              inside IpadBrowserView doesn't bubble, but React's capture
              phase still reaches an ancestor listener for it. */}
          <div
            onClick={event => event.stopPropagation()}
            onScrollCapture={handleScroll}
            style={{ width: HTML_WIDTH_PX, height: HTML_HEIGHT_PX }}
          >
            <IpadBrowserView
              interactive={true}
              items={items}
              itemsLoading={itemsLoading}
              itemsError={itemsError}
              search={search}
              typeFilter={typeFilter}
              browse={browse}
              seasons={seasons}
              seasonsLoading={seasonsLoading}
              seasonsError={seasonsError}
              episodes={episodes}
              episodesLoading={episodesLoading}
              episodesError={episodesError}
              itemId={itemId}
              playing={playing}
              volume={volume}
              quality={quality}
              subtitleIndex={subtitleIndex}
              subtitles={subtitles}
              loading={loading}
              error={error}
              onSearchChange={setSearch}
              onTypeFilterChange={setTypeFilter}
              onItemClick={handleItemClick}
              onBack={handleBack}
              onSeasonClick={handleSeasonClick}
              onEpisodeClick={handleEpisodeClick}
              onPlayPause={handlePlayPause}
              onVolumeChange={handleVolumeChange}
              onQualityChange={handleQualityChange}
              onSubtitleChange={handleSubtitleChange}
            />
          </div>
        </Html>
      )}
    </group>
  )
}
