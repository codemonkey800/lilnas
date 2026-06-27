import 'reflect-metadata'

import { TextDecoder, TextEncoder } from 'util'

global.TextEncoder = TextEncoder as unknown as typeof globalThis.TextEncoder
global.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder

Object.defineProperty(process.env, 'NODE_ENV', {
  value: 'test',
  writable: true,
})
process.env.DISCORD_BOT_TOKEN = 'test-token'
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
  ChannelType: { GuildText: 0, DM: 1, GuildVoice: 2 },
  Collection: class Collection extends Map {
    some(fn: (value: unknown, key: unknown, col: Map<unknown, unknown>) => boolean): boolean {
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
  ButtonStyle: { Danger: 4 },
  MessageFlags: { Ephemeral: 64 },
}))

jest.mock('necord', () => ({
  Injectable: jest.fn(() => (_target: unknown) => _target),
  Context: jest.fn(
    () =>
      (_target: unknown, _propertyKey: string, _parameterIndex: number) => {},
  ),
  On: jest.fn(
    () =>
      (_target: unknown, _propertyKey: string, _descriptor: PropertyDescriptor) => {},
  ),
  SlashCommand: jest.fn(
    () =>
      (_target: unknown, _propertyKey: string, _descriptor: PropertyDescriptor) => {},
  ),
  SlashCommandContext: jest.fn(
    () =>
      (_target: unknown, _propertyKey: string, _parameterIndex: number) => {},
  ),
  Button: jest.fn(
    () =>
      (_target: unknown, _propertyKey: string, _descriptor: PropertyDescriptor) => {},
  ),
  ComponentParam: jest.fn(
    () =>
      (_target: unknown, _propertyKey: string, _parameterIndex: number) => {},
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
