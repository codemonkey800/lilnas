import { seedDescriptions } from 'src/emojis/emoji-seed'
import { emojis } from 'src/utils/emojis'

describe('seedDescriptions', () => {
  it('maps every static emoji key to its id', () => {
    const seeds = seedDescriptions()

    expect(seeds.size).toBe(Object.keys(emojis).length)
    expect(seeds.get('564310072822333480')).toBe(
      'Use this when excited about something',
    )
  })

  it('parses animated keys', () => {
    expect(seedDescriptions().has('758413754965950564')).toBe(true)
  })
})
