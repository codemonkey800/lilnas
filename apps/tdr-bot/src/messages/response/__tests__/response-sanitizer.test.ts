import { unescapeDiscordTokens } from 'src/messages/response/response-sanitizer'

// Inputs are remark's actual output for each token.
describe('unescapeDiscordTokens', () => {
  it.each([
    [
      'animated emoji',
      'whatever 😌\\<a:VIBE:1061801774735966258> ok',
      'whatever 😌<a:VIBE:1061801774735966258> ok',
    ],
    ['timestamp', 'at \\<t:1792439813>', 'at <t:1792439813>'],
    ['styled timestamp', 'at \\<t:1792439813:R>', 'at <t:1792439813:R>'],
  ])('unescapes a %s', (_, escaped, expected) => {
    expect(unescapeDiscordTokens(escaped)).toBe(expected)
  })

  it.each([
    ['static emoji', 'hi <:EZ:781403152258826281>'],
    ['user mention', 'yo <@218579527041941507>'],
    ['tag-like text', 'a \\<a:b> c'],
    ['short id', '\\<a:VIBE:123>'],
  ])('leaves a %s alone', (_, content) => {
    expect(unescapeDiscordTokens(content)).toBe(content)
  })
})
