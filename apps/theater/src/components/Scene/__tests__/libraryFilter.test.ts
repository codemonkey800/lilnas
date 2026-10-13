import { filterLibraryItems } from 'src/components/Scene/libraryFilter'

type Item = { name: string; type: 'movie' | 'series' }

const LIBRARY: Item[] = [
  { name: 'The Fast Movie', type: 'movie' },
  { name: 'A Slow Series', type: 'series' },
  { name: 'Another Fast Series', type: 'series' },
]

describe('filterLibraryItems', () => {
  it('returns everything when search is empty and typeFilter is all', () => {
    expect(filterLibraryItems(LIBRARY, '', 'all')).toEqual(LIBRARY)
  })

  it('filters by type', () => {
    expect(filterLibraryItems(LIBRARY, '', 'movie')).toEqual([LIBRARY[0]])
    expect(filterLibraryItems(LIBRARY, '', 'series')).toEqual([
      LIBRARY[1],
      LIBRARY[2],
    ])
  })

  it('filters by case-insensitive substring on name', () => {
    expect(filterLibraryItems(LIBRARY, 'fast', 'all')).toEqual([
      LIBRARY[0],
      LIBRARY[2],
    ])
  })

  it('trims whitespace from the search query', () => {
    expect(filterLibraryItems(LIBRARY, '  slow  ', 'all')).toEqual([LIBRARY[1]])
  })

  it('combines search and type filters', () => {
    expect(filterLibraryItems(LIBRARY, 'fast', 'series')).toEqual([LIBRARY[2]])
  })

  it('returns an empty list when nothing matches', () => {
    expect(filterLibraryItems(LIBRARY, 'nonexistent', 'all')).toEqual([])
  })
})
