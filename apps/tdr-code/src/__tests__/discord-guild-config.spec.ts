import { resolveDevelopmentGuilds } from 'src/discord-guild-config'

describe('resolveDevelopmentGuilds', () => {
  it('returns undefined for an empty guild id, so necord registers commands globally', () => {
    expect(resolveDevelopmentGuilds('')).toBeUndefined()
  })

  it('returns a single-element array for a real guild id, so necord fast-registers to that guild', () => {
    expect(resolveDevelopmentGuilds('123456789012345678')).toEqual([
      '123456789012345678',
    ])
  })
})
