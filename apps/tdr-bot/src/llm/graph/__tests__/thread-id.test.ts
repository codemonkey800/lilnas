import { GRAPH_TEST_THREAD_ID, threadIdFor } from 'src/llm/graph/thread-id'

describe('threadIdFor', () => {
  it('is the channel id, for guild channels and DMs alike', () => {
    expect(threadIdFor({ channelId: 'chan-1' })).toBe('chan-1')
    expect(threadIdFor({ channelId: 'dm-7' })).toBe('dm-7')
  })

  it('gives graph-test its own thread', () => {
    expect(GRAPH_TEST_THREAD_ID).toBe('graph-test')
  })
})
