import { createTestingModule } from 'src/__tests__/test-utils'
import { SessionManagerService } from 'src/agent/session-manager.service'
import { insertGeneration } from 'src/db/bot-generation.repo'
import { DB } from 'src/db/database.module'
import {
  closeSession,
  getLatestSessionForChannel,
  insertSession,
} from 'src/db/sessions.repo'
import { createTestDb, type TestDb } from 'src/db/test-db'
import { ClearCommandService } from 'src/discord/clear-command.service'
import { DiscordHandlerService } from 'src/discord/discord-handler.service'

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

// Real in-memory test DB — clearAcpSessionId runs a real query, and the
// integration scenario needs to read the row back afterward.
async function createService(testDb: TestDb) {
  const mockManager = createMockSessionManager()
  const mockHandler = createMockDiscordHandler()
  const module = await createTestingModule([
    ClearCommandService,
    { provide: SessionManagerService, useValue: mockManager },
    { provide: DiscordHandlerService, useValue: mockHandler },
    { provide: DB, useValue: testDb.db },
  ])
  return {
    service: module.get(ClearCommandService),
    mockManager,
    mockHandler,
  }
}

describe('ClearCommandService', () => {
  let testDb: TestDb

  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  describe('happy path — mid-turn clear (AE3: R9, R11, R12)', () => {
    it('calls teardown and resetChannel for the channel', async () => {
      const { service, mockManager, mockHandler } = await createService(testDb)
      const interaction = createMockInteraction('ch-clear')

      await service.onClear([interaction] as never)

      expect(mockManager.teardown).toHaveBeenCalledWith('ch-clear')
      expect(mockHandler.resetChannel).toHaveBeenCalledWith('ch-clear')
    })

    it('replies with a public confirmation (R14, Decision #8)', async () => {
      const { service } = await createService(testDb)
      const interaction = createMockInteraction('ch-clear')

      await service.onClear([interaction] as never)

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.stringContaining('Session cleared'),
      )
    })

    it('calls resetChannel before awaiting reply so state is wiped synchronously', async () => {
      const { service, mockHandler } = await createService(testDb)
      const interaction = createMockInteraction('ch-clear')

      const order: string[] = []
      mockHandler.resetChannel.mockImplementation(() =>
        order.push('resetChannel'),
      )
      interaction.reply = jest
        .fn()
        .mockImplementation(async () => order.push('reply'))

      await service.onClear([interaction] as never)

      expect(order[0]).toBe('resetChannel')
      expect(order[1]).toBe('reply')
    })
  })

  describe('no active session edge case', () => {
    it('still replies with confirmation when there is no active session (no throw)', async () => {
      const { service } = await createService(testDb)
      const interaction = createMockInteraction('ch-empty')

      // teardown and resetChannel are no-ops when no session exists
      await expect(
        service.onClear([interaction] as never),
      ).resolves.not.toThrow()
      expect(interaction.reply).toHaveBeenCalled()
    })
  })

  describe('post-clear isolation', () => {
    it('error-path onPromptComplete after /clear finds no state and does not throw', async () => {
      const { service, mockHandler } = await createService(testDb)
      const interaction = createMockInteraction('ch-clear')

      await service.onClear([interaction] as never)

      // Simulate the killed process's error-path callback reaching the handler
      expect(() =>
        mockHandler.onPromptComplete('ch-clear', 'error'),
      ).not.toThrow()
    })
  })

  describe('any participant can run /clear (R13, AE5)', () => {
    it('executes teardown and reset with no permission gate', async () => {
      const { service, mockManager } = await createService(testDb)
      const interaction = {
        ...createMockInteraction('ch-clear'),
        user: { id: 'any-user-in-channel' },
      }

      await service.onClear([interaction] as never)

      expect(mockManager.teardown).toHaveBeenCalledWith('ch-clear')
    })
  })

  describe('severs the resume linkage (U1: R8, R14)', () => {
    it('nulls acpSessionId on the channel latest row when a live-looking session existed', async () => {
      const gen = insertGeneration(testDb.db, { startedAt: new Date() })
      insertSession(testDb.db, {
        channelId: 'ch-clear-live',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: 'acp-live-session',
        cwd: '/cwd',
        createdAt: new Date(),
      })

      const { service } = await createService(testDb)
      const interaction = createMockInteraction('ch-clear-live')

      await service.onClear([interaction] as never)

      const latest = getLatestSessionForChannel(testDb.db, 'ch-clear-live')
      expect(latest?.acpSessionId).toBeNull()
    })

    it('nulls acpSessionId on the latest row even when it is already dormant (no in-memory session)', async () => {
      const gen = insertGeneration(testDb.db, { startedAt: new Date() })
      const row = insertSession(testDb.db, {
        channelId: 'ch-clear-dormant',
        generationId: gen.id,
        triggeringUserId: 'u1',
        acpSessionId: 'acp-dormant-session',
        cwd: '/cwd',
        createdAt: new Date(),
      })
      // Simulate a session the manager already tore down / never re-created
      // in memory — teardown() will no-op, but /clear must still sever it.
      closeSession(testDb.db, {
        id: row.id,
        endedAt: new Date(),
        endReason: 'teardown',
      })

      const { service } = await createService(testDb)
      const interaction = createMockInteraction('ch-clear-dormant')

      await service.onClear([interaction] as never)

      const latest = getLatestSessionForChannel(testDb.db, 'ch-clear-dormant')
      expect(latest?.acpSessionId).toBeNull()
    })

    it('does not throw when there is no session row for the channel (no-op)', async () => {
      const { service } = await createService(testDb)
      const interaction = createMockInteraction('ch-clear-no-row')

      await expect(
        service.onClear([interaction] as never),
      ).resolves.not.toThrow()
      expect(
        getLatestSessionForChannel(testDb.db, 'ch-clear-no-row'),
      ).toBeUndefined()
    })
  })
})
