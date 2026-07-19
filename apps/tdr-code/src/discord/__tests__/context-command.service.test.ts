import { PinoLogger } from 'nestjs-pino'

import { createTestingModule } from 'src/__tests__/test-utils'
import { ContextCommandService } from 'src/discord/context-command.service'
import { ContextUsageService } from 'src/discord/context-usage.service'

function createMockContextUsage() {
  return {
    getUsage: jest.fn().mockReturnValue(null),
  }
}

function createMockInteraction(channelId = 'ch-context') {
  return {
    channelId,
    reply: jest.fn().mockResolvedValue(undefined),
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

async function createService() {
  const mockContextUsage = createMockContextUsage()
  const module = await createTestingModule([
    ContextCommandService,
    { provide: ContextUsageService, useValue: mockContextUsage },
    { provide: PinoLogger, useValue: makeLogger() },
  ])
  return {
    service: module.get(ContextCommandService),
    mockContextUsage,
  }
}

describe('ContextCommandService', () => {
  describe('no usage recorded yet', () => {
    it('replies with a no-data message and does not throw', async () => {
      const { service, mockContextUsage } = await createService()
      mockContextUsage.getUsage.mockReturnValue(null)
      const interaction = createMockInteraction('ch-empty')

      await service.onContext([interaction] as never)

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.stringContaining('No context usage recorded'),
      )
    })

    it('treats a non-positive size the same as no data', async () => {
      const { service, mockContextUsage } = await createService()
      mockContextUsage.getUsage.mockReturnValue({ used: 0, size: 0 })
      const interaction = createMockInteraction('ch-zero-size')

      await service.onContext([interaction] as never)

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.stringContaining('No context usage recorded'),
      )
    })
  })

  describe('usage recorded', () => {
    it('replies with used/size tokens and percentage, no warning framing', async () => {
      const { service, mockContextUsage } = await createService()
      mockContextUsage.getUsage.mockReturnValue({ used: 30_000, size: 100_000 })
      const interaction = createMockInteraction('ch-usage')

      await service.onContext([interaction] as never)

      const reply = (interaction.reply as jest.Mock).mock.calls[0]![0] as string
      expect(reply).toContain('30,000')
      expect(reply).toContain('100,000')
      expect(reply).toContain('30%')
      expect(reply).not.toMatch(/warning|🚨|⚠️/i)
    })

    it('looks up usage for the invoking channel id', async () => {
      const { service, mockContextUsage } = await createService()
      mockContextUsage.getUsage.mockReturnValue({ used: 1, size: 100 })
      const interaction = createMockInteraction('ch-specific')

      await service.onContext([interaction] as never)

      expect(mockContextUsage.getUsage).toHaveBeenCalledWith('ch-specific')
    })
  })
})
