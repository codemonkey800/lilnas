'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  ComponentPropsWithoutRef,
  JSX,
  ReactNode,
  SyntheticEvent,
} from 'react'
import { useCallback, useState } from 'react'

import { Icon } from 'src/components/ui/icon'
import type { PosterVariant } from 'src/lib/format'
import { posterVariant } from 'src/lib/format'

/**
 * `tall` is the 2:3 poster crop, `wide` the 16:9 thumbnail.
 *
 * Required rather than defaulted, even though `ui.pug` falls through to
 * `tall`: a video rendered inside a poster grid deliberately takes the *tall*
 * crop so the grid stays one rhythm of shapes, and the same video on its own
 * detail page takes `wide`. That is a call-site decision either way, so the
 * call site states it.
 */
export type PosterShape = 'tall' | 'wide'

const POSTER_SHAPES: Record<PosterShape, string> = {
  tall: 'aspect-[2/3]',
  wide: 'aspect-video',
}

/**
 * The five gradient stand-ins, spelled out one per line.
 *
 * `ui.pug` can interpolate `poster-v${v}` because its classes are baked at
 * build time; Tailwind v4's source scanner reads this file as text, so a
 * template literal here would generate none of the five utilities. The lookup
 * is the price of static analysability.
 */
const POSTER_VARIANTS: Record<PosterVariant, string> = {
  1: 'poster-v1',
  2: 'poster-v2',
  3: 'poster-v3',
  4: 'poster-v4',
  5: 'poster-v5',
}

/** `ui.pug`'s `opts.radius || 'rounded-md'`. */
export const POSTER_DEFAULT_RADIUS = 'rounded-md'

/** `ui.pug`'s `opts.playSize || 'h-7 w-7'`. */
export const POSTER_DEFAULT_PLAY_SIZE = 'h-7 w-7'

export type PosterProps = ComponentPropsWithoutRef<'div'> & {
  /**
   * The title, shown only while there is no art. Adjacent to the image, so the
   * image itself is `alt=""` rather than repeating this.
   */
  label?: ReactNode
  /** Overlay a play triangle — videos, and anything with a trailer. */
  play?: boolean
  /** Size utilities for that triangle. Defaults to {@link POSTER_DEFAULT_PLAY_SIZE}. */
  playSize?: string
  /** Corner radius utility. Defaults to {@link POSTER_DEFAULT_RADIUS}. */
  radius?: string
  /**
   * Picks the gradient stand-in via {@link posterVariant}. Deterministic, so
   * the server and the client agree and hydration does not repaint — pass
   * something stable and per-item, i.e. the media id.
   */
  seed: string
  shape: PosterShape
  /**
   * `MediaBase.posterUrl`, or nothing. Absent or broken, the gradient plus the
   * label stand in.
   */
  src?: string | null
}

/**
 * Poster / thumbnail: a gradient tile with optional art over it.
 *
 * Ported from `docs/features/download/designs/src/mixins/ui.pug`'s `poster`
 * mixin, plus the `dropIfBroken` half of `designs/src/runtime.js` — which is
 * the whole reason this is a component and a client one. `posterUrl` comes
 * back from Radarr/Sonarr pointing at arbitrary upstream hosts, and when one
 * of them 404s the `<img>` is removed so the gradient and the title label
 * underneath reappear.
 *
 * Deliberately a plain `<img>` and never `next/image`: `next/image` refuses
 * any host not enumerated in `images.remotePatterns` and renders *nothing*
 * for it, where a bare `<img>` with an `onError` degrades honestly for a host
 * nobody predicted.
 *
 * Both failure paths from `runtime.js` are covered. An image that fails after
 * hydration fires `error`; one that already failed while the HTML was being
 * parsed never will, and is caught on mount by `complete && !naturalWidth`.
 *
 * Every remaining prop is spread onto the root element, mirroring the mixin's
 * `&attributes(attributes)` convention.
 */
export function Poster({
  children,
  className,
  label,
  play = false,
  playSize = POSTER_DEFAULT_PLAY_SIZE,
  radius = POSTER_DEFAULT_RADIUS,
  seed,
  shape,
  src,
  ...props
}: PosterProps): JSX.Element {
  // Keyed by the URL that failed rather than a bare boolean, so a call site
  // that swaps `src` (a re-fetched gallery row, say) gets a fresh attempt
  // instead of inheriting the previous URL's verdict.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)

  const handleError = useCallback(
    (event: SyntheticEvent<HTMLImageElement>): void => {
      setBrokenSrc(event.currentTarget.getAttribute('src'))
    },
    [],
  )

  // A ref callback rather than an effect: it runs with the element in hand on
  // the first commit after hydration, which is the earliest moment an
  // already-broken image can be detected. Reading `src` off the node keeps
  // this stable across renders instead of closing over the prop.
  const dropIfAlreadyBroken = useCallback(
    (img: HTMLImageElement | null): void => {
      if (img && img.complete && !img.naturalWidth) {
        setBrokenSrc(img.getAttribute('src'))
      }
    },
    [],
  )

  const showImage = Boolean(src) && brokenSrc !== src

  return (
    <div
      {...props}
      className={cns(
        'group relative flex shrink-0 items-center justify-center overflow-hidden',
        radius,
        POSTER_SHAPES[shape],
        POSTER_VARIANTS[posterVariant(seed)],
        className,
      )}
    >
      {label ? (
        // Kept in the DOM and hidden by `group-has-[img]:hidden` rather than
        // swapped out in JS: when the image is dropped the label is already
        // laid out underneath it, so it reappears without a reflow.
        <span className="p-2.5 text-center text-[12px]/[1.3] font-semibold text-ink-2 group-has-[img]:hidden">
          {label}
        </span>
      ) : null}
      {showImage ? (
        // A bare `<img>`, not `next/image` — see the doc comment above.
        <img
          ref={dropIfAlreadyBroken}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          data-poster=""
          onError={handleError}
          src={src ?? undefined}
        />
      ) : null}
      {play ? (
        <span className="absolute inset-0 flex items-center justify-center bg-linear-to-b from-transparent from-48% to-scrim/50">
          <Icon name="play" className={cns(playSize, 'text-ink')} />
        </span>
      ) : null}
      {children}
    </div>
  )
}
