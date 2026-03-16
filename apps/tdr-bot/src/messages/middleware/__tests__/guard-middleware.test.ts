import { Client } from 'discord.js'

import {
  createMockMessage,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { GuardMiddleware } from 'src/messages/middleware/guard.middleware'
import { Message } from 'src/messages/types'

function makeClient(userId = 'bot-id-123'): jest.Mocked<Client> {
  return {
    user: { id: userId },
  } as unknown as jest.Mocked<Client>
}

describe('GuardMiddleware', () => {
  let middleware: GuardMiddleware
  let client: jest.Mocked<Client>

  async function build(c: jest.Mocked<Client>) {
    const module = await createTestingModule([
      GuardMiddleware,
      { provide: Client, useValue: c },
    ])
    return module.get(GuardMiddleware)
  }

  beforeEach(async () => {
    client = makeClient()
    middleware = await build(client)
  })

  it('returns true for a normal user message', () => {
    const message = createMockMessage({
      author: { id: 'user-1', bot: false, displayName: 'Alice' },
      system: false,
    }) as Message

    expect(middleware.process(message)).toBe(true)
  })

  it('returns false for messages from bot accounts', () => {
    const message = createMockMessage({
      author: { id: 'other-bot', bot: true, displayName: 'OtherBot' },
      system: false,
    }) as Message

    expect(middleware.process(message)).toBe(false)
  })

  it('returns false when the author is the bot itself', () => {
    const message = createMockMessage({
      author: { id: 'bot-id-123', bot: false, displayName: 'TDR Bot' },
      system: false,
    }) as Message

    expect(middleware.process(message)).toBe(false)
  })

  it('returns false for system messages', () => {
    const message = createMockMessage({
      author: { id: 'user-2', bot: false, displayName: 'User' },
      system: true,
    }) as Message

    expect(middleware.process(message)).toBe(false)
  })

  it('returns true when client.user is null but message is from a non-bot user', async () => {
    const nullUserClient = {
      user: null,
    } as unknown as jest.Mocked<Client>
    const middleware2 = await build(nullUserClient)

    const message = createMockMessage({
      author: { id: 'user-3', bot: false, displayName: 'Regular User' },
      system: false,
    }) as Message

    // When client.user is null, the self-check `message.author.id === client.user?.id`
    // evaluates to false (no match), so a non-bot user message passes.
    expect(middleware2.process(message)).toBe(true)
  })

  it('returns false when message is both from a bot and is a system message', () => {
    const message = createMockMessage({
      author: { id: 'sys-bot', bot: true, displayName: 'SystemBot' },
      system: true,
    }) as Message

    expect(middleware.process(message)).toBe(false)
  })
})
