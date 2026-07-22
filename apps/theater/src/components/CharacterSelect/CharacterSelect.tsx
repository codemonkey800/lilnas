'use client'

import { cns } from '@lilnas/utils/cns'
import { useEffect, useState } from 'react'

import { useSession } from 'src/components/SessionContext'

import { CHARACTERS } from './characters'
import { CharacterStage } from './CharacterStage'
import { CharacterSwitcher } from './CharacterSwitcher'
import { hasWebGl, NoWebglFallback } from './StageFallback'

export type CharacterSelectProps = {
  onSelect: (characterId: string) => void
  onLogout: () => void
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black'

// A cinematic casting stage: the selected character stands on a spotlit
// floor, turning and animated, framed by hushed chrome that never competes
// with him (PLAN.md §2-3). Layered like Scene.tsx: a relative full-size
// container, <CharacterStage> filling it, HTML chrome in a pointer-events-
// none overlay with pointer-events-auto on the interactive bits.
//
// The switcher lives in its own left-edge layer, vertically centered along
// the full stage height — independent of the name/CTA row at the bottom so
// a tall top-down character list never has to fight that row for space.
// It's still rendered *before* both the bottom row and the top chrome
// (logout) in the DOM, all positioned absolutely — that gives a tab order
// of switcher -> CTA -> logout (PLAN.md §6) while keeping logout displayed
// at the top-right; DOM order and visual position are independent here on
// purpose, not an oversight.
export function CharacterSelect({ onSelect, onLogout }: CharacterSelectProps) {
  const { username } = useSession()
  const [selectedId, setSelectedId] = useState(CHARACTERS[0]?.id ?? '')
  const selected = CHARACTERS.find(character => character.id === selectedId)
  const [revealed, setRevealed] = useState(false)
  const [webglAvailable] = useState(hasWebGl)

  // Starts hidden so the transition classes below have somewhere to
  // transition *from* — a plain initial "revealed" render wouldn't animate,
  // since CSS transitions only fire on a class change, not on first paint.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setRevealed(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!webglAvailable) {
    return (
      <NoWebglFallback
        characters={CHARACTERS}
        selectedId={selectedId}
        onSelectionChange={setSelectedId}
        onEnter={() => selected && onSelect(selected.id)}
        username={username}
        onLogout={onLogout}
      />
    )
  }

  return (
    <div className="relative min-h-0 flex-auto">
      {selected && (
        // Opacity-only reveal — deliberately NO scale/transform here. This
        // layer contains the R3F <Canvas>, which sizes itself once at mount
        // from getBoundingClientRect(). That rect is post-transform, so a
        // `scale-95` ancestor makes the canvas measure ~95% of the viewport
        // and render with black bars on the right/bottom; the scale->1
        // transition doesn't fire ResizeObserver (it ignores transforms), so
        // it stays wrong until a window resize forces a re-measure. Keep any
        // reveal on this layer to properties that don't affect layout box.
        <div
          className={cns(
            'absolute inset-0 transition duration-700 ease-out',
            revealed ? 'opacity-100' : 'opacity-0',
          )}
        >
          <CharacterStage
            modelUrl={selected.modelUrl}
            animationUrl={selected.animationUrl}
          />
        </div>
      )}

      {selected && (
        // Vertically centered along the full stage height, not
        // bottom-anchored like the name/CTA row below — a top-down list
        // needs room to grow, and centering keeps it clear of both the top
        // bar and the bottom row regardless of character count.
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center p-8">
          <div
            className={cns(
              'pointer-events-auto transition duration-500 delay-225 ease-out',
              revealed
                ? 'translate-x-0 opacity-100'
                : '-translate-x-2 opacity-0',
            )}
          >
            <CharacterSwitcher
              characters={CHARACTERS}
              selectedId={selectedId}
              onSelectionChange={setSelectedId}
            />
          </div>
        </div>
      )}

      {selected && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 p-8">
          <div
            className={cns(
              'transition duration-500 delay-150 ease-out',
              revealed
                ? 'translate-y-0 opacity-100'
                : 'translate-y-2 opacity-0',
            )}
          >
            {/* aria-live: the name is the DOM source of truth for who's
                selected (the canvas is aria-hidden), announced on change
                once Phase 4's switcher can actually change it. */}
            <h1 aria-live="polite" className="text-3xl font-semibold">
              {selected.name}
            </h1>
            {selected.tagline && (
              <p className="mt-1 text-sm text-white/60">{selected.tagline}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => onSelect(selected.id)}
            className={cns(
              'pointer-events-auto rounded bg-white px-8 py-3 font-medium text-black transition duration-500 delay-300 ease-out hover:bg-white/90',
              FOCUS_RING,
              revealed
                ? 'translate-y-0 opacity-100'
                : 'translate-y-2 opacity-0',
            )}
          >
            Enter theater →
          </button>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-baseline justify-between p-8">
        <span className="text-xs font-medium tracking-[0.2em] text-white/50 uppercase">
          Lilnas Theater
        </span>
        <div className="pointer-events-auto flex items-center gap-4 text-sm text-white/60">
          <span>Signed in as {username}</span>
          <button
            type="button"
            onClick={onLogout}
            className={cns('rounded underline hover:text-white', FOCUS_RING)}
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}
