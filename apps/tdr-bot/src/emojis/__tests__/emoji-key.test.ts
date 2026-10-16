import { emojiKey } from 'src/emojis/emoji-key'

describe('emojiKey', () => {
  it('formats a static emoji as <:name:id>', () => {
    expect(
      emojiKey({ id: '758414734805696553', name: 'EZ', animated: false }),
    ).toBe('<:EZ:758414734805696553>')
  })

  it('formats an animated emoji as <a:name:id>', () => {
    expect(
      emojiKey({
        id: '758415960448434217',
        name: 'peepoPooPoo',
        animated: true,
      }),
    ).toBe('<a:peepoPooPoo:758415960448434217>')
  })
})
