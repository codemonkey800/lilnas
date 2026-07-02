import { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { Message, TextChannel } from 'discord.js'

export function createMockTextChannel(
  overrides: Record<string, unknown> = {},
): TextChannel {
  return {
    id: '111222333',
    name: 'test-channel',
    type: 0,
    send: jest.fn().mockResolvedValue(createMockMessage()),
    sendTyping: jest.fn().mockResolvedValue(undefined),
    isTextBased: jest.fn().mockReturnValue(true),
    isThread: jest.fn().mockReturnValue(false),
    isDMBased: jest.fn().mockReturnValue(false),
    ...overrides,
  } as unknown as TextChannel
}

export function createMockThreadChannel(
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    id: '444555666',
    name: 'test-thread',
    type: 11 /* PublicThread */,
    // NOTE: resolves to a plain message literal (not createMockMessage())
    // to avoid createMockMessage <-> createMockThreadChannel mutual
    // recursion via their respective startThread/send defaults.
    send: jest.fn().mockResolvedValue({ id: 'thread-sent-message' }),
    sendTyping: jest.fn().mockResolvedValue(undefined),
    isTextBased: jest.fn().mockReturnValue(true),
    isThread: jest.fn().mockReturnValue(true),
    isDMBased: jest.fn().mockReturnValue(false),
    ...overrides,
  }
}

export function createMockMessage(
  overrides: Record<string, unknown> = {},
): Message {
  return {
    id: '999888777',
    content: 'Test message',
    author: { id: 'user-123', bot: false },
    channelId: '111222333',
    channel: {
      type: 0,
      isThread: jest.fn().mockReturnValue(false),
      isDMBased: jest.fn().mockReturnValue(false),
    },
    edit: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue({}),
    reply: jest.fn().mockResolvedValue({}),
    mentions: { has: jest.fn().mockReturnValue(false) },
    startThread: jest.fn().mockResolvedValue(createMockThreadChannel()),
    ...overrides,
  } as unknown as Message
}

export async function createTestingModule(
  providers: Provider[],
  imports: Array<
    Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference
  > = [],
): Promise<TestingModule> {
  return Test.createTestingModule({ imports, providers }).compile()
}
