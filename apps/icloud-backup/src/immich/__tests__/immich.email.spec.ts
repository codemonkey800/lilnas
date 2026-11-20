import { immichEmail } from 'src/immich/immich.email'

describe('immichEmail', () => {
  it('adds the plus tag to the local part', () => {
    expect(immichEmail('a@b.c', 'tag')).toBe('a+tag@b.c')
  })

  it('returns the address unchanged without a tag', () => {
    expect(immichEmail('a@b.c')).toBe('a@b.c')
    expect(immichEmail('a@b.c', '')).toBe('a@b.c')
  })
})
