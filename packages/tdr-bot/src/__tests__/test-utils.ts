import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Test, TestingModule } from '@nestjs/testing'
import {
  Collection,
  DMChannel,
  Guild,
  GuildMember,
  TextChannel,
  User,
} from 'discord.js'

import { Message } from 'src/message-handler/types'
import { OverallStateAnnotation, ResponseType } from 'src/schemas/graph'
import { StateService } from 'src/state/state.service'

// Mock factories for Discord.js objects
export function createMockUser(overrides: Partial<User> = {}): User {
  const user = {
    id: '123456789',
    username: 'testuser',
    discriminator: '0001',
    avatar: 'avatar-hash',
    bot: false,
    system: false,
    tag: 'testuser#0001',
    displayName: 'Test User',
    send: jest.fn().mockResolvedValue({}),
    fetch: jest.fn().mockResolvedValue({}),
    toString: () => `<@123456789>` as `<@${string}>`,
    ...overrides,
  } as unknown as User

  return user
}

export function createMockGuildMember(
  overrides: Partial<GuildMember> = {},
): GuildMember {
  const member = {
    id: '123456789',
    user: createMockUser(),
    nickname: null,
    displayName: 'Test User',
    roles: {
      cache: new Collection<string, unknown>(),
    },
    permissions: {
      has: jest.fn().mockReturnValue(true),
    },
    toString: () => `<@${overrides.id || '123456789'}>` as `<@${string}>`,
    ...overrides,
  } as unknown as GuildMember

  return member
}

export function createMockGuild(overrides: Partial<Guild> = {}): Guild {
  const guild = {
    id: '987654321',
    name: 'Test Guild',
    ownerId: '111111111',
    members: {
      cache: new Collection<string, GuildMember>(),
      fetch: jest.fn().mockResolvedValue(createMockGuildMember()),
    },
    channels: {
      cache: new Collection<string, TextChannel | DMChannel>(),
    },
    ...overrides,
  } as unknown as Guild

  return guild
}

export function createMockTextChannel(
  overrides: Partial<TextChannel> = {},
): TextChannel {
  const channel = {
    id: '111222333',
    name: 'test-channel',
    type: 0, // ChannelType.GuildText
    guild: createMockGuild(),
    send: jest.fn().mockResolvedValue({}),
    sendTyping: jest.fn().mockResolvedValue({}),
    isTextBased: jest.fn().mockReturnValue(true),
    messages: {
      fetch: jest.fn().mockResolvedValue(new Collection()),
    },
    ...overrides,
  } as unknown as TextChannel

  return channel
}

export function createMockDMChannel(
  overrides: Partial<DMChannel> = {},
): DMChannel {
  const channel = {
    id: '444555666',
    type: 1, // ChannelType.DM
    send: jest.fn().mockResolvedValue({}),
    sendTyping: jest.fn().mockResolvedValue({}),
    messages: {
      fetch: jest.fn().mockResolvedValue(new Collection()),
    },
    ...overrides,
  } as unknown as DMChannel

  return channel
}

export function createMockMessage(
  overrides: Record<string, unknown> = {},
): Message {
  const defaultChannel = createMockTextChannel()
  const defaultAuthor = createMockUser()

  const message = Object.assign(Object.create(Object.prototype), {
    id: '999888777',
    content: 'Test message content',
    author: defaultAuthor,
    member: createMockGuildMember({
      user: defaultAuthor,
    } as unknown as Partial<GuildMember>),
    channel: defaultChannel,
    guild: defaultChannel.guild,
    createdTimestamp: Date.now(),
    createdAt: new Date(),
    attachments: new Collection(),
    embeds: [],
    mentions: {
      users: new Collection(),
      roles: new Collection(),
      everyone: false,
    },
    reference: null,
    reply: jest.fn().mockResolvedValue({}),
    react: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    edit: jest.fn().mockResolvedValue({}),
    fetch: jest.fn().mockResolvedValue({}),
    ...overrides,
  })

  return message as unknown as Message
}

// LangGraph state factory
export function createMockLangGraphState(
  overrides: Partial<typeof OverallStateAnnotation.State> = {},
): typeof OverallStateAnnotation.State {
  return {
    userInput: 'Test input',
    messages: [],
    responseType: ResponseType.Default,
    images: [],
    message:
      null as unknown as (typeof OverallStateAnnotation.State)['message'],
    prevMessages: [],
    ...overrides,
  }
}

// NestJS testing utilities
export async function createTestingModule(
  providers: Provider[],
  imports: Array<
    Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference
  > = [],
): Promise<TestingModule> {
  const module = await Test.createTestingModule({
    imports: [
      {
        module: class TestEventEmitterModule {},
        providers: [
          {
            provide: EventEmitter2,
            useValue: {
              emit: jest.fn(),
              on: jest.fn(),
              once: jest.fn(),
              removeListener: jest.fn(),
              removeAllListeners: jest.fn(),
            },
          },
        ],
        exports: [EventEmitter2],
      },
      ...imports,
    ],
    providers,
  }).compile()

  return module
}

// Mock StateService factory
export function createMockStateService(): jest.Mocked<StateService> {
  return {
    setState: jest.fn(),
    getState: jest.fn().mockReturnValue({
      systemPrompt: 'Test system prompt',
      llmModel: 'gpt-4',
      maxTokens: 1000,
      temperature: 0.7,
      chatModel: 'gpt-4-turbo',
      reasoningModel: 'gpt-4o-mini',
      graphHistory: [],
    }),
    getPrompt: jest.fn().mockReturnValue('Generated prompt'),
    onModuleInit: jest.fn(),
  } as unknown as jest.Mocked<StateService>
}

// LangChain mock utilities
export function createMockChatOpenAI() {
  const mock = {
    invoke: jest.fn().mockResolvedValue({
      content: 'Mock response',
      additional_kwargs: {},
    }),
    bind: jest.fn().mockReturnThis(),
    bindTools: jest.fn().mockReturnThis(),
    withConfig: jest.fn().mockReturnThis(),
    stream: jest.fn().mockImplementation(async function* () {
      yield { content: 'Mock' }
      yield { content: ' streaming' }
      yield { content: ' response' }
    }),
  }
  // Make bindTools return the mock itself
  mock.bindTools.mockReturnValue(mock)
  return mock
}

export function createMockStateGraph() {
  const mockGraph = {
    addNode: jest.fn().mockReturnThis(),
    addEdge: jest.fn().mockReturnThis(),
    addConditionalEdges: jest.fn().mockReturnThis(),
    setEntryPoint: jest.fn().mockReturnThis(),
    setFinishPoint: jest.fn().mockReturnThis(),
    compile: jest.fn().mockReturnValue({
      invoke: jest.fn().mockResolvedValue({
        messages: [{ content: 'Mock response' }],
      }),
      stream: jest.fn().mockImplementation(async function* () {
        yield { messages: [{ content: 'Mock streaming response' }] }
      }),
    }),
  }
  return mockGraph
}

export function createMockToolNode() {
  return jest.fn().mockImplementation(() =>
    jest.fn().mockResolvedValue({
      messages: [
        {
          content: 'Tool response',
          name: 'test_tool',
        },
      ],
    }),
  )
}

// Axios mock response factory
export function createMockAxiosResponse<T = unknown>(data: T, status = 200) {
  return {
    data,
    status,
    statusText: 'OK',
    headers: {},
    config: {},
  }
}

// Test data builders
export class MessageBuilder {
  private messageData: Record<string, unknown> = {
    content: 'Test message',
  }

  withContent(content: string): this {
    this.messageData.content = content
    return this
  }

  withAuthor(author: Partial<User>): this {
    const authorOverrides = {
      ...author,
      toString: () => `<@${author.id || '123456789'}>` as `<@${string}>`,
    }
    this.messageData.author = createMockUser(authorOverrides)
    return this
  }

  inDM(): this {
    this.messageData.channel = createMockDMChannel()
    this.messageData.guild = null
    return this
  }

  inGuild(): this {
    const channel = createMockTextChannel()
    this.messageData.channel = channel
    this.messageData.guild = channel.guild
    return this
  }

  withAttachment(url: string, name: string): this {
    const attachment = {
      id: '123',
      url,
      name,
      size: 1024,
      attachment: url,
      contentType: 'image/png',
      description: null,
      duration: null,
      ephemeral: false,
      flags: {
        bitfield: 0,
      },
      height: null,
      proxyURL: url,
      spoiler: false,
      width: null,
    }
    this.messageData.attachments = new Collection([['123', attachment]])
    return this
  }

  withMention(userId: string): this {
    if (!this.messageData.mentions) {
      this.messageData.mentions = {
        users: new Collection(),
        roles: new Collection(),
        everyone: false,
      }
    }
    const user = createMockUser({ id: userId } as Partial<User>)
    const mentions = this.messageData.mentions as {
      users: Collection<string, User>
      roles: Collection<string, unknown>
      everyone: boolean
    }
    mentions.users.set(userId, user)
    return this
  }

  build(): Message {
    return createMockMessage(this.messageData)
  }
}

// Wait utility for async tests
export async function waitFor(
  callback: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100,
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    if (await callback()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }

  throw new Error(`Timeout waiting for condition after ${timeout}ms`)
}
