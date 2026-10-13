import { Character } from './characters'

export function isAvailable(character: Character): boolean {
  return character.available !== false
}

export function getAvailableCharacters(characters: Character[]): Character[] {
  return characters.filter(isAvailable)
}

/**
 * The next (direction=1) or previous (direction=-1) *available* character's
 * id, wrapping around the ends. Locked characters are skipped entirely —
 * there's nothing to do with landing on one you can't select. Returns null
 * only if there are no available characters at all.
 */
export function getAdjacentAvailableId(
  characters: Character[],
  currentId: string,
  direction: 1 | -1,
): string | null {
  const available = getAvailableCharacters(characters)
  if (available.length === 0) {
    return null
  }

  const currentIndex = available.findIndex(
    character => character.id === currentId,
  )
  if (currentIndex === -1) {
    return available[0]?.id ?? null
  }

  const nextIndex =
    (currentIndex + direction + available.length) % available.length
  return available[nextIndex]?.id ?? null
}
