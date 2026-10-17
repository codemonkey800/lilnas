import { HumanMessage, SystemMessage } from '@langchain/core/messages'

import {
  EMOJI_BATCH_TOKENS_PER_EMOJI,
  EMOJI_DESCRIBE_MAX_TOKENS,
  EMOJI_DESCRIBER_MODEL,
  EMOJI_EXAMPLE_COUNT,
} from 'src/emojis/emoji.constants'
import {
  EmojiDescriberService,
  EmojiExample,
  emojiPngUrl,
} from 'src/emojis/emoji-describer.service'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'

const EMOJI = { id: '123456789', name: 'catJAM', animated: false }

function example(name: string, animated = false): EmojiExample {
  return { name, animated, description: `Use for ${name}` }
}

function setup() {
  const llm = new FakeLlmClient().script('emoji.describe', {
    description: 'Vibe along to a good song',
  })
  const registry = new ModelRegistry()
  const service = new EmojiDescriberService(llm, registry)
  return { llm, registry, service }
}

function systemText(llm: FakeLlmClient): string {
  const [system] = llm.calls[0].messages
  expect(system).toBeInstanceOf(SystemMessage)
  return String(system.content)
}

function exampleLines(llm: FakeLlmClient): string[] {
  return systemText(llm)
    .split('\n')
    .filter(line => line.startsWith('- '))
}

describe('emojiPngUrl', () => {
  it('points at the static PNG on the Discord CDN', () => {
    expect(emojiPngUrl('42')).toBe('https://cdn.discordapp.com/emojis/42.png')
  })
})

describe('EmojiDescriberService', () => {
  it('sends the name as text and the PNG at low detail', async () => {
    const { llm, service } = setup()

    await service.describe(EMOJI, [])

    const human = llm.calls[0].messages[1]
    expect(human).toBeInstanceOf(HumanMessage)
    expect(human.content).toEqual([
      { type: 'text', text: 'Name: catJAM' },
      {
        type: 'image_url',
        image_url: {
          url: 'https://cdn.discordapp.com/emojis/123456789.png',
          detail: 'low',
        },
      },
    ])
  })

  it('marks animated emojis in the text and still uses the .png URL', async () => {
    const { llm, service } = setup()

    await service.describe({ ...EMOJI, animated: true }, [])

    expect(llm.calls[0].messages[1].content).toEqual([
      { type: 'text', text: 'Name: catJAM (animated)' },
      {
        type: 'image_url',
        image_url: {
          url: 'https://cdn.discordapp.com/emojis/123456789.png',
          detail: 'low',
        },
      },
    ])
  })

  it('overrides model, max tokens and reasoning effort', async () => {
    const { llm, service } = setup()

    await service.describe(EMOJI, [])

    expect(llm.calls[0]).toMatchObject({
      operation: 'emoji.describe',
      role: 'chat',
      overrides: {
        model: EMOJI_DESCRIBER_MODEL,
        maxTokens: EMOJI_DESCRIBE_MAX_TOKENS,
        reasoningEffort: 'low',
      },
    })
  })

  it('renders the given examples in the system prompt', async () => {
    const { llm, service } = setup()
    const examples = Array.from({ length: 8 }, (_, i) => example(`emo${i}`))
    examples[1] = example('partyParrot', true)

    await service.describe(EMOJI, examples)

    const lines = exampleLines(llm)
    expect(lines).toHaveLength(8)
    expect(lines[0]).toBe('- emo0: Use for emo0')
    expect(lines[1]).toBe('- partyParrot (animated): Use for partyParrot')
  })

  it('caps examples at EMOJI_EXAMPLE_COUNT', async () => {
    const { llm, service } = setup()
    const examples = Array.from({ length: 15 }, (_, i) => example(`emo${i}`))

    await service.describe(EMOJI, examples)

    expect(exampleLines(llm)).toHaveLength(EMOJI_EXAMPLE_COUNT)
  })

  it('omits the examples section when there are no examples', async () => {
    const { llm, service } = setup()

    await service.describe(EMOJI, [])

    expect(systemText(llm)).not.toContain('Examples:')
  })

  it('rejects a model without vision before calling the LLM', async () => {
    const { llm, registry, service } = setup()
    const spec = registry.get(EMOJI_DESCRIBER_MODEL)
    jest.spyOn(registry, 'get').mockReturnValue({
      ...spec,
      capabilities: { ...spec.capabilities, vision: false },
    })

    await expect(service.describe(EMOJI, [])).rejects.toThrow(/vision/)
    expect(llm.calls).toHaveLength(0)
  })

  it('returns the trimmed description and the model used', async () => {
    const { llm, service } = setup()
    llm.script('emoji.describe', { description: '  Vibe along to a song \n' })

    await expect(service.describe(EMOJI, [])).resolves.toEqual({
      description: 'Vibe along to a song',
      model: EMOJI_DESCRIBER_MODEL,
    })
  })

  it('propagates LLM errors', async () => {
    const { llm, service } = setup()
    llm.script('emoji.describe', new Error('rate limited'))

    await expect(service.describe(EMOJI, [])).rejects.toThrow('rate limited')
  })
})

describe('EmojiDescriberService.describeBatch', () => {
  const EMOJIS = [
    { id: '11', name: 'catJAM', animated: true },
    { id: '22', name: 'pog', animated: false },
    { id: '33', name: 'sadge', animated: false },
  ]

  function batchSetup(descriptions: { number: number; description: string }[]) {
    const llm = new FakeLlmClient().script('emoji.describe.batch', {
      descriptions,
    })
    const registry = new ModelRegistry()
    return { llm, registry, service: new EmojiDescriberService(llm, registry) }
  }

  it('sends every emoji as numbered text plus its PNG in one call', async () => {
    const { llm, service } = batchSetup([])

    await service.describeBatch(EMOJIS, [])

    expect(llm.calls).toHaveLength(1)
    const human = llm.calls[0].messages[1]
    expect(human.content).toEqual([
      { type: 'text', text: '1. Name: catJAM (animated)' },
      {
        type: 'image_url',
        image_url: { url: emojiPngUrl('11'), detail: 'low' },
      },
      { type: 'text', text: '2. Name: pog' },
      {
        type: 'image_url',
        image_url: { url: emojiPngUrl('22'), detail: 'low' },
      },
      { type: 'text', text: '3. Name: sadge' },
      {
        type: 'image_url',
        image_url: { url: emojiPngUrl('33'), detail: 'low' },
      },
    ])
  })

  it('uses the batch prompt and scales the token cap with the batch size', async () => {
    const { llm, service } = batchSetup([])

    await service.describeBatch(EMOJIS, [])

    expect(systemText(llm)).toContain('several emojis at once')
    expect(llm.calls[0].overrides).toMatchObject({
      model: EMOJI_DESCRIBER_MODEL,
      maxTokens: EMOJI_DESCRIBE_MAX_TOKENS + 3 * EMOJI_BATCH_TOKENS_PER_EMOJI,
    })
  })

  it('maps descriptions back to emoji ids by number, trimmed', async () => {
    const { service } = batchSetup([
      { number: 2, description: ' Hype something up \n' },
      { number: 1, description: 'Vibe along' },
    ])

    const result = await service.describeBatch(EMOJIS, [])

    expect([...result.entries()]).toEqual([
      [
        '22',
        { description: 'Hype something up', model: EMOJI_DESCRIBER_MODEL },
      ],
      ['11', { description: 'Vibe along', model: EMOJI_DESCRIBER_MODEL }],
    ])
  })

  it('ignores unknown numbers and keeps the first of a duplicate', async () => {
    const { service } = batchSetup([
      { number: 9, description: 'who?' },
      { number: 0, description: 'also who?' },
      { number: 1, description: 'first' },
      { number: 1, description: 'second' },
    ])

    const result = await service.describeBatch(EMOJIS, [])

    expect([...result.keys()]).toEqual(['11'])
    expect(result.get('11')?.description).toBe('first')
  })

  it('leaves the single-emoji prompt without the batch note', async () => {
    const { llm, service } = setup()

    await service.describe(EMOJI, [])

    expect(systemText(llm)).not.toContain('several emojis at once')
  })

  it('rejects a model without vision before calling the LLM', async () => {
    const { llm, registry, service } = batchSetup([])
    const spec = registry.get(EMOJI_DESCRIBER_MODEL)
    jest.spyOn(registry, 'get').mockReturnValue({
      ...spec,
      capabilities: { ...spec.capabilities, vision: false },
    })

    await expect(service.describeBatch(EMOJIS, [])).rejects.toThrow(/vision/)
    expect(llm.calls).toHaveLength(0)
  })

  it('propagates LLM errors', async () => {
    const { llm, service } = batchSetup([])
    llm.script('emoji.describe.batch', new Error('rate limited'))

    await expect(service.describeBatch(EMOJIS, [])).rejects.toThrow(
      'rate limited',
    )
  })
})
