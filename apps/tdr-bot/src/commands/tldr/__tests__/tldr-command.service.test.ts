import { createMockMetricsService } from 'src/__tests__/test-utils'
import { TldrService } from 'src/commands/tldr/tldr.service'
import { TldrCommandService } from 'src/commands/tldr/tldr-command.service'
import { TldrError, TldrWindow } from 'src/commands/tldr/types'
import { TldrWindowService } from 'src/commands/tldr/window.service'

jest.mock('discord.js', () => ({
  MessageFlags: { Ephemeral: 64 },
  ChannelType: {
    GuildText: 0,
    GuildAnnouncement: 5,
    AnnouncementThread: 10,
    PublicThread: 11,
    PrivateThread: 12,
  },
}))

jest.mock('necord', () => {
  const decorator = () => () => undefined
  return {
    SlashCommand: jest.fn(decorator),
    Context: jest.fn(decorator),
    Options: jest.fn(decorator),
    StringOption: jest.fn(decorator),
    UserOption: jest.fn(decorator),
    ChannelOption: jest.fn(decorator),
  }
})

const SADGE = '<:Sadge:781403152258826281>'

function makeWindow(overrides: Partial<TldrWindow> = {}): TldrWindow {
  return {
    guildId: 'g1',
    channelId: 'c1',
    channelName: 'general',
    since: new Date('2026-10-14T16:00:00Z'),
    sinceSource: 'lastMessage',
    messages: [],
    threadCount: 0,
    clipped: false,
    ...overrides,
  }
}

function createInteraction({ inGuild = true }: { inGuild?: boolean } = {}) {
  return {
    inCachedGuild: jest.fn().mockReturnValue(inGuild),
    user: { id: 'u1', username: 'alice' },
    member: { displayName: 'Alice' },
    channel: { id: 'c1', name: 'general' },
    guild: { members: { cache: new Map<string, { displayName: string }>() } },
    guildId: 'g1',
    reply: jest.fn().mockResolvedValue(undefined),
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
  }
}

type Interaction = ReturnType<typeof createInteraction>
type OnTldr = TldrCommandService['onTldr']

describe('TldrCommandService', () => {
  let windowService: { fetch: jest.Mock }
  let tldrService: { summarize: jest.Mock }
  let service: TldrCommandService

  const run = (
    interaction: Interaction,
    options: {
      since?: string | null
      from?: unknown
      channel?: unknown
      question?: string | null
    } = {},
  ) =>
    service.onTldr(
      [interaction] as unknown as Parameters<OnTldr>[0],
      {
        since: null,
        from: null,
        channel: null,
        question: null,
        ...options,
      } as Parameters<OnTldr>[1],
    )

  beforeEach(() => {
    windowService = { fetch: jest.fn().mockResolvedValue(makeWindow()) }
    tldrService = { summarize: jest.fn().mockResolvedValue(['summary']) }
    service = new TldrCommandService(
      windowService as unknown as TldrWindowService,
      tldrService as unknown as TldrService,
      createMockMetricsService(),
    )
  })

  it('replies ephemerally and does not defer outside a server', async () => {
    const interaction = createInteraction({ inGuild: false })

    await run(interaction)

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'that only works in a server',
      flags: [64],
    })
    expect(interaction.deferReply).not.toHaveBeenCalled()
    expect(windowService.fetch).not.toHaveBeenCalled()
  })

  it('replies ephemerally with examples for an unreadable since', async () => {
    const interaction = createInteraction()

    await run(interaction, { since: 'whenever' })

    const reply = interaction.reply.mock.calls[0][0]
    expect(reply.flags).toEqual([64])
    expect(reply.content).toContain('`2h`')
    expect(reply.content).toContain('`yesterday`')
    expect(interaction.deferReply).not.toHaveBeenCalled()
  })

  it('replies ephemerally for a since in the future', async () => {
    const interaction = createInteraction()

    await run(interaction, { since: '12/31/2999' })

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "that's in the future",
      flags: [64],
    })
    expect(windowService.fetch).not.toHaveBeenCalled()
  })

  it('defers publicly, fetches the chosen channel and posts every chunk', async () => {
    const interaction = createInteraction()
    const channel = { id: 'c2', name: 'other' }
    tldrService.summarize.mockResolvedValue(['one', 'two', 'three'])
    const before = Date.now()

    await run(interaction, { since: '2h', channel })

    expect(interaction.deferReply).toHaveBeenCalledWith()
    const params = windowService.fetch.mock.calls[0][0]
    expect(params.channel).toBe(channel)
    expect(params.requester).toBe(interaction.member)
    const expected = before - 2 * 60 * 60 * 1000
    expect(Math.abs(params.since.getTime() - expected)).toBeLessThan(5_000)
    expect(tldrService.summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        requester: { id: 'u1', name: 'Alice' },
        from: null,
        question: null,
      }),
    )
    expect(interaction.editReply).toHaveBeenCalledWith('one')
    expect(interaction.followUp.mock.calls).toEqual([['two'], ['three']])
  })

  it('defaults to this channel and passes a null since', async () => {
    const interaction = createInteraction()

    await run(interaction)

    const params = windowService.fetch.mock.calls[0][0]
    expect(params.channel).toBe(interaction.channel)
    expect(params.since).toBeNull()
  })

  it('names the from user by server display name, else their own', async () => {
    const interaction = createInteraction()
    interaction.guild.members.cache.set('u2', { displayName: 'Bobby' })

    await run(interaction, {
      from: { id: 'u2', displayName: 'Bob' },
      question: 'what happened?',
    })
    await run(interaction, { from: { id: 'u3', displayName: 'Cara' } })

    expect(tldrService.summarize.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        from: { id: 'u2', name: 'Bobby' },
        question: 'what happened?',
      }),
    )
    expect(tldrService.summarize.mock.calls[1][0].from).toEqual({
      id: 'u3',
      name: 'Cara',
    })
  })

  it('edits an empty result with a message naming the channel', async () => {
    const interaction = createInteraction()
    tldrService.summarize.mockRejectedValue(new TldrError('empty'))

    await run(interaction)

    const text = interaction.editReply.mock.calls[0][0]
    expect(text).toContain('nothing new in #general since')
    expect(text).toContain(SADGE)
    expect(interaction.followUp).not.toHaveBeenCalled()
  })

  it('explains a no_access error', async () => {
    const interaction = createInteraction()
    windowService.fetch.mockRejectedValue(new TldrError('no_access'))

    await run(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(
      "you can't read that channel, so neither will I",
    )
  })

  it('explains a bot_no_access error', async () => {
    const interaction = createInteraction()
    windowService.fetch.mockRejectedValue(new TldrError('bot_no_access'))

    await run(interaction)

    expect(interaction.editReply).toHaveBeenCalledWith(
      "I can't read that channel",
    )
  })

  it('answers an unknown error with the Sadge text and does not throw', async () => {
    const interaction = createInteraction()
    windowService.fetch.mockRejectedValue(new Error('boom'))

    await expect(run(interaction)).resolves.toBeUndefined()

    expect(interaction.editReply).toHaveBeenCalledWith(
      `sorry, couldn't put that together right now ${SADGE}`,
    )
  })

  it('allows one run per user at a time and releases it afterwards', async () => {
    let finish!: (chunks: string[]) => void
    tldrService.summarize.mockReturnValueOnce(
      new Promise<string[]>(resolve => {
        finish = resolve
      }),
    )
    const first = createInteraction()
    const second = createInteraction()

    const pending = run(first)
    await new Promise(resolve => setImmediate(resolve))
    await run(second)

    expect(second.reply).toHaveBeenCalledWith({
      content: 'still working on your last /tldr',
      flags: [64],
    })
    expect(second.deferReply).not.toHaveBeenCalled()

    finish(['done'])
    await pending
    expect(first.editReply).toHaveBeenCalledWith('done')

    const third = createInteraction()
    await run(third)
    expect(third.deferReply).toHaveBeenCalled()
    expect(third.editReply).toHaveBeenCalledWith('summary')
  })

  it('releases the user after a failed run', async () => {
    windowService.fetch.mockRejectedValueOnce(new Error('boom'))

    await run(createInteraction())
    const next = createInteraction()
    await run(next)

    expect(next.editReply).toHaveBeenCalledWith('summary')
  })
})
