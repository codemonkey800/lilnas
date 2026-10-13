'use client'

import { useGLTF, useTexture } from '@react-three/drei'
import { forwardRef, useMemo } from 'react'
import { Box3, Mesh, SRGBColorSpace, Vector3, type VideoTexture } from 'three'

import { collectMeshesByName } from './meshCollider'

// Same GLB Theater.tsx loads. Duplicated (not imported) on purpose — this
// component is standalone/self-contained (a later integration wave wires it
// alongside <Theater/>), and drei's useGLTF cache is keyed by URL, so both
// components resolve to the exact same cached scene graph regardless.
const MODEL_URL = '/models/cinema.glb'

const IDLE_POSTER_URL = '/textures/feature-film-charcoal.jpg'

// Toward the audience: the screen sits at the room's +Z end and the seats
// are toward -Z (see Theater.tsx's wall/floor comments), so nudging the
// plane's Z down moves it off the physical wall_screen panel just enough to
// stop the two coplanar surfaces from z-fighting.
const FRONT_OFFSET = 0.02

// `videoAspect` is supplied by the playback pipeline once a stream's
// `loadedmetadata` fires. Until then (or if the caller omits it), fall back
// to the most common source aspect rather than the screen's own 2.20:1 —
// matching the screen would defeat cover-fit's purpose of never distorting
// a non-2.20:1 video.
const DEFAULT_VIDEO_ASPECT = 16 / 9

// D2 (PLAN.md): preserve the video's own aspect and size a rectangle that
// fills AT LEAST the screen's bounds in both axes — overflow past the panel
// edges is intentional (no letterboxing, no distortion).
function coverSize(
  screenWidth: number,
  screenHeight: number,
  videoAspect: number,
) {
  const height = Math.max(screenHeight, screenWidth / videoAspect)
  return { w: height * videoAspect, h: height }
}

type ScreenPlacement = {
  center: Vector3
  size: Vector3
}

// Finds the `wall_screen` panel in the *raw*, un-recentered useGLTF cache —
// the same cached scene graph Theater.tsx clones from (dedupe-by-URL, not a
// second load) — and reproduces Theater.tsx's recentering translation
// (`model.position.set(-center.x, -box.min.y, -center.z)`) as arithmetic
// instead of a mutation, per ORCHESTRATE.md's "Model-space placement
// (screen)" contract. This never clones or moves the shared `scene`; only
// Theater.tsx does that, on its own separate clone.
function useScreenPlacement(): ScreenPlacement {
  const { scene } = useGLTF(MODEL_URL)

  return useMemo(() => {
    const [wallScreen] = collectMeshesByName(scene, /^wall_screen$/)
    if (!wallScreen) {
      throw new Error(
        'TheaterScreen: "wall_screen" mesh not found in cinema.glb',
      )
    }

    // The whole-model box/center Theater.tsx derives its recentering offset
    // from — read here off the shared, still un-recentered scene, never
    // applied to it.
    const modelBox = new Box3().setFromObject(scene)
    const modelCenter = modelBox.getCenter(new Vector3())

    const screenBox = new Box3().setFromObject(wallScreen)
    const rawCenter = screenBox.getCenter(new Vector3())
    const size = screenBox.getSize(new Vector3())
    const center = new Vector3(
      rawCenter.x - modelCenter.x,
      rawCenter.y - modelBox.min.y,
      rawCenter.z - modelCenter.z,
    )

    if (new URLSearchParams(window.location.search).has('debug')) {
      console.log('[TheaterScreen] wall_screen box', { center, size })
    }

    return { center, size }
  }, [scene])
}

export type TheaterScreenProps = {
  // undefined/null => render the idle poster instead of a video frame.
  videoTexture?: VideoTexture | null
  // The current video's width/height ratio; defaults to 16:9 when omitted.
  videoAspect?: number
}

// A static mesh, sibling of <Theater/>. It does not own the video — the
// playback pipeline (a separate unit) passes in the texture/aspect — it
// only places and sizes the plane against the runtime wall_screen box.
// Forwards its ref to the underlying <mesh> so a later spatial-audio unit
// can attach a PositionalAudio panner to this exact Object3D.
export const TheaterScreen = forwardRef<Mesh, TheaterScreenProps>(
  function TheaterScreen({ videoTexture, videoAspect }, ref) {
    const { center, size } = useScreenPlacement()

    // Cloned rather than configured in place: `useTexture` caches by URL,
    // and CharacterStage's Floor loads this exact same jpg for its carpet —
    // mutating the shared instance here would fight over its colorSpace
    // with that other consumer.
    const rawIdlePoster = useTexture(IDLE_POSTER_URL)
    const idlePoster = useMemo(() => {
      const texture = rawIdlePoster.clone()
      texture.colorSpace = SRGBColorSpace
      texture.needsUpdate = true
      return texture
    }, [rawIdlePoster])

    // D9: idle poster fills the screen box at its own native size (no
    // cover-fit — that distortion is only acceptable for real video, per
    // D2). Video: cover-fit to the video's own aspect.
    const { w, h } = videoTexture
      ? coverSize(size.x, size.y, videoAspect ?? DEFAULT_VIDEO_ASPECT)
      : { w: size.x, h: size.y }
    const texture = videoTexture ?? idlePoster

    return (
      <mesh
        ref={ref}
        position={[center.x, center.y, center.z - FRONT_OFFSET]}
        rotation={[0, Math.PI, 0]}
      >
        <planeGeometry args={[w, h]} />
        {/* Unlit + toneMapped=false: the screen emits its own light rather
            than being darkened/tinted by the room's practicals. */}
        <meshBasicMaterial map={texture} toneMapped={false} />
      </mesh>
    )
  },
)
