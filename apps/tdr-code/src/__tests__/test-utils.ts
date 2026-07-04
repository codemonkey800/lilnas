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
    setName: jest.fn().mockResolvedValue(undefined),
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

// A mock shaped like a pino logger instance (nestjs-pino's injected
// PinoLogger and getBackendLogger()'s return value both expose this same
// `.info(mergingObject, msg)`-shaped surface), for specs that want to inject
// or stand in for a real logger and assert on what was logged — WITHOUT
// exercising real pino serialization/redaction (that guarantee is instead
// proven once, via real-serialized-output tests, in
// src/logging/backend-logger.spec.ts and the DI logger's own equivalent).
//
// Use this when the thing under test accepts an injected logger (or when
// `jest.mock('src/logging/backend-logger', () => ({ getBackendLogger: () =>
// createLoggerSpy() }))` stands in for the module) and the spec wants to
// assert the STRUCTURED event field a call site logs — the gap the plan
// calls out: type-check catches an unregistered LogEvent slug, but not a
// registered-but-wrong one, so specs need to assert real log content at the
// sites that matter (AE1, AE2, and similar).
//
// Usage:
//   const spy = createLoggerSpy()
//   // ... exercise code that calls spy.warn({ event: 'x', channelId }, 'msg')
//   expect(spy.warn).toHaveBeenCalledWith(
//     expect.objectContaining({ event: 'x' }),
//     expect.any(String),
//   )
export interface LoggerSpy {
  info: jest.Mock
  warn: jest.Mock
  error: jest.Mock
  debug: jest.Mock
  fatal: jest.Mock
}

export function createLoggerSpy(): LoggerSpy {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  }
}
