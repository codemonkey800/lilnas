'use client'

import Hls from 'hls.js'
import { create } from 'zustand'

// ---------------------------------------------------------------------------
// The playback controller: a singleton shared <video> + hls.js instance,
// exposed through a zustand store, per ORCHESTRATE.md's "zustand store
// (`src/playback/store.ts`) — v5 API" contract. Everything else (the in-world
// screen texture, the fullscreen player, the iPad, spatial audio) reads and
// commands playback exclusively through this store — that indirection is
// also the seam a later phase's multiplayer gateway plugs into without a
// component rewrite (see PLAN.md "Multiplayer video sync").
//
// Anchor model: `playing`/`playheadAtAnchor`/`anchorClockMs` describe the
// intended playback position, not a per-frame snapshot of it — the actual
// playhead is always *derived* (`getTargetPlayhead`/`tick`). Single-player,
// the anchor is set locally by play()/pause()/seek(); a future gateway would
// instead drive it via `applyAnchor()`.
//
// Singletons are created lazily (`ensureVideoElement`/`ensureHls`), never at
// module-eval time — this module is imported by 'use client' components that
// Next.js still module-evaluates during SSR/RSC rendering, where `document`/
// `window` don't exist.
// ---------------------------------------------------------------------------

export type ViewMode = 'pov' | 'fullscreen'

export type QualityTier = 'auto' | '1080p' | '720p' | '480p' | 'datasaver'

export type SubtitleTrack = {
  index: number
  lang: string
  label: string
  isText: boolean
  mediaSourceId: string
}

export type AudioTrack = {
  index: number
  lang: string
  label: string
}

export type PlaybackStore = {
  // identity / source
  itemId: string | null
  mode: 'direct' | 'hls' | null
  playSessionId: string | null
  videoAspect: number // from loadedmetadata; default 16/9
  duration: number

  // transport — ANCHOR MODEL (sync-ready; playhead is DERIVED, never stored
  // per-frame)
  playing: boolean
  playheadAtAnchor: number // seconds into video at the anchor
  anchorClockMs: number // performance.now() when the anchor was set

  // view + ui
  view: ViewMode
  ipadOpen: boolean
  loading: boolean
  error: string | null

  // client-local prefs (NEVER synced in P5)
  quality: QualityTier
  subtitleIndex: number | null // null = off
  subtitles: SubtitleTrack[]
  audioTracks: AudioTrack[]
  audioIndex: number | null
  volume: number // 0..1, POV spatial-audio gain — client-local, same as quality/subtitleIndex

  // command API (the P5 gateway seam — all mutations go through here)
  load: (id: string) => Promise<void>
  play: () => void
  pause: () => void
  seek: (t: number) => void
  setView: (v: ViewMode) => void
  setIpadOpen: (open: boolean) => void
  setQuality: (q: QualityTier) => void
  setSubtitle: (index: number | null) => void
  setVolume: (v: number) => void
  applyAnchor: (a: {
    playing: boolean
    playhead: number
    atClockMs: number
  }) => void

  // integration helpers
  getVideoElement: () => HTMLVideoElement
  getTargetPlayhead: () => number
  tick: (nowMs: number) => void // reconcile loop; called each frame from useFrame
}

// Raw shape of `GET /theater/playback/:id` (ORCHESTRATE.md § "Backend
// endpoints"). The backend doesn't land until Wave 2 — this is only the
// client's half of the contract, so it's asserted rather than validated
// against a shared zod schema (`emby.schema.ts` doesn't exist yet).
type PlaybackResponse = {
  mode: 'direct' | 'hls'
  url: string
  playSessionId: string | null
  durationTicks: number
  subtitles: SubtitleTrack[]
  audioTracks: AudioTrack[]
}

type PlaybackQueryParams = {
  maxBitrate: number | null
  audioIndex: number | null
  subtitleIndex: number | null
  // Only supplied when resuming in place (a quality/subtitle switch) — tells
  // the backend where to start a fresh HLS transcode so playback doesn't
  // restart at 0 (PLAN.md: "pass startTicks so HLS resumes at the right
  // spot, not 0").
  startSeconds?: number
}

const TICKS_PER_SECOND = 10_000_000
const DEFAULT_VIDEO_ASPECT = 16 / 9
const NATIVE_HLS_MIME_TYPE = 'application/vnd.apple.mpegurl'

// ORCHESTRATE.md § "Quality tiers → maxBitrate" — shared by this store and
// the iPad's quality picker. The picker only ever sends a `QualityTier`
// string via `setQuality`; this table is the one place that knows the actual
// bitrate numbers. `null` means "omit the param" (Auto — no cap, Emby tries
// direct-play first).
const QUALITY_MAX_BITRATE: Record<QualityTier, number | null> = {
  auto: null,
  '1080p': 8_000_000,
  '720p': 4_000_000,
  '480p': 1_500_000,
  datasaver: 720_000,
}

// tick() drift-correction tuning. Deliberately simple — a proportional
// nudge, not a PID controller.
const HARD_SEEK_DRIFT_SECONDS = 0.75
const NEGLIGIBLE_DRIFT_SECONDS = 0.05
const DRIFT_CORRECTION_GAIN = 0.2
const MIN_PLAYBACK_RATE = 0.9
const MAX_PLAYBACK_RATE = 1.1

// Module-level singletons. Never touched at module-eval time — only from
// inside the lazy `ensure*` getters below, which are only ever invoked from
// store actions (called by client-side effects/handlers, never during SSR).
let sharedVideoElement: HTMLVideoElement | null = null
let sharedHls: Hls | null = null
let subtitleTrackElement: HTMLTrackElement | null = null

// Tracks a `load()` call still resolving its `fetchPlaybackInfo()`/
// `applySource()` cycle. Without this, two `load()` calls for the same item
// can run concurrently — e.g. `IpadBrowser.tsx`'s `enqueueEntry()` fires an
// optimistic local `load()` for the browser's autoplay-gesture requirement,
// while the server's echoed `video:state` (a synchronous, no-I/O broadcast —
// see `presence.gateway.ts`'s `videoEnqueue()`) reliably beats that local
// load's own HTTP round-trip and `sync.ts`'s `handleVideoState()` doesn't yet
// see this item as loaded, so it starts a second `load()` for the same id.
// The second call's `applySource()` reassigns the shared `<video>`'s `.src`,
// which aborts the first call's already-in-flight `play()` with an
// `AbortError` that lands in `error` and is never cleared — even though the
// second call's own subsequent `play()` succeeds and playback continues.
type InFlightLoad = { itemId: string; promise: Promise<void> }
let inFlightLoad: InFlightLoad | null = null

// Exported for testing — the pure decision `load()` makes before touching
// the DOM/network at all.
export function shouldReuseInFlightLoad(
  inFlight: InFlightLoad | null,
  id: string,
): inFlight is InFlightLoad {
  return inFlight !== null && inFlight.itemId === id
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function describeError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

function buildPlaybackQuery(params: PlaybackQueryParams): string {
  const search = new URLSearchParams()
  if (params.maxBitrate !== null) {
    search.set('maxBitrate', String(params.maxBitrate))
  }
  if (params.audioIndex !== null) {
    search.set('audioIndex', String(params.audioIndex))
  }
  if (params.subtitleIndex !== null) {
    search.set('subtitleIndex', String(params.subtitleIndex))
  }
  if (params.startSeconds !== undefined) {
    search.set(
      'startTicks',
      String(Math.round(params.startSeconds * TICKS_PER_SECOND)),
    )
  }
  const query = search.toString()
  return query.length > 0 ? `?${query}` : ''
}

// Best-effort: fire the stop-transcode DELETE and swallow failures. A
// lingering transcode on the Emby server (which also reaps idle encodes
// itself) isn't worth surfacing as a user-facing playback error.
async function stopSession(playSessionId: string | null): Promise<void> {
  if (playSessionId === null) {
    return
  }
  try {
    await fetch(`/api/theater/playback/${encodeURIComponent(playSessionId)}`, {
      method: 'DELETE',
    })
  } catch {
    // ignored — see comment above
  }
}

export const usePlaybackStore = create<PlaybackStore>((set, get) => {
  function ensureVideoElement(): HTMLVideoElement {
    if (sharedVideoElement) {
      return sharedVideoElement
    }
    if (typeof window === 'undefined') {
      throw new Error(
        'usePlaybackStore: video element requested outside the browser',
      )
    }

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.playsInline = true
    // Hidden but still decoding — NOT `display:none`, which would stop the
    // element decoding frames and freeze the in-world VideoTexture.
    video.style.position = 'fixed'
    video.style.top = '0px'
    video.style.left = '0px'
    video.style.width = '2px'
    video.style.height = '2px'
    video.style.opacity = '0'
    video.style.pointerEvents = 'none'

    video.addEventListener('loadedmetadata', () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        set({ videoAspect: video.videoWidth / video.videoHeight })
      }
    })

    document.body.appendChild(video)
    sharedVideoElement = video
    return video
  }

  function ensureHls(): Hls {
    if (sharedHls) {
      return sharedHls
    }

    const hls = new Hls()
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        set({ error: `HLS playback error: ${data.details}`, loading: false })
      }
    })
    hls.attachMedia(ensureVideoElement())

    sharedHls = hls
    return hls
  }

  // Reconciles the hidden <track> on the shared <video> with the current
  // `subtitleIndex`/`subtitles` — the single place that keeps captions in
  // sync, called after load()/setQuality()/setSubtitle() apply a new source.
  // `subtitleIndex === null` (off), or no matching entry in the current
  // item's track list, both mean "no track".
  function syncSubtitleTrackElement(): void {
    subtitleTrackElement?.remove()
    subtitleTrackElement = null

    const { itemId, subtitles, subtitleIndex } = get()
    if (itemId === null || subtitleIndex === null) {
      return
    }

    const match = subtitles.find(track => track.index === subtitleIndex)
    if (!match) {
      return
    }

    const track = document.createElement('track')
    track.kind = 'subtitles'
    track.label = match.label
    track.srclang = match.lang
    track.src = `/api/theater/subtitles/${encodeURIComponent(itemId)}/${encodeURIComponent(match.mediaSourceId)}/${match.index}.vtt`

    ensureVideoElement().appendChild(track)
    // `hidden` (not `disabled`) still fires `cuechange`/`activeCues`, so POV
    // can self-render an overlay; fullscreen later flips this to `showing`.
    track.track.mode = 'hidden'

    subtitleTrackElement = track
  }

  // Attaches a resolved playback response to the shared <video>/hls.js and
  // syncs every source-derived field. Shared by load()/setQuality()/
  // setSubtitle() — none of them touch the anchor here; callers decide that
  // (load() resets to paused-at-0, quality/subtitle switches resume in
  // place).
  function applySource(id: string, data: PlaybackResponse): void {
    const video = ensureVideoElement()
    const needsHlsJs =
      data.mode === 'hls' && !video.canPlayType(NATIVE_HLS_MIME_TYPE)

    if (needsHlsJs) {
      if (!Hls.isSupported()) {
        set({
          error: 'HLS playback is not supported in this browser',
          loading: false,
        })
        return
      }
      ensureHls().loadSource(data.url)
    } else {
      // Direct-play, or HLS via Safari's native player — either way, hls.js
      // (if it exists from an earlier load) shouldn't keep fetching segments
      // for a source the element no longer plays.
      sharedHls?.stopLoad()
      video.src = data.url
    }

    set({
      itemId: id,
      mode: data.mode,
      playSessionId: data.playSessionId,
      duration: data.durationTicks / TICKS_PER_SECOND,
      subtitles: data.subtitles,
      audioTracks: data.audioTracks,
      videoAspect: DEFAULT_VIDEO_ASPECT,
      loading: false,
      error: null,
    })

    syncSubtitleTrackElement()
  }

  async function fetchPlaybackInfo(
    id: string,
    params: PlaybackQueryParams,
  ): Promise<PlaybackResponse | null> {
    try {
      const response = await fetch(
        `/api/theater/playback/${encodeURIComponent(id)}${buildPlaybackQuery(params)}`,
      )
      if (!response.ok) {
        set({
          error: `Failed to resolve playback info (${response.status})`,
          loading: false,
        })
        return null
      }
      return (await response.json()) as PlaybackResponse
    } catch (err) {
      set({
        error: describeError(err, 'Failed to resolve playback info'),
        loading: false,
      })
      return null
    }
  }

  // Shared by setQuality()/setSubtitle(): stop the old transcode, resolve a
  // new source at the given params, and resume at the playhead the caller
  // captured just before tearing down (instead of restarting at 0).
  async function reresolveAndResume(
    itemId: string,
    playSessionId: string | null,
    params: PlaybackQueryParams,
  ): Promise<void> {
    const resumeAt = get().getTargetPlayhead()
    const wasPlaying = get().playing

    set({ loading: true, error: null })
    await stopSession(playSessionId)

    const data = await fetchPlaybackInfo(itemId, {
      ...params,
      startSeconds: resumeAt,
    })
    if (!data) {
      return
    }

    applySource(itemId, data)
    get().seek(resumeAt)

    if (wasPlaying) {
      void ensureVideoElement()
        .play()
        .catch((err: unknown) => {
          set({ error: describeError(err, 'Failed to resume playback') })
        })
    }
  }

  return {
    // identity / source
    itemId: null,
    mode: null,
    playSessionId: null,
    videoAspect: DEFAULT_VIDEO_ASPECT,
    duration: 0,

    // transport — anchor model
    playing: false,
    playheadAtAnchor: 0,
    anchorClockMs: 0,

    // view + ui
    view: 'pov',
    ipadOpen: false,
    loading: false,
    error: null,

    // client-local prefs (never synced in P5)
    quality: 'auto',
    subtitleIndex: null,
    subtitles: [],
    audioTracks: [],
    audioIndex: null,
    volume: 1,

    // command API
    load: id => {
      // Reuse the in-flight promise rather than starting a second
      // fetch+applySource() cycle for the same item — see the
      // `shouldReuseInFlightLoad`/`inFlightLoad` comment above.
      if (shouldReuseInFlightLoad(inFlightLoad, id)) {
        return inFlightLoad.promise
      }

      const promise = (async () => {
        const { playSessionId, quality, audioIndex, subtitleIndex } = get()
        set({ loading: true, error: null })

        // A fresh selection retires whatever was playing before it —
        // otherwise switching movies repeatedly leaks a transcode per
        // switch.
        await stopSession(playSessionId)

        const data = await fetchPlaybackInfo(id, {
          maxBitrate: QUALITY_MAX_BITRATE[quality],
          audioIndex,
          subtitleIndex,
        })
        if (!data) {
          return
        }

        applySource(id, data)
        get().seek(0)
        set({ playing: false })
      })().finally(() => {
        // Only clear if we're still the current in-flight load for this id —
        // a later call for a DIFFERENT id may have already overwritten
        // `inFlightLoad` by the time this settles.
        if (inFlightLoad?.itemId === id) {
          inFlightLoad = null
        }
      })

      inFlightLoad = { itemId: id, promise }
      return promise
    },

    play: () => {
      const video = ensureVideoElement()
      void video.play().catch((err: unknown) => {
        set({ error: describeError(err, 'Failed to start playback') })
      })

      const playhead = get().getTargetPlayhead()
      set({
        playing: true,
        playheadAtAnchor: playhead,
        anchorClockMs: performance.now(),
      })
    },

    pause: () => {
      const video = ensureVideoElement()
      video.pause()

      const playhead = get().getTargetPlayhead()
      set({
        playing: false,
        playheadAtAnchor: playhead,
        anchorClockMs: performance.now(),
      })
    },

    seek: t => {
      ensureVideoElement().currentTime = t
      set({ playheadAtAnchor: t, anchorClockMs: performance.now() })
    },

    setView: v => set({ view: v }),

    setIpadOpen: open => set({ ipadOpen: open }),

    setQuality: q => {
      const { itemId, playSessionId, audioIndex, subtitleIndex } = get()
      set({ quality: q })

      if (itemId === null) {
        return
      }

      void reresolveAndResume(itemId, playSessionId, {
        maxBitrate: QUALITY_MAX_BITRATE[q],
        audioIndex,
        subtitleIndex,
      })
    },

    setSubtitle: index => {
      set({ subtitleIndex: index })
      syncSubtitleTrackElement()
    },

    setVolume: v => set({ volume: clamp(v, 0, 1) }),

    applyAnchor: ({ playing: nextPlaying, playhead, atClockMs }) => {
      const wasPlaying = get().playing
      set({
        playing: nextPlaying,
        playheadAtAnchor: playhead,
        anchorClockMs: atClockMs,
      })

      // tick() will reconcile currentTime/playbackRate against the new
      // anchor on the next frame; this only needs to flip actual playback.
      const video = sharedVideoElement
      if (!video) {
        return
      }
      if (nextPlaying && !wasPlaying) {
        void video.play().catch((err: unknown) => {
          set({ error: describeError(err, 'Failed to start playback') })
        })
      } else if (!nextPlaying && wasPlaying) {
        video.pause()
      }
    },

    getVideoElement: () => ensureVideoElement(),

    getTargetPlayhead: () => {
      const { playing, playheadAtAnchor, anchorClockMs } = get()
      return playing
        ? playheadAtAnchor + (performance.now() - anchorClockMs) / 1000
        : playheadAtAnchor
    },

    tick: nowMs => {
      const video = sharedVideoElement
      if (!video) {
        return
      }

      const { playing, playheadAtAnchor, anchorClockMs } = get()
      const target = playing
        ? playheadAtAnchor + (nowMs - anchorClockMs) / 1000
        : playheadAtAnchor
      const drift = video.currentTime - target

      if (Math.abs(drift) > HARD_SEEK_DRIFT_SECONDS) {
        video.currentTime = target
        video.playbackRate = 1
        return
      }

      if (Math.abs(drift) < NEGLIGIBLE_DRIFT_SECONDS) {
        video.playbackRate = 1
        return
      }

      video.playbackRate = clamp(
        1 - drift * DRIFT_CORRECTION_GAIN,
        MIN_PLAYBACK_RATE,
        MAX_PLAYBACK_RATE,
      )
    },
  }
})
