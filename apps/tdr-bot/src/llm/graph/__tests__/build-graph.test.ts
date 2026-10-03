import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'

import { trimConversation } from 'src/llm/conversation/trim'
import { buildGraph, FOLLOW_UP_TTL_MS } from 'src/llm/graph/build-graph'
import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'
import { runWithRequestContext } from 'src/llm/observability/request-context'
import { Skill, SkillOutput } from 'src/llm/skills/skill.interface'
import { SkillRegistry } from 'src/llm/skills/skill.registry'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'

const discord = { userId: 'u1', username: 'user' }

function makeSkill(
  id: string,
  run: Skill['run'],
  match?: Skill['match'],
): Skill & { run: jest.Mock } {
  return { id, description: `${id} skill`, match, run: jest.fn(run) }
}

const reply = (text: string, extra: Partial<SkillOutput> = {}) =>
  Promise.resolve({ messages: [new AIMessage(text)], ...extra })

function setup(skills: Skill[]) {
  const llm = new FakeLlmClient()
  const metrics = { routerDecision: jest.fn() }
  const graph = buildGraph({
    registry: new SkillRegistry(skills),
    llm,
    metrics: metrics as unknown as LlmMetricsService,
    trim: trimConversation,
    systemPrompt: () => new SystemMessage('system'),
    checkpointer: new MemorySaver(),
  })
  const send = (text: string, userId = 'u1', threadId = 't1') =>
    graph.invoke(
      {
        messages: [new HumanMessage(text)],
        userId,
        channelId: 'c1',
        guildId: 'g1',
        discord: { ...discord, userId },
      },
      { configurable: { thread_id: threadId } },
    )
  return { llm, metrics, send, graph }
}

describe('buildGraph', () => {
  let echo: ReturnType<typeof makeSkill>
  let other: ReturnType<typeof makeSkill>
  let chat: ReturnType<typeof makeSkill>

  beforeEach(() => {
    echo = makeSkill(
      'echo',
      () => reply('echoed'),
      input => /^echo/.test(String(input.message.content)),
    )
    other = makeSkill('other', () => reply('other done'))
    chat = makeSkill('chat', () => reply('chat done'))
  })

  it('routes to a skill whose match() accepts the message', async () => {
    const { send, metrics, llm } = setup([echo, other, chat])
    const result = await send('echo hi')

    expect(result.messages.at(-1)?.content).toBe('echoed')
    expect(llm.calls).toHaveLength(0)
    expect(metrics.routerDecision).toHaveBeenCalledWith({
      skill: 'echo',
      source: 'fastpath',
    })
  })

  it('stamps AI replies with the active request id', async () => {
    const { send } = setup([echo, other, chat])
    const result = await runWithRequestContext({ requestId: 'req-1' }, () =>
      send('echo hi'),
    )

    expect(result.messages.at(-1)?.additional_kwargs.requestId).toBe('req-1')
  })

  it('asks the router LLM when no fast path matches', async () => {
    const { send, metrics, llm } = setup([echo, other, chat])
    llm.script('router.classify', { skill: 'other' })
    const result = await send('something')

    expect(result.messages.at(-1)?.content).toBe('other done')
    expect(llm.calls[0].role).toBe('reasoning')
    expect(metrics.routerDecision).toHaveBeenCalledWith({
      skill: 'other',
      source: 'llm',
    })
    const system = llm.calls[0].messages[0].content as string
    expect(system).toContain('echo: echo skill')
    expect(system).toContain('other: other skill')
  })

  it('falls back to chat when the router LLM fails', async () => {
    const { send, llm } = setup([echo, other, chat])
    llm.script('router.classify', new Error('boom'))
    const result = await send('something')

    expect(result.messages.at(-1)?.content).toBe('chat done')
  })

  it('falls back to chat when the router LLM returns an unknown skill', async () => {
    const { send, llm } = setup([echo, other, chat])
    llm.script('router.classify', () => ({ skill: 'nope' }))
    const result = await send('something')

    expect(result.messages.at(-1)?.content).toBe('chat done')
  })

  it('passes the system prompt and trimmed history to the skill', async () => {
    const { send } = setup([echo, chat])
    await send('echo one')
    await send('echo two')

    const input = echo.run.mock.calls[1][0]
    expect(input.message.content).toBe('echo two')
    expect(input.history[0].content).toBe('system')
    expect(input.history.map((m: { content: unknown }) => m.content)).toEqual([
      'system',
      'echo one',
      'echoed',
    ])
    expect(input.userId).toBe('u1')
    expect(input.discord).toEqual(discord)
  })

  it('routes the next message back to a skill that asked for a follow-up, then clears it', async () => {
    echo.run
      .mockImplementationOnce(() =>
        reply('which one?', { followUp: { data: { n: 1 } } }),
      )
      .mockImplementationOnce(() => reply('got it'))
    const { send, metrics, llm } = setup([echo, other, chat])

    await send('echo start')
    const second = await send('the second')
    const third = await send('plain message')

    expect(second.messages.at(-1)?.content).toBe('got it')
    expect(echo.run.mock.calls[1][0].followUp).toEqual({ n: 1 })
    expect(metrics.routerDecision).toHaveBeenNthCalledWith(2, {
      skill: 'echo',
      source: 'followup',
    })
    // Cleared: the third message is classified normally again.
    expect(echo.run.mock.calls).toHaveLength(2)
    expect(llm.calls).toHaveLength(1)
    expect(third.pendingFollowUps.u1).toBeUndefined()
  })

  it('stamps a follow-up with its creation time', async () => {
    echo.run.mockImplementationOnce(() =>
      reply('which one?', { followUp: { data: { n: 1 } } }),
    )
    const { send } = setup([echo, other, chat])
    const before = Date.now()

    const first = await send('echo start')

    expect(first.pendingFollowUps.u1?.createdAt).toBeGreaterThanOrEqual(before)
  })

  it('still routes back to a follow-up that is within the TTL', async () => {
    echo.run
      .mockImplementationOnce(() =>
        reply('which one?', { followUp: { data: { n: 1 } } }),
      )
      .mockImplementationOnce(() => reply('got it'))
    const { send, metrics } = setup([echo, other, chat])
    const now = Date.now()
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now)

    await send('echo start')
    spy.mockReturnValue(now + FOLLOW_UP_TTL_MS)
    await send('the second')
    spy.mockRestore()

    expect(echo.run.mock.calls[1][0].followUp).toEqual({ n: 1 })
    expect(metrics.routerDecision).toHaveBeenLastCalledWith({
      skill: 'echo',
      source: 'followup',
    })
  })

  it('ignores an expired follow-up, routes normally and does not pass it to the skill', async () => {
    echo.run.mockImplementationOnce(() =>
      reply('which one?', { followUp: { data: { n: 1 } } }),
    )
    const { send, metrics, llm } = setup([echo, other, chat])
    llm.script('router.classify', { skill: 'other' })
    const now = Date.now()
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now)

    await send('echo start')
    spy.mockReturnValue(now + FOLLOW_UP_TTL_MS + 1)
    const second = await send('the second')
    spy.mockRestore()

    expect(second.messages.at(-1)?.content).toBe('other done')
    expect(echo.run).toHaveBeenCalledTimes(1)
    expect(metrics.routerDecision).toHaveBeenLastCalledWith({
      skill: 'other',
      source: 'llm',
    })
    expect(second.pendingFollowUps.u1).toBeUndefined()
  })

  it('does not hand an expired follow-up to the same skill when it is re-picked', async () => {
    echo.run
      .mockImplementationOnce(() =>
        reply('which one?', { followUp: { data: { n: 1 } } }),
      )
      .mockImplementationOnce(() => reply('fresh'))
    const { send } = setup([echo, other, chat])
    const now = Date.now()
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now)

    await send('echo start')
    spy.mockReturnValue(now + FOLLOW_UP_TTL_MS + 1)
    await send('echo again')
    spy.mockRestore()

    expect(echo.run.mock.calls[1][0].followUp).toBeUndefined()
  })

  it('re-runs routing on the same message when a skill reroutes', async () => {
    echo.run.mockImplementationOnce(() =>
      reply('which one?', { followUp: { data: { n: 1 } } }),
    )
    echo.run.mockImplementationOnce(() =>
      Promise.resolve({ messages: [], followUp: null, reroute: true }),
    )
    const { send, metrics, llm } = setup([echo, other, chat])
    llm.script('router.classify', { skill: 'other' })

    await send('echo start')
    const second = await send('something else')

    expect(second.messages.at(-1)?.content).toBe('other done')
    expect(other.run.mock.calls[0][0].message.content).toBe('something else')
    expect(second.pendingFollowUps.u1).toBeUndefined()
    expect(metrics.routerDecision).toHaveBeenLastCalledWith({
      skill: 'other',
      source: 'llm',
    })
  })

  describe('follow-ups in a shared channel', () => {
    const asksWhich = () =>
      reply('which one?', { followUp: { data: { n: 1 } } })

    it("does not resume one user's follow-up with another user's reply", async () => {
      echo.run
        .mockImplementationOnce(asksWhich)
        .mockImplementation(() => reply('fresh'))
      const { send, metrics, llm } = setup([echo, other, chat])
      llm.script('router.classify', { skill: 'other' })

      await send('echo start', 'alice')
      const bobs = await send('the first one', 'bob')

      expect(bobs.messages.at(-1)?.content).toBe('other done')
      expect(echo.run).toHaveBeenCalledTimes(1)
      expect(metrics.routerDecision).toHaveBeenLastCalledWith({
        skill: 'other',
        source: 'llm',
      })
      expect(bobs.pendingFollowUps.alice?.data).toEqual({ n: 1 })
    })

    it("hands a follow-up back to its owner after another user's turn", async () => {
      echo.run
        .mockImplementationOnce(asksWhich)
        .mockImplementationOnce(() => reply('got it'))
      const { send, llm } = setup([echo, other, chat])
      llm.script('router.classify', { skill: 'other' })

      await send('echo start', 'alice')
      await send('unrelated', 'bob')
      const alices = await send('the first one', 'alice')

      expect(alices.messages.at(-1)?.content).toBe('got it')
      expect(echo.run.mock.calls[1][0].followUp).toEqual({ n: 1 })
      expect(echo.run.mock.calls[1][0].userId).toBe('alice')
      expect(alices.pendingFollowUps.alice).toBeUndefined()
    })

    it("keeps each user's follow-up when two flows overlap", async () => {
      echo.run
        .mockImplementationOnce(() =>
          reply('alice: which?', { followUp: { data: 'a' } }),
        )
        .mockImplementationOnce(() =>
          reply('bob: which?', { followUp: { data: 'b' } }),
        )
        .mockImplementation(() => reply('done'))
      const { send } = setup([echo, other, chat])

      await send('echo a', 'alice')
      const afterBob = await send('echo b', 'bob')
      await send('answer', 'alice')
      await send('answer', 'bob')

      expect(Object.keys(afterBob.pendingFollowUps).sort()).toEqual([
        'alice',
        'bob',
      ])
      expect(echo.run.mock.calls[2][0].followUp).toBe('a')
      expect(echo.run.mock.calls[3][0].followUp).toBe('b')
    })

    it("keeps another user's follow-up when this user's skill reroutes", async () => {
      echo.run
        .mockImplementationOnce(asksWhich)
        .mockImplementationOnce(asksWhich)
        .mockImplementationOnce(() =>
          Promise.resolve({ messages: [], followUp: null, reroute: true }),
        )
      const { send, llm } = setup([echo, other, chat])
      llm.script('router.classify', { skill: 'other' })

      await send('echo a', 'alice')
      await send('echo b', 'bob')
      const rerouted = await send('never mind', 'bob')

      expect(rerouted.pendingFollowUps.bob).toBeUndefined()
      expect(rerouted.pendingFollowUps.alice?.skill).toBe('echo')
    })

    it('drops expired follow-ups from the checkpoint on the next turn', async () => {
      echo.run.mockImplementationOnce(asksWhich)
      const { send, llm } = setup([echo, other, chat])
      llm.script('router.classify', { skill: 'other' })
      const now = Date.now()
      const spy = jest.spyOn(Date, 'now').mockReturnValue(now)

      await send('echo start', 'alice')
      spy.mockReturnValue(now + FOLLOW_UP_TTL_MS + 1)
      const bobs = await send('unrelated', 'bob')
      spy.mockRestore()

      expect(bobs.pendingFollowUps).toEqual({})
    })
  })

  it('fails finalize when the skill does not end on a non-empty AI message', async () => {
    chat = makeSkill('chat', () => reply('   '))
    const { send, llm } = setup([chat])
    llm.script('router.classify', { skill: 'chat' })

    await expect(send('hi')).rejects.toThrow(/non-empty AI message/)
  })
})
