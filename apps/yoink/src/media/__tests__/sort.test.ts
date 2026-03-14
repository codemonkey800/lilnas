import type { SortValue } from 'src/components/sort-select'
import type { LibraryItem } from 'src/media/library'
import { sortItems } from 'src/media/sort'

function makeItem(overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: 1,
    title: 'Movie',
    year: 2023,
    posterUrl: null,
    mediaType: 'movie',
    quality: null,
    status: 'downloaded',
    href: '/movie/1',
    addedAt: '2023-01-01T00:00:00Z',
    releaseDate: '2023-01-01',
    ...overrides,
  }
}

const items: LibraryItem[] = [
  makeItem({
    id: 1,
    title: 'Bravo',
    addedAt: '2023-03-01T00:00:00Z',
    releaseDate: '2023-03-01',
  }),
  makeItem({
    id: 2,
    title: 'Alpha',
    addedAt: '2023-01-01T00:00:00Z',
    releaseDate: '2023-01-01',
  }),
  makeItem({
    id: 3,
    title: 'Charlie',
    addedAt: '2023-02-01T00:00:00Z',
    releaseDate: '2023-02-01',
  }),
]

describe('sortItems', () => {
  it('returns items in original order for relevance sort', () => {
    const result = sortItems(items, 'relevance')
    expect(result).toEqual(items)
  })

  it('does not mutate the original array', () => {
    const result = sortItems(items, 'title-asc')
    expect(result).not.toBe(items)
    expect(items.map(i => i.title)).toEqual(['Bravo', 'Alpha', 'Charlie'])
  })

  it('sorts by title ascending (A→Z)', () => {
    const result = sortItems(items, 'title-asc')
    expect(result.map(i => i.title)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('sorts by title descending (Z→A)', () => {
    const result = sortItems(items, 'title-desc')
    expect(result.map(i => i.title)).toEqual(['Charlie', 'Bravo', 'Alpha'])
  })

  it('sorts by added date descending (newest first)', () => {
    const result = sortItems(items, 'added-desc')
    expect(result.map(i => i.title)).toEqual(['Bravo', 'Charlie', 'Alpha'])
  })

  it('sorts by added date ascending (oldest first)', () => {
    const result = sortItems(items, 'added-asc')
    expect(result.map(i => i.title)).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('sorts by release date descending (newest first)', () => {
    const result = sortItems(items, 'release-desc')
    expect(result.map(i => i.title)).toEqual(['Bravo', 'Charlie', 'Alpha'])
  })

  it('sorts by release date ascending (oldest first)', () => {
    const result = sortItems(items, 'release-asc')
    expect(result.map(i => i.title)).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('treats null release dates as epoch (before any real date) in release-asc', () => {
    const withNull = [
      makeItem({ id: 1, title: 'HasDate', releaseDate: '2023-01-01' }),
      makeItem({ id: 2, title: 'NoDate', releaseDate: null }),
    ]
    const result = sortItems(withNull, 'release-asc')
    expect(result[0]!.title).toBe('NoDate')
    expect(result[1]!.title).toBe('HasDate')
  })

  it('treats null release dates as epoch (after any real date) in release-desc', () => {
    const withNull = [
      makeItem({ id: 1, title: 'HasDate', releaseDate: '2023-01-01' }),
      makeItem({ id: 2, title: 'NoDate', releaseDate: null }),
    ]
    const result = sortItems(withNull, 'release-desc')
    expect(result[0]!.title).toBe('HasDate')
    expect(result[1]!.title).toBe('NoDate')
  })

  it('handles single item list', () => {
    const single = [makeItem({ title: 'Solo' })]
    expect(sortItems(single, 'title-asc')).toEqual(single)
  })

  it('handles empty list', () => {
    expect(sortItems([], 'title-asc')).toEqual([])
  })

  it('returns items unchanged for unrecognised sort value', () => {
    const result = sortItems(items, 'unknown' as SortValue)
    expect(result).toEqual(items)
  })
})
