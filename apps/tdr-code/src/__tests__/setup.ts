import 'reflect-metadata'

import { TextDecoder, TextEncoder } from 'util'

import { initBackendLogger } from 'src/logging/backend-logger'

global.TextEncoder = TextEncoder as unknown as typeof globalThis.TextEncoder
global.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder

Object.defineProperty(process.env, 'NODE_ENV', {
  value: 'test',
  writable: true,
})

// getBackendLogger() throws fail-fast when called before this runs (see
// backend-logger.ts) — without this, any spec that exercises a migrated
// non-DI file's non-debug log line (U3 onward) would crash instead of
// passing. 'bot' is an arbitrary but consistent choice: every backend spec
// runs in the same Jest 'node' project regardless of which real process the
// file under test would run in, so there is no per-spec notion of "which
// process" to match — see backend-logger.spec.ts for the integration test
// proving this actually prevents the fail-fast crash.
initBackendLogger('bot')

// Fixture name matches EnvKeys.DISCORD_API_TOKEN (the bot token env key the
// code actually reads — src/bot.module.ts, src/supervisor/supervisor.service
// .ts). The prior name here, DISCORD_BOT_TOKEN, was never read by any source
// file (confirmed via a full-source grep before this fix — bot.module.ts's
// env(EnvKeys.DISCORD_API_TOKEN, '') was silently falling back to its ''
// default the whole time), so no existing test was depending on this
// fixture's value; this rename only makes the fixture's name match reality.
process.env.DISCORD_API_TOKEN = 'test-token'
process.env.DISCORD_GUILD_ID = 'test-guild-id'
process.env.CLAUDE_COMMAND = 'claude'
process.env.CLAUDE_CWD = '/tmp'
process.env.AGENT_IDLE_TIMEOUT_SECONDS = '300'
process.env.AGENT_MAX_SESSIONS = '5'

jest.mock('discord.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    login: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    guilds: { cache: new Map() },
    channels: { cache: new Map(), fetch: jest.fn() },
    users: { cache: new Map(), fetch: jest.fn() },
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 3,
    DirectMessages: 4,
  },
  Events: {
    MessageCreate: 'messageCreate',
    InteractionCreate: 'interactionCreate',
  },
  ChannelType: {
    GuildText: 0,
    DM: 1,
    GuildVoice: 2,
    GuildAnnouncement: 5,
    AnnouncementThread: 10,
    PublicThread: 11,
    PrivateThread: 12,
    GuildForum: 15,
  },
  PermissionFlagsBits: {
    CreatePublicThreads: 1n,
    SendMessagesInThreads: 2n,
  },
  Collection: class Collection extends Map {
    some(
      fn: (value: unknown, key: unknown, col: Map<unknown, unknown>) => boolean,
    ): boolean {
      for (const [key, value] of this) {
        if (fn(value, key, this)) return true
      }
      return false
    }
    override has(key: unknown): boolean {
      return super.has(key)
    }
  },
  Message: jest.fn(),
  User: jest.fn(),
  TextChannel: jest.fn(),
  ButtonBuilder: jest.fn().mockImplementation(() => ({
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
  })),
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
  })),
  AttachmentBuilder: jest.fn().mockImplementation((buffer, opts) => ({
    buffer,
    name: opts?.name ?? 'file',
  })),
  ButtonStyle: { Danger: 4 },
  MessageFlags: { Ephemeral: 64 },
}))

jest.mock('@agentclientprotocol/sdk', () => ({
  ndJsonStream: jest.fn().mockReturnValue({}),
  PROTOCOL_VERSION: '1.0',
  ClientSideConnection: jest.fn(),
}))

jest.mock('node:child_process', () => ({
  execFileSync: jest.fn().mockReturnValue('/usr/bin/git'),
  spawn: jest.fn(),
  execFile: jest.fn(),
}))

jest.mock('src/agent/acp-client', () => ({
  createAcpClient: jest.fn(),
}))

jest.mock('necord', () => ({
  Injectable: jest.fn(() => (_target: unknown) => _target),
  Context: jest.fn(
    () => (_target: unknown, _propertyKey: string, _parameterIndex: number) => {
      void _target
      void _propertyKey
      void _parameterIndex
    },
  ),
  On: jest.fn(
    () =>
      (
        _target: unknown,
        _propertyKey: string,
        _descriptor: PropertyDescriptor,
      ) => {
        void _target
        void _propertyKey
        void _descriptor
      },
  ),
  SlashCommand: jest.fn(
    () =>
      (
        _target: unknown,
        _propertyKey: string,
        _descriptor: PropertyDescriptor,
      ) => {
        void _target
        void _propertyKey
        void _descriptor
      },
  ),
  SlashCommandContext: jest.fn(
    () => (_target: unknown, _propertyKey: string, _parameterIndex: number) => {
      void _target
      void _propertyKey
      void _parameterIndex
    },
  ),
  Button: jest.fn(
    () =>
      (
        _target: unknown,
        _propertyKey: string,
        _descriptor: PropertyDescriptor,
      ) => {
        void _target
        void _propertyKey
        void _descriptor
      },
  ),
  ComponentParam: jest.fn(
    () => (_target: unknown, _propertyKey: string, _parameterIndex: number) => {
      void _target
      void _propertyKey
      void _parameterIndex
    },
  ),
  NecordModule: class NecordModule {},
}))

if (!process.env.DEBUG) {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}

afterEach(() => {
  jest.clearAllMocks()
})
