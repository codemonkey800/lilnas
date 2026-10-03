import type { ConversationMessage } from 'src/api/api.types'
import {
  buildTranscriptItems,
  groupCallsByRequest,
} from 'src/app/transcript/group-turns'
import type { LlmCallRow } from 'src/db/schema'

function call(id: string, requestId: string | null, at: string): LlmCallRow {
  return {
    id,
    requestId,
    createdAt: new Date(at),
  } as LlmCallRow
}

const human = (id: string): ConversationMessage => ({
  id,
  type: 'human',
  content: id,
})
const ai = (
  id: string,
  content: string,
  toolCalls?: ConversationMessage['toolCalls'],
): ConversationMessage => ({ id, type: 'ai', content, toolCalls })

describe('groupCallsByRequest', () => {
  it('groups by request id and orders oldest first', () => {
    const groups = groupCallsByRequest([
      call('c3', 'r2', '2026-10-01T12:00:05Z'),
      call('c2', 'r1', '2026-10-01T11:00:05Z'),
      call('c1', 'r1', '2026-10-01T11:00:01Z'),
    ])

    expect(groups.map(g => g.map(c => c.id))).toEqual([['c1', 'c2'], ['c3']])
  })
})

describe('buildTranscriptItems', () => {
  it('collapses tool calls and attaches calls to the final reply of a turn', () => {
    const items = buildTranscriptItems(
      [
        human('h1'),
        ai('a0', '', [{ name: 'web_search', args: { q: 'x' } }]),
        { id: 't1', type: 'tool', name: 'web_search', content: 'results' },
        ai('a1', 'answer'),
      ],
      [
        call('c1', 'r1', '2026-10-01T11:00:01Z'),
        call('c2', 'r1', '2026-10-01T11:00:02Z'),
      ],
    )

    expect(items.map(i => i.kind)).toEqual([
      'human',
      'tool',
      'tool',
      'assistant',
    ])
    const reply = items[3]
    expect(reply.kind === 'assistant' && reply.calls.map(c => c.id)).toEqual([
      'c1',
      'c2',
    ])
  })

  it('pairs requests with turns from the newest end', () => {
    const items = buildTranscriptItems(
      [human('h1'), ai('a1', 'one'), human('h2'), ai('a2', 'two')],
      [call('c1', 'r1', '2026-10-01T11:00:01Z')],
    )

    const replies = items.filter(i => i.kind === 'assistant')
    expect(replies.map(r => r.kind === 'assistant' && r.calls.length)).toEqual([
      0, 1,
    ])
  })

  it('joins calls by request id when a turn made no calls and the range is partial', () => {
    const reply = (id: string, requestId: string): ConversationMessage => ({
      ...ai(id, id),
      requestId,
    })
    const items = buildTranscriptItems(
      [
        human('h1'),
        reply('a1', 'r1'),
        human('h2'),
        reply('a2', 'r2'),
        human('h3'),
        reply('a3', 'r3'),
      ],
      [
        call('c1', 'r1', '2026-10-01T11:00:01Z'),
        call('c3', 'r3', '2026-10-01T13:00:01Z'),
      ],
    )

    const replies = items.filter(i => i.kind === 'assistant')
    expect(
      replies.map(r => r.kind === 'assistant' && r.calls.map(c => c.id)),
    ).toEqual([['c1'], [], ['c3']])
  })
})
