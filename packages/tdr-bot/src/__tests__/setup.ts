import 'reflect-metadata'

import { TextDecoder, TextEncoder } from 'util'

// Polyfill for TextEncoder/TextDecoder
global.TextEncoder = TextEncoder
global.TextDecoder = TextDecoder as unknown as typeof globalThis.TextDecoder

// Set test environment variables
Object.defineProperty(process.env, 'NODE_ENV', {
  value: 'test',
  writable: true,
})
process.env.DISCORD_BOT_TOKEN = 'test-token'
process.env.OPENAI_API_KEY = 'test-api-key'
process.env.TAVILY_API_KEY = 'test-tavily-key'
process.env.GRAPH_TEST = 'false'
process.env.EQUATIONS_URL = 'http://localhost:3000'
process.env.EQUATIONS_API_KEY = 'test-api-key'

// Mock Discord.js
jest.mock('discord.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    login: jest.fn(),
    on: jest.fn(),
    once: jest.fn(),
    guilds: {
      cache: new Map(),
    },
    channels: {
      cache: new Map(),
      fetch: jest.fn(),
    },
    users: {
      cache: new Map(),
      fetch: jest.fn(),
    },
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2,
    MessageContent: 3,
    DirectMessages: 4,
  },
  PartialTypes: {
    Message: 'MESSAGE',
    Channel: 'CHANNEL',
    User: 'USER',
  },
  ChannelType: {
    GuildText: 0,
    DM: 1,
    GuildVoice: 2,
  },
  ActivityType: {
    Playing: 0,
    Streaming: 1,
    Listening: 2,
    Watching: 3,
  },
  // Add missing Discord.js enums
  ButtonStyle: {
    Primary: 1,
    Secondary: 2,
    Success: 3,
    Danger: 4,
    Link: 5,
  },
  ComponentType: {
    ActionRow: 1,
    Button: 2,
    StringSelect: 3,
    TextInput: 4,
    UserSelect: 5,
    RoleSelect: 6,
    MentionableSelect: 7,
    ChannelSelect: 8,
  },
  TextInputStyle: {
    Short: 1,
    Paragraph: 2,
  },
  Collection: class Collection extends Map {
    some(
      fn: (
        value: unknown,
        key: unknown,
        collection: Map<unknown, unknown>,
      ) => boolean,
    ): boolean {
      for (const [key, value] of this) {
        if (fn(value, key, this)) return true
      }
      return false
    }
  },
  Message: jest.fn(),
  User: jest.fn(),
  TextChannel: jest.fn(),
  DMChannel: jest.fn(),
  Guild: jest.fn(),
  GuildMember: jest.fn(),
  Embed: jest.fn(),
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    setThumbnail: jest.fn().mockReturnThis(),
    setImage: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
  })),
  AttachmentBuilder: jest.fn().mockImplementation((buffer, name) => ({
    buffer,
    name,
  })),
  // Add Discord builders
  ActionRowBuilder: jest.fn().mockImplementation(() => ({
    addComponents: jest.fn().mockReturnThis(),
    setComponents: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({ type: 1, components: [] }),
  })),
  ButtonBuilder: jest.fn().mockImplementation(function ButtonBuilder() {
    const mockButton = {
      data: {} as any,
      setCustomId: jest.fn().mockImplementation((customId: string) => {
        mockButton.data.custom_id = customId
        return mockButton
      }),
      setLabel: jest.fn().mockImplementation((label: string) => {
        mockButton.data.label = label
        return mockButton
      }),
      setStyle: jest.fn().mockImplementation((style: number) => {
        mockButton.data.style = style
        return mockButton
      }),
      setEmoji: jest.fn().mockImplementation((emoji: string) => {
        mockButton.data.emoji = emoji
        return mockButton
      }),
      setURL: jest.fn().mockImplementation((url: string) => {
        mockButton.data.url = url
        return mockButton
      }),
      setDisabled: jest.fn().mockImplementation((disabled: boolean) => {
        mockButton.data.disabled = disabled
        return mockButton
      }),
      toJSON: jest.fn().mockImplementation(() => {
        return mockButton.data
      }),
      constructor: { name: 'ButtonBuilder' },
    }
    return mockButton
  }),
  StringSelectMenuBuilder: jest
    .fn()
    .mockImplementation(function StringSelectMenuBuilder() {
      return {
        data: {},
        setCustomId: jest.fn().mockReturnThis(),
        setPlaceholder: jest.fn().mockReturnThis(),
        setOptions: jest.fn().mockReturnThis(),
        addOptions: jest.fn().mockReturnThis(),
        setMaxValues: jest.fn().mockReturnThis(),
        setMinValues: jest.fn().mockReturnThis(),
        setDisabled: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({}),
        constructor: { name: 'StringSelectMenuBuilder' },
      }
    }),
  StringSelectMenuOptionBuilder: jest.fn().mockImplementation(() => ({
    data: {},
    setLabel: jest.fn().mockReturnThis(),
    setValue: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setEmoji: jest.fn().mockReturnThis(),
    setDefault: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  })),
  ModalBuilder: jest.fn().mockImplementation(() => ({
    data: {},
    setCustomId: jest.fn().mockReturnThis(),
    setTitle: jest.fn().mockReturnThis(),
    addComponents: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  })),
  TextInputBuilder: jest.fn().mockImplementation(() => ({
    data: {},
    setCustomId: jest.fn().mockReturnThis(),
    setLabel: jest.fn().mockReturnThis(),
    setStyle: jest.fn().mockReturnThis(),
    setPlaceholder: jest.fn().mockReturnThis(),
    setRequired: jest.fn().mockReturnThis(),
    setMinLength: jest.fn().mockReturnThis(),
    setMaxLength: jest.fn().mockReturnThis(),
    setValue: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({}),
  })),
  // Add Discord API error classes
  DiscordAPIError: class DiscordAPIError extends Error {
    constructor(message: string, code: number) {
      super(message)
      this.name = 'DiscordAPIError'
      this.code = code
    }
    code: number
  },
  RESTJSONErrorCodes: {
    UnknownMessage: 10008,
    UnknownChannel: 10003,
    UnknownGuild: 50001,
    UnknownUser: 10013,
    UnknownInteraction: 10062,
    InvalidFormBody: 50035,
  },
}))

// Mock necord
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
  Options: jest.fn(
    () => (_target: unknown, _propertyKey: string, _parameterIndex: number) => {
      void _target
      void _propertyKey
      void _parameterIndex
    },
  ),
  StringOption: jest.fn(
    () =>
      (_options: unknown) =>
      (_target: unknown, _propertyKey: string, _parameterIndex: number) => {
        void _options
        void _target
        void _propertyKey
        void _parameterIndex
      },
  ),
  NecordModule: class NecordModule {},
}))

// Mock MinIO
jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject: jest.fn().mockResolvedValue({ etag: 'test-etag' }),
    getObject: jest.fn().mockResolvedValue(Buffer.from('test-data')),
    listObjects: jest.fn().mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { name: 'test-object' }
      },
    }),
    bucketExists: jest.fn().mockResolvedValue(true),
    makeBucket: jest.fn().mockResolvedValue(undefined),
  })),
}))

// Mock node-docker-api
jest.mock('node-docker-api', () => ({
  Docker: jest.fn().mockImplementation(() => ({
    container: {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockImplementation((_id: string) => {
        void _id
        return {
          status: jest.fn().mockResolvedValue({ state: { Status: 'running' } }),
          start: jest.fn().mockResolvedValue(undefined),
          stop: jest.fn().mockResolvedValue(undefined),
          logs: jest.fn().mockResolvedValue({ on: jest.fn() }),
        }
      }),
    },
  })),
}))

// Mock axios for equation service
jest.mock('axios')

// Mock fs-extra
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('test-file-content')),
  writeFile: jest.fn().mockResolvedValue(undefined),
  pathExists: jest.fn().mockResolvedValue(true),
  remove: jest.fn().mockResolvedValue(undefined),
  readJSON: jest.fn().mockResolvedValue({}),
  writeJSON: jest.fn().mockResolvedValue(undefined),
}))

// Mock nanoid
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'test-id-123'),
}))

// Mock @langchain/langgraph
jest.mock('@langchain/langgraph', () => ({
  StateGraph: jest.fn(),
  Annotation: Object.assign(
    jest.fn(() => ({ spec: {} })),
    {
      Root: jest.fn(spec => ({ spec, State: spec })),
    },
  ),
}))

// Mock remark
jest.mock('remark', () => ({
  remark: jest.fn(() => ({
    use: jest.fn().mockReturnThis(),
    process: jest
      .fn()
      .mockResolvedValue({ toString: () => 'Processed markdown' }),
  })),
}))

// Mock unist-util-visit
jest.mock('unist-util-visit', () => ({
  visit: jest.fn((tree, type, visitor) => {
    // Simple mock implementation
    let visitorFn = visitor
    if (typeof type === 'function') {
      visitorFn = type
    }
    if (visitorFn && typeof visitorFn === 'function') {
      // Just return the tree without modification
    }
    return tree
  }),
  CONTINUE: Symbol('continue'),
  EXIT: Symbol('exit'),
  SKIP: Symbol('skip'),
}))

// Mock pino logger
jest.mock('pino', () => () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
}))

// Mock nestjs-pino
jest.mock('nestjs-pino', () => ({
  LoggerModule: {
    forRoot: jest.fn(() => ({ module: 'LoggerModule' })),
  },
  Logger: jest.fn().mockImplementation(() => ({
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
  })),
}))

// Increase timeout for LLM-related tests
jest.setTimeout(30000)

// Suppress console output during tests unless DEBUG is set
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

// Clear all mocks after each test
afterEach(() => {
  jest.clearAllMocks()
})

// Global cleanup after all tests to ensure proper exit
afterAll(() => {
  // Clear any remaining timers
  jest.clearAllTimers()
  // Use real timers to ensure cleanup
  jest.useRealTimers()
})
