import { SearchSelection } from 'src/schemas/search-selection'

/**
 * Shared test suite for selection utility methods
 * Tests common selection behaviors: ordinal, year, out-of-range, empty results
 */
export function testSelectionMethod<T extends { year?: number }>(config: {
  methodName: string
  method: (selection: SearchSelection, items: T[]) => T | null
  createItem: (overrides?: Partial<T>) => T
  itemName: string
}) {
  describe(`${config.methodName}`, () => {
    it(`should find ${config.itemName} by ordinal (1-indexed)`, () => {
      const items = [
        config.createItem({ year: 2020 } as Partial<T>),
        config.createItem({ year: 2021 } as Partial<T>),
        config.createItem({ year: 2022 } as Partial<T>),
      ]
      const selection: SearchSelection = {
        selectionType: 'ordinal',
        value: '2',
      }

      const result = config.method(selection, items)

      expect(result).toEqual(items[1])
      expect(result?.year).toBe(2021)
    })

    it(`should find ${config.itemName} by year`, () => {
      const items = [
        config.createItem({ year: 2020 } as Partial<T>),
        config.createItem({ year: 2021 } as Partial<T>),
        config.createItem({ year: 2022 } as Partial<T>),
      ]
      const selection: SearchSelection = {
        selectionType: 'year',
        value: '2022',
      }

      const result = config.method(selection, items)

      expect(result?.year).toBe(2022)
    })

    it(`should return first ${config.itemName} for ordinal out of range`, () => {
      const items = [config.createItem({ year: 2024 } as Partial<T>)]
      const selection: SearchSelection = {
        selectionType: 'ordinal',
        value: '100',
      }

      const result = config.method(selection, items)

      expect(result).toEqual(items[0])
    })

    it(`should return first ${config.itemName} when year not found`, () => {
      const items = [config.createItem({ year: 2024 } as Partial<T>)]
      const selection: SearchSelection = {
        selectionType: 'year',
        value: '1999',
      }

      const result = config.method(selection, items)

      expect(result).toEqual(items[0])
    })

    it(`should return null for empty ${config.itemName} results`, () => {
      const selection: SearchSelection = {
        selectionType: 'ordinal',
        value: '1',
      }

      const result = config.method(selection, [])

      expect(result).toBeNull()
    })
  })
}
