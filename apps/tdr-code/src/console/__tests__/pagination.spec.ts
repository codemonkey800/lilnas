import { paginate } from 'src/console/pagination'

function rows(ids: number[]) {
  return ids.map(id => ({ id }))
}

describe('paginate', () => {
  it('empty rows → {items:[], nextCursor:null}', () => {
    expect(paginate([], 10)).toEqual({ items: [], nextCursor: null })
  })

  it('fewer than limit → nextCursor null', () => {
    const result = paginate(rows([3, 2, 1]), 10)
    expect(result.items).toHaveLength(3)
    expect(result.nextCursor).toBeNull()
  })

  it('exactly limit → nextCursor null', () => {
    const result = paginate(rows([5, 4, 3, 2, 1]), 5)
    expect(result.items).toHaveLength(5)
    expect(result.nextCursor).toBeNull()
  })

  it('limit+1 rows → nextCursor = last item id, items length = limit', () => {
    const result = paginate(rows([6, 5, 4, 3, 2, 1]), 5)
    expect(result.items).toHaveLength(5)
    expect(result.items.map(r => r.id)).toEqual([6, 5, 4, 3, 2])
    expect(result.nextCursor).toBe(2)
  })

  it('two items same created_at but distinct id — keyset stable (id order preserved)', () => {
    // Caller already orders by id DESC; paginate just slices, preserving caller order.
    const result = paginate(rows([10, 9, 8, 7, 6, 5]), 5)
    expect(result.nextCursor).toBe(6)
    expect(result.items.map(r => r.id)).toEqual([10, 9, 8, 7, 6])
  })
})
