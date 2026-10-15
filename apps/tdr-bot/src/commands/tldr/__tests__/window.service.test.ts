import { Client, GuildBasedChannel, GuildMember } from 'discord.js'

import {
  FALLBACK_MESSAGE_COUNT,
  MAX_THREADS,
  MAX_WINDOW_MESSAGES,
  TldrError,
  TldrWindow,
} from 'src/commands/tldr/types'
import { TldrWindowService } from 'src/commands/tldr/window.service'

jest.mock('discord.js', () => ({
  Client: class Client {},
  ChannelType: {
    GuildText: 0,
    GuildVoice: 2,
    GuildAnnouncement: 5,
    AnnouncementThread: 10,
    PublicThread: 11,
    PrivateThread: 12,
  },
  PermissionFlagsBits: {
    ViewChannel: 1n << 10n,
    ReadMessageHistory: 1n << 16n,
    ManageThreads: 1n << 34n,
  },
  // Test message and thread ids are their own timestamps.
  SnowflakeUtil: { timestampFrom: (id: string) => Number(id) },
}))

const ChannelType = {
  GuildText: 0,
  GuildVoice: 2,
  GuildAnnouncement: 5,
  AnnouncementThread: 10,
  PublicThread: 11,
  PrivateThread: 12,
}
const View = 1n << 10n
const ReadHistory = 1n << 16n
const ManageThreads = 1n << 34n

const T0 = 1_700_000_000_000
const BOT_ID = 'bot'
const REQUESTER_ID = 'requester'

interface FakeMessageInit {
  /** Seconds after T0; doubles as the message id. */
  at: number
  authorId?: string
  authorName?: string
  memberName?: string | null
  bot?: boolean
  content?: string
  system?: boolean
  interaction?: boolean
  attachments?: string[]
  embeds?: Array<{ title?: string | null; url?: string | null }>
  replyTo?: string
}

const fakeMessage = ({
  at,
  authorId = 'someone',
  authorName = 'Someone',
  memberName = null,
  bot = false,
  content = `message ${at}`,
  system = false,
  interaction = false,
  attachments = [],
  embeds = [],
  replyTo,
}: FakeMessageInit) => {
  const ts = T0 + at * 1000
  return {
    id: String(ts),
    channelId: 'channel',
    createdTimestamp: ts,
    createdAt: new Date(ts),
    system,
    author: { id: authorId, displayName: authorName, bot },
    member: memberName ? { displayName: memberName } : null,
    cleanContent: content,
    attachments: new Map(
      attachments.map((name, i) => [String(i), { name }] as const),
    ),
    embeds,
    interactionMetadata: interaction ? { id: 'interaction' } : null,
    reference: replyTo ? { messageId: replyTo } : null,
    url: `https://discord.com/channels/g1/channel/${ts}`,
  }
}

type FakeMessage = ReturnType<typeof fakeMessage>

/** Pages `messages` newest-first by `before`, like the Discord API. */
const fakeMessageManager = (messages: FakeMessage[]) => ({
  fetch: jest.fn(
    async ({ limit, before }: { limit: number; before?: string }) => {
      const older = messages
        .filter(
          m => before === undefined || m.createdTimestamp < Number(before),
        )
        .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
        .slice(0, limit)
      return new Map(older.map(m => [m.id, m]))
    },
  ),
})

const fakePermissions = (granted: bigint[]) => ({
  has: (flag: bigint) => granted.includes(flag),
})

const OPEN = [View, ReadHistory]

interface FakeThreadInit {
  id: number
  name?: string
  type?: number
  /** Seconds after T0 of the last message; null for none. */
  lastAt?: number | null
  messages?: FakeMessage[]
  requesterPermissions?: bigint[]
  requesterIsMember?: boolean
}

const fakeThread = ({
  id,
  name = `thread-${id}`,
  type = ChannelType.PublicThread,
  lastAt,
  messages = [],
  requesterPermissions = OPEN,
  requesterIsMember = true,
}: FakeThreadInit) => ({
  id: String(id),
  name,
  type,
  lastMessageId:
    lastAt === null
      ? null
      : String(
          lastAt === undefined
            ? Math.max(T0, ...messages.map(m => m.createdTimestamp))
            : T0 + lastAt * 1000,
        ),
  archiveTimestamp: null,
  createdTimestamp: T0,
  messages: fakeMessageManager(messages),
  members: {
    fetch: jest.fn(async () => {
      if (!requesterIsMember) throw new Error('Unknown Member')
      return {}
    }),
  },
  permissionsFor: jest.fn((member: { id: string }) => {
    if (member.id === REQUESTER_ID) return fakePermissions(requesterPermissions)
    if (member.id === BOT_ID) return fakePermissions(OPEN)
    return null
  }),
})

type FakeThread = ReturnType<typeof fakeThread>

interface FakeChannelInit {
  type?: number
  messages?: FakeMessage[]
  requesterPermissions?: bigint[]
  botPermissions?: bigint[]
  hasBotMember?: boolean
  active?: FakeThread[]
  archived?: FakeThread[]
}

const requester = { id: REQUESTER_ID, displayName: 'Requester' }
const botMember = { id: BOT_ID }

const fakeChannel = ({
  type = ChannelType.GuildText,
  messages = [],
  requesterPermissions = OPEN,
  botPermissions = OPEN,
  hasBotMember = true,
  active = [],
  archived = [],
}: FakeChannelInit = {}) => ({
  id: 'channel',
  name: 'general',
  type,
  guild: { id: 'g1', members: { me: hasBotMember ? botMember : null } },
  messages: fakeMessageManager(messages),
  threads: {
    fetchActive: jest.fn(async () => ({
      threads: new Map(active.map(t => [t.id, t])),
    })),
    fetchArchived: jest.fn(async () => ({
      threads: new Map(archived.map(t => [t.id, t])),
      hasMore: false,
    })),
  },
  permissionsFor: jest.fn((member: { id: string }) => {
    if (member.id === REQUESTER_ID) return fakePermissions(requesterPermissions)
    if (member.id === BOT_ID) return fakePermissions(botPermissions)
    return null
  }),
})

/** `count` messages from other people, one per second from T0 + 1s. */
const manyMessages = (count: number, authorId = 'someone'): FakeMessage[] =>
  Array.from({ length: count }, (_, i) => fakeMessage({ at: i + 1, authorId }))

describe('TldrWindowService', () => {
  let service: TldrWindowService

  const run = (
    channel: ReturnType<typeof fakeChannel> | FakeThread,
    since: Date | null = null,
  ): Promise<TldrWindow> =>
    service.fetch({
      channel: channel as unknown as GuildBasedChannel,
      requester: requester as unknown as GuildMember,
      since,
    })

  beforeEach(() => {
    service = new TldrWindowService({
      user: { id: BOT_ID },
    } as unknown as Client)
  })

  describe('access checks', () => {
    it('rejects channel types that cannot be summarized', async () => {
      const channel = fakeChannel({ type: ChannelType.GuildVoice })

      await expect(run(channel)).rejects.toMatchObject({
        code: 'unsupported_channel',
      })
      expect(channel.messages.fetch).not.toHaveBeenCalled()
    })

    it('rejects a requester without ReadMessageHistory', async () => {
      const channel = fakeChannel({ requesterPermissions: [View] })

      await expect(run(channel)).rejects.toMatchObject({ code: 'no_access' })
      expect(channel.messages.fetch).not.toHaveBeenCalled()
    })

    it('rejects a requester without ViewChannel', async () => {
      const channel = fakeChannel({ requesterPermissions: [ReadHistory] })

      await expect(run(channel)).rejects.toBeInstanceOf(TldrError)
      await expect(run(channel)).rejects.toMatchObject({ code: 'no_access' })
    })

    it('rejects when the bot lacks access', async () => {
      const channel = fakeChannel({ botPermissions: [View] })

      await expect(run(channel)).rejects.toMatchObject({
        code: 'bot_no_access',
      })
      expect(channel.messages.fetch).not.toHaveBeenCalled()
    })

    it('rejects when the bot is not a guild member', async () => {
      const channel = fakeChannel({ hasBotMember: false })

      await expect(run(channel)).rejects.toMatchObject({
        code: 'bot_no_access',
      })
    })

    it('rejects a private thread the requester has not joined', async () => {
      const thread = fakeThread({
        id: 1,
        type: ChannelType.PrivateThread,
        requesterIsMember: false,
      })
      Object.assign(thread, {
        guild: { id: 'g1', members: { me: botMember } },
      })

      await expect(run(thread)).rejects.toMatchObject({ code: 'no_access' })
    })
  })

  describe('explicit since', () => {
    it('stops paging at the page holding since and drops older messages', async () => {
      const channel = fakeChannel({ messages: manyMessages(250) })
      const since = new Date(T0 + 120 * 1000)

      const window = await run(channel, since)

      // Messages 120..250 inclusive: 131 messages over two pages.
      expect(channel.messages.fetch).toHaveBeenCalledTimes(2)
      expect(window.messages).toHaveLength(131)
      expect(window.messages[0].createdAt).toEqual(since)
      expect(window.messages.at(-1)?.createdAt).toEqual(
        new Date(T0 + 250 * 1000),
      )
      expect(window.since).toEqual(since)
      expect(window.sinceSource).toBe('option')
      expect(window.clipped).toBe(false)
      expect(window.threadCount).toBe(0)
    })

    it('stops on a short page when history ends before since', async () => {
      const channel = fakeChannel({ messages: manyMessages(30) })

      const window = await run(channel, new Date(T0 - 3600_000))

      expect(channel.messages.fetch).toHaveBeenCalledTimes(1)
      expect(window.messages).toHaveLength(30)
    })

    it('returns an empty window instead of an error', async () => {
      const channel = fakeChannel({ messages: [] })
      const since = new Date(T0)

      const window = await run(channel, since)

      expect(window.messages).toEqual([])
      expect(window.since).toEqual(since)
      expect(window.sinceSource).toBe('option')
    })

    it('clips a window over the cap to the newest messages', async () => {
      const channel = fakeChannel({ messages: manyMessages(1200) })

      const window = await run(channel, new Date(T0))

      expect(window.clipped).toBe(true)
      expect(window.messages).toHaveLength(MAX_WINDOW_MESSAGES)
      expect(window.messages.at(-1)?.createdAt).toEqual(
        new Date(T0 + 1200 * 1000),
      )
      // Oldest kept is message 201; since moves up to it.
      expect(window.messages[0].createdAt).toEqual(new Date(T0 + 201 * 1000))
      expect(window.since).toEqual(window.messages[0].createdAt)
      expect(window.sinceSource).toBe('option')
      expect(channel.messages.fetch).toHaveBeenCalledTimes(10)
    })
  })

  describe('default rule', () => {
    it('starts after the requester’s last message and excludes it', async () => {
      const messages = [
        ...manyMessages(60).filter(
          m =>
            m.createdTimestamp !== T0 + 40_000 &&
            m.createdTimestamp !== T0 + 10_000,
        ),
        fakeMessage({ at: 40, authorId: REQUESTER_ID, content: 'mine' }),
        fakeMessage({ at: 10, authorId: REQUESTER_ID }),
      ]
      const channel = fakeChannel({ messages })

      const window = await run(channel)

      expect(window.sinceSource).toBe('lastMessage')
      expect(window.since).toEqual(new Date(T0 + 40 * 1000))
      expect(window.messages).toHaveLength(20)
      expect(window.messages[0].createdAt).toEqual(new Date(T0 + 41 * 1000))
      expect(window.messages.some(m => m.authorId === REQUESTER_ID)).toBe(false)
    })

    it('returns an empty window when the requester posted last', async () => {
      const channel = fakeChannel({
        messages: [
          ...manyMessages(5),
          fakeMessage({ at: 6, authorId: REQUESTER_ID }),
        ],
      })

      const window = await run(channel)

      expect(window.sinceSource).toBe('lastMessage')
      expect(window.messages).toEqual([])
    })

    it('falls back to the newest messages when the requester never posted', async () => {
      const channel = fakeChannel({ messages: manyMessages(150) })

      const window = await run(channel)

      expect(window.sinceSource).toBe('fallback')
      expect(window.messages).toHaveLength(FALLBACK_MESSAGE_COUNT)
      expect(window.messages[0].createdAt).toEqual(new Date(T0 + 51 * 1000))
      expect(window.since).toEqual(window.messages[0].createdAt)
      expect(window.clipped).toBe(false)
    })

    it('does not look past the scan cap for the requester’s message', async () => {
      const channel = fakeChannel({
        messages: [
          fakeMessage({ at: 0, authorId: REQUESTER_ID }),
          ...manyMessages(1500),
        ],
      })

      const window = await run(channel)

      expect(window.sinceSource).toBe('fallback')
      expect(window.messages).toHaveLength(FALLBACK_MESSAGE_COUNT)
      expect(channel.messages.fetch).toHaveBeenCalledTimes(10)
    })
  })

  describe('message filtering and mapping', () => {
    it('drops system messages, earlier slash replies and empty messages', async () => {
      const channel = fakeChannel({
        messages: [
          fakeMessage({ at: 1, content: 'kept' }),
          fakeMessage({ at: 2, system: true, content: 'joined' }),
          fakeMessage({
            at: 3,
            authorId: BOT_ID,
            bot: true,
            interaction: true,
            content: 'old summary',
          }),
          fakeMessage({ at: 4, content: '' }),
          fakeMessage({
            at: 5,
            authorId: BOT_ID,
            bot: true,
            content: 'bot chat reply',
          }),
          fakeMessage({
            at: 6,
            authorId: 'other-bot',
            bot: true,
            interaction: true,
            content: 'another bot slash reply',
          }),
        ],
      })

      const window = await run(channel, new Date(T0))

      expect(window.messages.map(m => m.content)).toEqual([
        'kept',
        'bot chat reply',
        'another bot slash reply',
      ])
    })

    it('keeps messages that only have attachments or embeds', async () => {
      const channel = fakeChannel({
        messages: [
          fakeMessage({ at: 1, content: '', attachments: ['cat.png'] }),
          fakeMessage({ at: 2, content: '', embeds: [{ title: 'Embed' }] }),
        ],
      })

      const window = await run(channel, new Date(T0))

      expect(window.messages).toHaveLength(2)
    })

    it('maps message fields', async () => {
      const channel = fakeChannel({
        messages: [
          fakeMessage({
            at: 1,
            authorId: 'u1',
            authorName: 'Global Name',
            memberName: 'Server Nick',
            bot: true,
            content: 'hello @x',
            attachments: ['a.png', 'b.pdf'],
            embeds: [
              { title: 'Title', url: 'https://t.example' },
              { title: null, url: 'https://only-url.example' },
              { title: null, url: null },
            ],
            replyTo: '42',
          }),
          fakeMessage({ at: 2, authorName: 'No Member' }),
        ],
      })

      const window = await run(channel, new Date(T0))

      expect(window).toMatchObject({
        guildId: 'g1',
        channelId: 'channel',
        channelName: 'general',
      })
      expect(window.messages[0]).toEqual({
        id: String(T0 + 1000),
        channelId: 'channel',
        threadName: null,
        authorId: 'u1',
        authorName: 'Server Nick',
        isBot: true,
        createdAt: new Date(T0 + 1000),
        content: 'hello @x',
        attachments: ['a.png', 'b.pdf'],
        embedTitles: ['Title', 'https://only-url.example'],
        replyToId: '42',
        url: `https://discord.com/channels/g1/channel/${T0 + 1000}`,
      })
      expect(window.messages[1].authorName).toBe('No Member')
      expect(window.messages[1].replyToId).toBeNull()
    })
  })

  describe('threads', () => {
    const since = new Date(T0 + 100 * 1000)

    it('reads recent threads and merges chronologically', async () => {
      const active = fakeThread({
        id: 1,
        name: 'planning',
        messages: [
          fakeMessage({ at: 112, content: 'thread b' }),
          fakeMessage({ at: 104, content: 'thread a' }),
        ],
      })
      const archived = fakeThread({
        id: 2,
        name: 'old-but-recent',
        messages: [fakeMessage({ at: 108, content: 'archived a' })],
      })
      const channel = fakeChannel({
        messages: [
          fakeMessage({ at: 101, content: 'main 1' }),
          fakeMessage({ at: 106, content: 'main 2' }),
          fakeMessage({ at: 120, content: 'main 3' }),
        ],
        active: [active],
        archived: [archived],
      })

      const window = await run(channel, since)

      expect(channel.threads.fetchArchived).toHaveBeenCalledWith({
        type: 'public',
      })
      expect(window.threadCount).toBe(2)
      expect(window.messages.map(m => [m.content, m.threadName])).toEqual([
        ['main 1', null],
        ['thread a', 'planning'],
        ['main 2', null],
        ['archived a', 'old-but-recent'],
        ['thread b', 'planning'],
        ['main 3', null],
      ])
    })

    it('uses the requester’s last message as the thread cutoff', async () => {
      const thread = fakeThread({
        id: 1,
        messages: [
          fakeMessage({ at: 5, content: 'before' }),
          fakeMessage({ at: 15, content: 'after' }),
        ],
        lastAt: 15,
      })
      const channel = fakeChannel({
        messages: [fakeMessage({ at: 10, authorId: REQUESTER_ID })],
        active: [thread],
      })

      const window = await run(channel)

      expect(window.sinceSource).toBe('lastMessage')
      expect(window.messages.map(m => m.content)).toEqual(['after'])
    })

    it('skips threads whose last activity is before since', async () => {
      const stale = fakeThread({
        id: 1,
        lastAt: 50,
        messages: [fakeMessage({ at: 50, content: 'stale' })],
      })
      const channel = fakeChannel({
        messages: [fakeMessage({ at: 101 })],
        active: [stale],
      })

      const window = await run(channel, since)

      expect(stale.messages.fetch).not.toHaveBeenCalled()
      expect(window.threadCount).toBe(0)
      expect(window.messages).toHaveLength(1)
    })

    it('falls back to archive time for threads with no last message', async () => {
      const empty = fakeThread({ id: 1, lastAt: null })
      Object.assign(empty, { archiveTimestamp: T0 + 150 * 1000 })
      const channel = fakeChannel({ active: [empty] })

      await run(channel, since)

      expect(empty.messages.fetch).toHaveBeenCalled()
    })

    it('skips private threads the requester cannot view', async () => {
      const hidden = fakeThread({
        id: 1,
        type: ChannelType.PrivateThread,
        requesterPermissions: [],
        messages: [fakeMessage({ at: 110, content: 'secret' })],
      })
      const notMember = fakeThread({
        id: 2,
        type: ChannelType.PrivateThread,
        requesterIsMember: false,
        messages: [fakeMessage({ at: 111, content: 'members only' })],
      })
      const member = fakeThread({
        id: 3,
        type: ChannelType.PrivateThread,
        name: 'mine',
        messages: [fakeMessage({ at: 112, content: 'visible' })],
      })
      const manager = fakeThread({
        id: 4,
        type: ChannelType.PrivateThread,
        name: 'managed',
        requesterIsMember: false,
        requesterPermissions: [...OPEN, ManageThreads],
        messages: [fakeMessage({ at: 113, content: 'managed' })],
      })
      const channel = fakeChannel({
        active: [hidden, notMember, member, manager],
      })

      const window = await run(channel, since)

      expect(hidden.messages.fetch).not.toHaveBeenCalled()
      expect(notMember.messages.fetch).not.toHaveBeenCalled()
      expect(window.messages.map(m => m.content)).toEqual([
        'visible',
        'managed',
      ])
      expect(window.threadCount).toBe(2)
    })

    it('does not count threads that contribute no messages', async () => {
      const quiet = fakeThread({
        id: 1,
        lastAt: 110,
        messages: [fakeMessage({ at: 110, system: true })],
      })
      const channel = fakeChannel({ active: [quiet] })

      const window = await run(channel, since)

      expect(window.threadCount).toBe(0)
      expect(window.messages).toEqual([])
    })

    it('reads only the newest MAX_THREADS threads', async () => {
      const total = MAX_THREADS + 5
      const threads = Array.from({ length: total }, (_, i) =>
        fakeThread({
          id: i + 1,
          lastAt: 101 + i,
          messages: [fakeMessage({ at: 101 + i })],
        }),
      )
      const channel = fakeChannel({ active: threads })

      const window = await run(channel, since)

      expect(window.threadCount).toBe(MAX_THREADS)
      const read = threads.filter(t => t.messages.fetch.mock.calls.length > 0)
      expect(read.map(t => t.id)).toEqual(
        threads.slice(total - MAX_THREADS).map(t => t.id),
      )
    })

    it('survives a thread that fails to load', async () => {
      const broken = fakeThread({ id: 1, lastAt: 110 })
      broken.messages.fetch.mockRejectedValue(new Error('Missing Access'))
      const channel = fakeChannel({
        messages: [fakeMessage({ at: 101 })],
        active: [broken],
      })

      const window = await run(channel, since)

      expect(window.messages).toHaveLength(1)
      expect(window.threadCount).toBe(0)
    })

    it('clips merged parent and thread messages to the cap', async () => {
      const thread = fakeThread({
        id: 1,
        messages: Array.from({ length: 300 }, (_, i) =>
          fakeMessage({ at: 2000 + i, content: `t${i}` }),
        ),
        lastAt: 2300,
      })
      const channel = fakeChannel({
        messages: Array.from({ length: 900 }, (_, i) =>
          fakeMessage({ at: 1000 + i, content: `p${i}` }),
        ),
        active: [thread],
      })

      const window = await run(channel, new Date(T0 + 1000 * 1000))

      expect(window.clipped).toBe(true)
      expect(window.messages).toHaveLength(MAX_WINDOW_MESSAGES)
      expect(window.since).toEqual(window.messages[0].createdAt)
      expect(window.messages.at(-1)?.content).toBe('t299')
      expect(window.sinceSource).toBe('option')
    })
  })

  describe('thread as the target', () => {
    it('summarizes the thread alone', async () => {
      const thread = fakeThread({
        id: 7,
        name: 'side-chat',
        messages: manyMessages(5),
      })
      Object.assign(thread, {
        guild: { id: 'g1', members: { me: botMember } },
      })

      const window = await run(thread, new Date(T0))

      expect(window.channelId).toBe('7')
      expect(window.channelName).toBe('side-chat')
      expect(window.messages).toHaveLength(5)
      expect(window.messages.every(m => m.threadName === null)).toBe(true)
      expect(window.threadCount).toBe(0)
    })
  })
})
