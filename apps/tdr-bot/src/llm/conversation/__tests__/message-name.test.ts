import { toMessageName } from 'src/llm/conversation/message-name'

describe('toMessageName', () => {
  it('replaces whitespace and reserved characters', () => {
    const name = toMessageName('Alice Display | <x>/y\\z')
    expect(name).toBe('Alice_Display_x_y_z')
    expect(name).toMatch(/^[^\s<|\\/>]+$/)
  })

  it('leaves valid names alone', () => {
    expect(toMessageName('alice_01')).toBe('alice_01')
  })

  it('trims to 64 characters', () => {
    expect(toMessageName('a'.repeat(100))).toHaveLength(64)
  })

  it('returns undefined when empty', () => {
    expect(toMessageName('   ')).toBeUndefined()
    expect(toMessageName('')).toBeUndefined()
  })
})
