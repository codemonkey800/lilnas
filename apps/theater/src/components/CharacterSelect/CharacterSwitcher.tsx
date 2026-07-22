'use client'

import { cns } from '@lilnas/utils/cns'
import { KeyboardEvent } from 'react'

import { getAdjacentAvailableId, getAvailableCharacters } from './characterNav'
import { Character } from './characters'

export type CharacterSwitcherProps = {
  characters: Character[]
  selectedId: string
  onSelectionChange: (id: string) => void
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-black'

// A vertical, top-down rail on the stage's left edge (CharacterSelect.tsx
// centers it along the full stage height) — chips for every character
// (locked ones rendered disabled, never selectable) plus ▲ ▾ to step
// between the *available* ones, stacked in the same top-down order as
// `characters`. Arrows and the keyboard handler are dropped entirely once
// there's nothing to step between — that's also when the locked filler
// chips (characters.ts) are doing their job of making the list look
// intentional, so the "more coming soon" text only appears if there isn't
// even a filler chip to imply it.
export function CharacterSwitcher({
  characters,
  selectedId,
  onSelectionChange,
}: CharacterSwitcherProps) {
  const availableCount = getAvailableCharacters(characters).length
  const showArrows = availableCount > 1
  const showComingSoonText = characters.length === 1

  const step = (direction: 1 | -1) => {
    const nextId = getAdjacentAvailableId(characters, selectedId, direction)
    if (nextId) {
      onSelectionChange(nextId)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      step(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      step(-1)
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      {/* Dark glass shelf, same fix as before, just reoriented: unselected
          chips are border-only (no fill), so without a backing they'd read
          straight through to whatever the floor's animated projection is
          doing behind them. bg-black/40 + border-white/10 mirrors the
          Landing.tsx card/input treatment; backdrop-blur-md is the extra
          step those don't need — this floats over live WebGL content, not
          a flat page background, so blur (not just opacity) is what kills
          the noise coming through. rounded-lg (Landing.tsx's card radius),
          not rounded-full — a stadium cap suits a short wide bar but
          pinches awkwardly once the shelf is this tall and narrow. */}
      <div
        className="flex flex-col items-stretch gap-2 rounded-lg border border-white/10 bg-black/40 p-3 backdrop-blur-md"
        onKeyDown={showArrows ? handleKeyDown : undefined}
      >
        {showArrows && (
          <button
            type="button"
            aria-label="Previous character"
            onClick={() => step(-1)}
            className={cns(
              'rounded px-1 text-lg text-white/50 transition hover:text-white',
              FOCUS_RING,
            )}
          >
            {/* Same ‹ › glyphs as a horizontal switcher would use, just
                rotated 90° to point up/down instead of picking new ones. */}
            <span className="inline-block rotate-90">‹</span>
          </button>
        )}

        <div className="flex flex-col items-start gap-2">
          {characters.map(character => {
            const locked = character.available === false
            const isSelected = character.id === selectedId

            return (
              <button
                key={character.id}
                type="button"
                disabled={locked}
                aria-current={isSelected}
                onClick={() => onSelectionChange(character.id)}
                className={cns(
                  'rounded-full border px-4 py-1.5 text-sm transition',
                  FOCUS_RING,
                  locked && 'cursor-not-allowed border-white/10 text-white/40',
                  !locked &&
                    isSelected &&
                    'border-white bg-white/10 text-white',
                  !locked &&
                    !isSelected &&
                    'border-white/30 text-white/70 hover:border-white/60 hover:text-white',
                )}
              >
                {character.name}
              </button>
            )
          })}
        </div>

        {showArrows && (
          <button
            type="button"
            aria-label="Next character"
            onClick={() => step(1)}
            className={cns(
              'rounded px-1 text-lg text-white/50 transition hover:text-white',
              FOCUS_RING,
            )}
          >
            <span className="inline-block rotate-90">›</span>
          </button>
        )}
      </div>

      {showComingSoonText && (
        <span className="text-xs text-white/60">
          More characters coming soon.
        </span>
      )}
    </div>
  )
}
