'use client'

import { cns } from '@lilnas/utils/cns'
import { Component, ReactNode } from 'react'

import { Character } from './characters'

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black'

export function hasWebGl(): boolean {
  if (typeof document === 'undefined') {
    return false
  }

  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function StagePreviewUnavailable() {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 text-white/60"
      role="status"
    >
      <div className="h-32 w-32 rounded-full bg-white/5" />
      <p className="text-sm">Preview unavailable</p>
    </div>
  )
}

type StageErrorBoundaryProps = {
  children: ReactNode
}

type StageErrorBoundaryState = {
  hasError: boolean
}

// React error boundaries can't be written with hooks — this is the one
// class component in the app. Catches GLTF load/decode failures (a bad or
// missing model file) so a broken asset only takes out the 3D preview, not
// the whole screen — chrome, the switcher, and "Enter theater" keep working
// outside this boundary. Give each usage `key={character.id}` so swapping
// to a different character remounts fresh instead of staying stuck on a
// previous failure.
export class StageErrorBoundary extends Component<
  StageErrorBoundaryProps,
  StageErrorBoundaryState
> {
  override state: StageErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): StageErrorBoundaryState {
    return { hasError: true }
  }

  override render() {
    if (this.state.hasError) {
      return <StagePreviewUnavailable />
    }
    return this.props.children
  }
}

export type NoWebglFallbackProps = {
  characters: Character[]
  selectedId: string
  onSelectionChange: (id: string) => void
  onEnter: () => void
  username: string | null
  onLogout: () => void
}

// The floor when there's no WebGL at all — today's original name-card list
// (PLAN.md §4's "no-WebGL: fall back to a name-card list"), so a browser
// that can't run the 3D stage still gets a fully functional picker.
export function NoWebglFallback({
  characters,
  selectedId,
  onSelectionChange,
  onEnter,
  username,
  onLogout,
}: NoWebglFallbackProps) {
  const selected = characters.find(character => character.id === selectedId)

  return (
    <div className="flex flex-auto flex-col items-center justify-center gap-8 p-8">
      <div className="flex w-full max-w-3xl items-baseline justify-between">
        <h1 className="text-2xl font-medium">Choose your character</h1>
        <div className="flex items-center gap-4 text-sm text-white/60">
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

      <div className="grid w-full max-w-3xl grid-cols-2 gap-4 sm:grid-cols-3">
        {characters.map(character => {
          const locked = character.available === false
          const isSelected = character.id === selectedId

          return (
            <button
              key={character.id}
              type="button"
              disabled={locked}
              onClick={() => onSelectionChange(character.id)}
              className={cns(
                'flex flex-col items-center gap-3 rounded-lg border p-6 transition',
                FOCUS_RING,
                locked && 'cursor-not-allowed border-white/10 text-white/40',
                !locked && isSelected && 'border-white bg-white/10',
                !locked &&
                  !isSelected &&
                  'border-white/20 hover:border-white/40',
              )}
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-xl font-semibold">
                {character.name.charAt(0)}
              </span>
              <span>{character.name}</span>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={onEnter}
        disabled={!selected}
        className={cns(
          'rounded bg-white px-8 py-3 font-medium text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50',
          FOCUS_RING,
        )}
      >
        Enter theater
      </button>
    </div>
  )
}
