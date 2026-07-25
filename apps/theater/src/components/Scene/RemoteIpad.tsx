'use client'

import { Html, RoundedBox } from '@react-three/drei'
import { useEffect, useState } from 'react'

import { useMultiplayerStore } from 'src/multiplayer/store'

import {
  type BrowseState,
  IpadBrowserView,
  type TheaterEpisode,
  type TheaterItem,
  type TheaterSeason,
} from './IpadBrowserView'

// Fills the F4-created stub -- RemoteAvatars.tsx already mounts
// `<RemoteIpad id={id} />` inside <RemoteAvatar>'s interpolated <group> and
// is never touched by this unit (ORCHESTRATE.md §2/§6's stub-handoff rule).
//
// PLAN.md's Phase 4C / TF3: a world-space tablet that mirrors a PEER's own
// tablet nav state (open/grid/seasons/episodes, search, type filter, scroll)
// by re-rendering the same presentational panel the local, interactive
// tablet uses (`IpadBrowserView`, TF1) with `interactive={false}` -- so it
// can never become a control surface for whoever is looking at someone
// else's tablet.
//
// The wire payload (`TabletState`, multiplayer/store.ts's `peerTablets`)
// only carries bare `seriesId`/`seasonId` strings, never full
// `TheaterItem`/`TheaterSeason` objects -- so `IpadBrowserView`'s `browse`
// prop (which needs real objects for names/art) has to be reconstructed
// here. There's no shared fetch hook to reuse (`IpadBrowser.tsx` doesn't
// export its fetching logic, and it isn't this unit's file to import from
// anyway), so this component runs its OWN independent copy of that same
// fetch pattern -- same endpoints, same shapes -- driven by the PEER's ids
// instead of local UI state.

type RemoteIpadProps = {
  id: string
}

// Mirrors IpadBrowser.tsx's own constants of the same name (that file
// doesn't export them -- hand-duplicated per this app's established
// cross-file-constant convention; see this unit's task description).
const TABLET_WIDTH = 0.78
const TABLET_HEIGHT = 0.52
const TABLET_DEPTH = 0.02
const TABLET_RADIUS = 0.018
const HTML_WIDTH_PX = 640
const HTML_HEIGHT_PX = 400
const HTML_SCALE = 0.04375
const HTML_FRONT_OFFSET = 0.001 // just off the tablet's front face

// Local-space placement inside <RemoteAvatar>'s already-positioned/rotated
// <group> (RemoteAvatars.tsx) -- roughly chest/hand height, held slightly
// forward and off-centre, angled outward so the screen faces whoever the
// peer is standing in front of rather than straight into their own chest.
// No live browser to verify against, so -- per this app's established
// convention for that situation (see IpadBrowser.tsx's own
// RESTING_*_OFFSET comments) -- this is an eyeballed starting point for a
// later manual tuning pass, not a measured fit.
const LOCAL_POSITION: [number, number, number] = [0.25, 1.0, 0.15]
const LOCAL_ROTATION: [number, number, number] = [0, -0.4, 0]

function describeFetchError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export function RemoteIpad({ id }: RemoteIpadProps) {
  const tablet = useMultiplayerStore(state => state.peerTablets[id])

  const view = tablet?.view ?? 'grid'
  const seriesId = tablet?.seriesId ?? null
  const seasonId = tablet?.seasonId ?? null

  const [items, setItems] = useState<TheaterItem[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState<string | null>(null)

  const [seasons, setSeasons] = useState<TheaterSeason[]>([])
  const [seasonsLoading, setSeasonsLoading] = useState(false)
  const [seasonsError, setSeasonsError] = useState<string | null>(null)

  const [episodes, setEpisodes] = useState<TheaterEpisode[]>([])
  const [episodesLoading, setEpisodesLoading] = useState(false)
  const [episodesError, setEpisodesError] = useState<string | null>(null)

  // Library grid data -- fetched once on mount, independently of
  // IpadBrowser.tsx's own identically-shaped effect (no shared fetch hook
  // exists; see the file banner above). Needed to resolve the `TheaterItem`
  // behind whatever bare `seriesId` this peer is browsing.
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

  // Seasons for whichever series the peer is browsing -- mirrors
  // IpadBrowser.tsx's `loadSeasons` cancellable-effect shape, keyed on the
  // PEER's `seriesId` instead of local browse state. Gated on the id
  // actually resolving to a known item first, so a stale/bogus id (the peer
  // moved on before `items` finished loading, or a transient mismatch)
  // never fires a request for a series that doesn't exist -- re-runs
  // automatically once `items` itself finishes loading, since it's a
  // dependency here too.
  useEffect(() => {
    if ((view !== 'seasons' && view !== 'episodes') || seriesId === null) {
      return
    }
    // Captured into a plain local before the nested async function reads
    // it, mirroring IpadBrowser.tsx's own `loadSeasons` effect -- the same
    // defensive reasoning that file documents for `browse.series.id`.
    const currentSeriesId = seriesId
    const matchedSeries = items.find(item => item.id === currentSeriesId)
    if (!matchedSeries) {
      return
    }
    let cancelled = false

    async function loadSeasons(): Promise<void> {
      setSeasonsLoading(true)
      setSeasonsError(null)
      try {
        const response = await fetch(
          `/api/theater/items/${encodeURIComponent(currentSeriesId)}/seasons`,
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
  }, [view, seriesId, items])

  // Episodes for whichever season the peer is browsing -- same shape again,
  // gated on the season id resolving within the seasons this component has
  // already fetched.
  useEffect(() => {
    if (view !== 'episodes' || seriesId === null || seasonId === null) {
      return
    }
    const currentSeriesId = seriesId
    const currentSeasonId = seasonId
    const matchedSeason = seasons.find(season => season.id === currentSeasonId)
    if (!matchedSeason) {
      return
    }
    let cancelled = false

    async function loadEpisodes(): Promise<void> {
      setEpisodesLoading(true)
      setEpisodesError(null)
      try {
        const response = await fetch(
          `/api/theater/items/${encodeURIComponent(currentSeriesId)}/episodes?seasonId=${encodeURIComponent(currentSeasonId)}`,
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
  }, [view, seriesId, seasonId, seasons])

  if (tablet === undefined || !tablet.open) {
    // PLAN.md's Phase 4C / TF3: "renders nothing while open is false".
    return null
  }

  // Reconstructs the full `BrowseState` IpadBrowserView needs (real
  // `TheaterItem`/`TheaterSeason` objects, for names/art) from the bare ids
  // the wire payload carries. Falls back to the grid view -- rather than
  // building an invalid/partial state -- whenever the referenced
  // series/season hasn't resolved yet (still loading, or a transient race
  // where the peer has already navigated on by the time a fetch lands).
  const series =
    seriesId === null ? undefined : items.find(item => item.id === seriesId)
  const season =
    seasonId === null ? undefined : seasons.find(s => s.id === seasonId)

  let browse: BrowseState = { view: 'grid' }
  if (tablet.view === 'seasons' && series) {
    browse = { view: 'seasons', series }
  } else if (tablet.view === 'episodes' && series && season) {
    browse = { view: 'episodes', series, season }
  }

  return (
    <group position={LOCAL_POSITION} rotation={LOCAL_ROTATION}>
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

      {/* `interactive={false}` puts `pointer-events-none` on
          IpadBrowserView's own root, so -- unlike IpadBrowser.tsx's local,
          interactive tablet -- this DOM node never becomes a click target
          and needs no stopPropagation guard against the Scene's
          pointer-lock-on-click handler. */}
      <Html
        transform
        occlude
        position={[0, 0, HTML_FRONT_OFFSET]}
        scale={HTML_SCALE}
      >
        <div style={{ width: HTML_WIDTH_PX, height: HTML_HEIGHT_PX }}>
          <IpadBrowserView
            interactive={false}
            items={items}
            itemsLoading={itemsLoading}
            itemsError={itemsError}
            search={tablet.search}
            typeFilter={tablet.typeFilter}
            browse={browse}
            seasons={seasons}
            seasonsLoading={seasonsLoading}
            seasonsError={seasonsError}
            episodes={episodes}
            episodesLoading={episodesLoading}
            episodesError={episodesError}
            // Playback-transport props belong to the Phase-5 video-sync
            // boundary, not this unit (PLAN.md's Phase 4C "Boundary with
            // Phase 5": tablet mirroring carries navigation only, never
            // playback transport). Inert placeholders render
            // IpadBrowserView's "Pick a title to begin" footer state --
            // never an attempt to mirror a peer's real playback, which
            // deliberately isn't wired yet.
            itemId={null}
            playing={false}
            volume={0}
            quality="auto"
            subtitleIndex={null}
            subtitles={[]}
            loading={false}
            error={null}
            scrollTop={tablet.scrollTop}
          />
        </div>
      </Html>
    </group>
  )
}
