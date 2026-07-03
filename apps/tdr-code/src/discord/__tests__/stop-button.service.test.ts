import { MessageFlags } from 'discord.js'
import { PinoLogger } from 'nestjs-pino'

import { createTestingModule } from 'src/__tests__/test-utils'
import { SessionManagerService } from 'src/agent/session-manager.service'
import { StopButtonService } from 'src/discord/stop-button.service'

function createMockSessionManager(cancelResult = true) {
  return {
    cancel: jest.fn().mockReturnValue(cancelResult),
  }
}

function makeLogger(): PinoLogger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger
}

function createMockInteraction(channelId = 'ch-1') {
  return {
    channelId,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
  }
}

async function createService(cancelResult = true) {
  const mockManager = createMockSessionManager(cancelResult)
  const module = await createTestingModule([
    StopButtonService,
    { provide: SessionManagerService, useValue: mockManager },
    { provide: PinoLogger, useValue: makeLogger() },
  ])
  return { service: module.get(StopButtonService), mockManager }
}

describe('StopButtonService', () => {
  describe('happy path — successful cancel (R2, R5)', () => {
    it('calls cancel with parsed channelId and turnId, then deferUpdate', async () => {
      const { service, mockManager } = await createService(true)
      const interaction = createMockInteraction('ch-1')

      await service.onStop([interaction] as never, 'ch-1', '7')

      expect(mockManager.cancel).toHaveBeenCalledWith('ch-1', 7)
      expect(interaction.deferUpdate).toHaveBeenCalled()
      expect(interaction.reply).not.toHaveBeenCalled()
    })

    it('extracts channelId and turnId correctly from path params', async () => {
      const { service, mockManager } = await createService(true)
      const interaction = createMockInteraction('123456789012345678')

      await service.onStop([interaction] as never, '123456789012345678', '42')

      expect(mockManager.cancel).toHaveBeenCalledWith('123456789012345678', 42)
    })
  })

  describe('stale / no-op cancel (R7)', () => {
    it('replies ephemerally when cancel returns false', async () => {
      const { service, mockManager } = await createService(false)
      const interaction = createMockInteraction('ch-1')

      await service.onStop([interaction] as never, 'ch-1', '5')

      expect(mockManager.cancel).toHaveBeenCalled()
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral }),
      )
      expect(interaction.deferUpdate).not.toHaveBeenCalled()
    })

    it('interaction is still acknowledged on stale click (no "interaction failed")', async () => {
      const { service } = await createService(false)
      const interaction = createMockInteraction('ch-1')

      await service.onStop([interaction] as never, 'ch-1', '5')

      expect(interaction.reply).toHaveBeenCalled()
    })
  })

  describe('channel mismatch guard', () => {
    it('replies ephemerally and does NOT call cancel when customId channelId differs', async () => {
      const { service, mockManager } = await createService()
      const interaction = createMockInteraction('real-channel')

      await service.onStop([interaction] as never, 'other-channel', '5')

      expect(mockManager.cancel).not.toHaveBeenCalled()
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral }),
      )
    })
  })

  describe('malformed turnId guard', () => {
    it('treats non-integer turnId as invalid and does not cancel', async () => {
      const { service, mockManager } = await createService()
      const interaction = createMockInteraction('ch-1')

      await service.onStop([interaction] as never, 'ch-1', 'abc')

      expect(mockManager.cancel).not.toHaveBeenCalled()
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ flags: MessageFlags.Ephemeral }),
      )
    })

    it('treats NaN turnId (from malformed string) as non-match, not cancellation', async () => {
      const { service, mockManager } = await createService()
      const interaction = createMockInteraction('ch-1')

      await service.onStop([interaction] as never, 'ch-1', 'NaN')

      expect(mockManager.cancel).not.toHaveBeenCalled()
    })
  })

  describe('any participant can stop (R5 / AE5)', () => {
    it('calls cancel with no permission gate regardless of caller', async () => {
      const { service, mockManager } = await createService(true)
      const interaction = {
        ...createMockInteraction('ch-1'),
        user: { id: 'different-user' },
      }

      await service.onStop([interaction] as never, 'ch-1', '3')

      expect(mockManager.cancel).toHaveBeenCalledWith('ch-1', 3)
    })
  })
})
