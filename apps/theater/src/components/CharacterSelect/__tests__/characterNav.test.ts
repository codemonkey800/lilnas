import {
  getAdjacentAvailableId,
  getAvailableCharacters,
  isAvailable,
} from 'src/components/CharacterSelect/characterNav'
import { Character } from 'src/components/CharacterSelect/characters'

const CHARS: Character[] = [
  { id: 'a', name: 'A', modelUrl: '/a.glb' },
  { id: 'b', name: 'B', modelUrl: '', available: false },
  { id: 'c', name: 'C', modelUrl: '/c.glb' },
  { id: 'd', name: 'D', modelUrl: '', available: false },
]

describe('isAvailable', () => {
  it('treats `available` as opt-in-locked, not opt-in-available', () => {
    expect(isAvailable({ id: 'x', name: 'X', modelUrl: '' })).toBe(true)
    expect(
      isAvailable({ id: 'x', name: 'X', modelUrl: '', available: true }),
    ).toBe(true)
    expect(
      isAvailable({ id: 'x', name: 'X', modelUrl: '', available: false }),
    ).toBe(false)
  })
})

describe('getAvailableCharacters', () => {
  it('filters out locked characters', () => {
    expect(getAvailableCharacters(CHARS).map(c => c.id)).toEqual(['a', 'c'])
  })

  it('returns an empty array when every character is locked', () => {
    const allLocked = CHARS.map(c => ({ ...c, available: false }))
    expect(getAvailableCharacters(allLocked)).toEqual([])
  })
})

describe('getAdjacentAvailableId', () => {
  it('moves to the next available character, skipping locked ones', () => {
    expect(getAdjacentAvailableId(CHARS, 'a', 1)).toBe('c')
  })

  it('moves to the previous available character, skipping locked ones', () => {
    expect(getAdjacentAvailableId(CHARS, 'c', -1)).toBe('a')
  })

  it('wraps forward past the last available character', () => {
    expect(getAdjacentAvailableId(CHARS, 'c', 1)).toBe('a')
  })

  it('wraps backward past the first available character', () => {
    expect(getAdjacentAvailableId(CHARS, 'a', -1)).toBe('c')
  })

  it('falls back to the first available character if currentId is unknown', () => {
    expect(getAdjacentAvailableId(CHARS, 'does-not-exist', 1)).toBe('a')
  })

  it('falls back to the first available character if currentId is locked', () => {
    // A locked id isn't findable among *available* characters, so this hits
    // the same "unknown id" fallback as above — never gets stuck on a chip
    // that was never selectable in the first place.
    expect(getAdjacentAvailableId(CHARS, 'b', 1)).toBe('a')
  })

  it('returns null when there are no available characters', () => {
    const allLocked = CHARS.map(c => ({ ...c, available: false }))
    expect(getAdjacentAvailableId(allLocked, 'a', 1)).toBeNull()
  })

  it('stays put (wraps to itself) with exactly one available character', () => {
    const single = [CHARS[0]!]
    expect(getAdjacentAvailableId(single, 'a', 1)).toBe('a')
    expect(getAdjacentAvailableId(single, 'a', -1)).toBe('a')
  })
})
