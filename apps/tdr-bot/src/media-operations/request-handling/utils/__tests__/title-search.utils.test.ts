import {
  hasTitleMatch,
  normalizeTitle,
  searchWithCompactFallback,
} from 'src/media-operations/request-handling/utils/title-search.utils'

interface Result {
  id: number
  title: string
}

const visionsOfUs = { id: 1, title: 'Visions of Us' }
const sideQuest = { id: 2, title: 'Side Quest' }
const visionQuest = { id: 3, title: 'VisionQuest' }

describe('normalizeTitle', () => {
  it('ignores case, spaces and punctuation', () => {
    expect(normalizeTitle('Vision Quest')).toBe('visionquest')
    expect(normalizeTitle('VisionQuest')).toBe('visionquest')
    expect(normalizeTitle('vision-quest!')).toBe('visionquest')
  })
})

describe('hasTitleMatch', () => {
  it('matches a title regardless of spacing', () => {
    expect(hasTitleMatch('Vision Quest', [sideQuest, visionQuest])).toBe(true)
  })

  it('does not match near misses', () => {
    expect(hasTitleMatch('Vision Quest', [visionsOfUs, sideQuest])).toBe(false)
  })

  it('never matches an empty query', () => {
    expect(hasTitleMatch('  ', [{ title: '' }])).toBe(false)
  })
})

describe('searchWithCompactFallback', () => {
  const key = (r: Result) => r.id

  it('does not search again when a result already matches', async () => {
    const search = jest.fn().mockResolvedValue([sideQuest, visionQuest])

    const results = await searchWithCompactFallback('Vision Quest', search, key)

    expect(search).toHaveBeenCalledTimes(1)
    expect(results).toEqual([sideQuest, visionQuest])
  })

  it('does not search again for a one-word query', async () => {
    const search = jest.fn().mockResolvedValue([sideQuest])

    await searchWithCompactFallback('Heat', search, key)

    expect(search).toHaveBeenCalledTimes(1)
  })

  it('puts the one-word title first when only it matches', async () => {
    const search = jest.fn(async (term: string) =>
      term === 'VisionQuest'
        ? [visionQuest, sideQuest]
        : [visionsOfUs, sideQuest],
    )

    const results = await searchWithCompactFallback('Vision Quest', search, key)

    expect(search).toHaveBeenCalledWith('VisionQuest')
    expect(results).toEqual([visionQuest, visionsOfUs, sideQuest])
  })

  it('keeps the first results when the one-word search finds no match', async () => {
    const search = jest.fn(async (term: string) =>
      term === 'VisionQuest' ? [sideQuest] : [visionsOfUs],
    )

    const results = await searchWithCompactFallback('Vision Quest', search, key)

    expect(results).toEqual([visionsOfUs])
  })

  it('keeps the first results when the one-word search fails', async () => {
    const search = jest.fn(async (term: string) => {
      if (term === 'VisionQuest') throw new Error('Sonarr down')
      return [visionsOfUs]
    })

    const results = await searchWithCompactFallback('Vision Quest', search, key)

    expect(results).toEqual([visionsOfUs])
  })
})
