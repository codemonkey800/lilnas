import type { ImageAttachment } from 'src/agent/agent.types'
import { buildPromptBlocks, formatToolSummary } from 'src/agent/message-bridge'

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

describe('formatToolSummary', () => {
  it('appends the command as a detail suffix (regression: bare "Terminal" with no visible command)', () => {
    const tools = new Map([
      [
        'tool1',
        {
          title: 'git status',
          status: 'completed' as const,
          rawInput: { command: 'git status', description: 'Check status' },
        },
      ],
    ])

    expect(formatToolSummary(tools)).toBe('✅ git status · `git status`')
  })

  it('skips sensitive fields and prefers the first safe field present', () => {
    const tools = new Map([
      [
        'tool1',
        {
          title: 'Edit',
          status: 'in_progress' as const,
          rawInput: {
            new_string: 'topSecretPlainText',
            file_path: 'src/foo.ts',
          },
        },
      ],
    ])

    expect(formatToolSummary(tools)).toBe('🔄 Edit · `src/foo.ts`')
  })

  it('falls back to extracting a path from the title when rawInput has no safe field', () => {
    const tools = new Map([
      [
        'tool1',
        { title: 'Read src/foo.ts', status: 'pending' as const, rawInput: {} },
      ],
    ])

    expect(formatToolSummary(tools)).toBe('⏳ Read src/foo.ts · `src/foo.ts`')
  })

  it('omits the detail suffix when nothing safe is extractable', () => {
    const tools = new Map([
      ['tool1', { title: 'Task', status: 'failed' as const }],
    ])

    expect(formatToolSummary(tools)).toBe('❌ Task')
  })
})
