import { createTestingModule } from 'src/__tests__/test-utils'
import { SessionManagerService } from 'src/agent/session-manager.service'

import { ClearCommandService } from '../clear-command.service'
import { DiscordHandlerService } from '../discord-handler.service'

function createMockSessionManager() {
  return {
    teardown: jest.fn(),
    prompt: jest.fn(),
    isPrompting: jest.fn().mockReturnValue(false),
  }
}

function createMockDiscordHandler() {
  return {
    resetChannel: jest.fn(),
    onPromptComplete: jest.fn(),
  }
}

function createMockInteraction(channelId = 'ch-clear') {
  return {
    channelId,
    reply: jest.fn().mockResolvedValue(undefined),
  }
}

async function createService() {
  const mockManager = createMockSessionManager()
  const mockHandler = createMockDiscordHandler()
  const module = await createTestingModule([
    ClearCommandService,
    { provide: SessionManagerService, useValue: mockManager },
    { provide: DiscordHandlerService, useValue: mockHandler },
  ])
  return {
    service: module.get(ClearCommandService),
    mockManager,
    mockHandler,
  }
}

describe('ClearCommandService', () => {
  describe('happy path — mid-turn clear (AE3: R9, R11, R12)', () => {
    it('calls teardown and resetChannel for the channel', async () => {
      const { service, mockManager, mockHandler } = await createService()
      const interaction = createMockInteraction('ch-clear')

      await service.onClear([interaction] as never)

      expect(mockManager.teardown).toHaveBeenCalledWith('ch-clear')
      expect(mockHandler.resetChannel).toHaveBeenCalledWith('ch-clear')
    })

    it('replies with a public confirmation (R14, Decision #8)', async () => {
      const { service } = await createService()
      const interaction = createMockInteraction('ch-clear')

      await service.onClear([interaction] as never)

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.stringContaining('Session cleared'),
      )
    })

    it('calls resetChannel before awaiting reply so state is wiped synchronously', async () => {
      const { service, mockHandler } = await createService()
      const interaction = createMockInteraction('ch-clear')

      const order: string[] = []
      mockHandler.resetChannel.mockImplementation(() => order.push('resetChannel'))
      interaction.reply = jest.fn().mockImplementation(async () => order.push('reply'))

      await service.onClear([interaction] as never)

      expect(order[0]).toBe('resetChannel')
      expect(order[1]).toBe('reply')
    })
  })

  describe('no active session edge case', () => {
    it('still replies with confirmation when there is no active session (no throw)', async () => {
      const { service } = await createService()
      const interaction = createMockInteraction('ch-empty')

      // teardown and resetChannel are no-ops when no session exists
      await expect(service.onClear([interaction] as never)).resolves.not.toThrow()
      expect(interaction.reply).toHaveBeenCalled()
    })
  })

  describe('post-clear isolation', () => {
    it('error-path onPromptComplete after /clear finds no state and does not throw', async () => {
      const { service, mockHandler } = await createService()
      const interaction = createMockInteraction('ch-clear')

      await service.onClear([interaction] as never)

      // Simulate the killed process's error-path callback reaching the handler
      expect(() => mockHandler.onPromptComplete('ch-clear', 'error')).not.toThrow()
    })
  })

  describe('any participant can run /clear (R13, AE5)', () => {
    it('executes teardown and reset with no permission gate', async () => {
      const { service, mockManager } = await createService()
      const interaction = {
        ...createMockInteraction('ch-clear'),
        user: { id: 'any-user-in-channel' },
      }

      await service.onClear([interaction] as never)

      expect(mockManager.teardown).toHaveBeenCalledWith('ch-clear')
    })
  })
})
