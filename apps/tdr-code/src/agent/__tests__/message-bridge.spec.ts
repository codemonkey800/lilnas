import type { ImageAttachment } from 'src/agent/agent.types'
import { buildPromptBlocks } from 'src/agent/message-bridge'

const img = (n: number): ImageAttachment => ({
  data: `data${n}`,
  mimeType: `image/type${n}`,
})

describe('buildPromptBlocks', () => {
  it('text only → [{type:text,text}] (regression)', () => {
    const blocks = buildPromptBlocks('hello', [])
    expect(blocks).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('empty text + one image → [{type:image,...}] (AE3, R11)', () => {
    const blocks = buildPromptBlocks('', [img(1)])
    expect(blocks).toEqual([
      { type: 'image', data: 'data1', mimeType: 'image/type1' },
    ])
  })

  it('text + two images → [text, image, image] in order (R11)', () => {
    const blocks = buildPromptBlocks('hi', [img(1), img(2)])
    expect(blocks).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'image', data: 'data1', mimeType: 'image/type1' },
      { type: 'image', data: 'data2', mimeType: 'image/type2' },
    ])
  })

  it('empty text + empty images → [] (boundary — guard prevents this reaching executePrompt)', () => {
    const blocks = buildPromptBlocks('', [])
    expect(blocks).toEqual([])
  })
})
