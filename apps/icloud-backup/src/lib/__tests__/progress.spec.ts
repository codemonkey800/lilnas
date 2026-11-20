import { progressPercent } from 'src/lib/progress'

describe('progressPercent', () => {
  it('is null while the total is unknown', () => {
    expect(
      progressPercent({
        totalItems: null,
        downloadedItems: 5,
        skippedItems: 0,
      }),
    ).toBeNull()
  })

  it('counts items already on the server as done', () => {
    expect(
      progressPercent({
        totalItems: 200,
        downloadedItems: 50,
        skippedItems: 50,
      }),
    ).toBe(50)
  })

  it('rounds down and never passes 100', () => {
    expect(
      progressPercent({
        totalItems: 1000,
        downloadedItems: 999,
        skippedItems: 0,
      }),
    ).toBe(99)
    expect(
      progressPercent({ totalItems: 10, downloadedItems: 9, skippedItems: 5 }),
    ).toBe(100)
  })

  it('is 0 for an empty library', () => {
    expect(
      progressPercent({ totalItems: 0, downloadedItems: 0, skippedItems: 0 }),
    ).toBe(0)
  })
})
