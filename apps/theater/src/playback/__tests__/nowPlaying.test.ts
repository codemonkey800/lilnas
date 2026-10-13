import { buildArtworkUrl } from 'src/playback/nowPlaying'

describe('buildArtworkUrl', () => {
  it('omits the query entirely with no options, matching the poster grid', () => {
    expect(buildArtworkUrl('abc123')).toBe('/api/theater/items/abc123/image')
  })

  it('passes through type and maxWidth', () => {
    expect(
      buildArtworkUrl('abc123', { type: 'Backdrop', maxWidth: 1920 }),
    ).toBe('/api/theater/items/abc123/image?type=Backdrop&maxWidth=1920')
  })

  it('supports either option on its own', () => {
    expect(buildArtworkUrl('abc123', { type: 'Primary' })).toBe(
      '/api/theater/items/abc123/image?type=Primary',
    )
    expect(buildArtworkUrl('abc123', { maxWidth: 800 })).toBe(
      '/api/theater/items/abc123/image?maxWidth=800',
    )
  })

  it('percent-encodes the item id so it cannot escape the path segment', () => {
    expect(buildArtworkUrl('a/b c')).toBe('/api/theater/items/a%2Fb%20c/image')
  })
})
