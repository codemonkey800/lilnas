// nanoid v5 ships ESM-only and this package's ts-jest transform doesn't
// cover it, so any test that transitively imports it must mock it first -
// YtdlpUpdateController -> YtdlpUpdateService -> DownloadStateService does
// (see download/__tests__/download.controller.detail-fallback.test.ts for
// the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import type { UpdateCheckResult } from '@lilnas/utils/download/types'
import { Test, TestingModule } from '@nestjs/testing'

import { type AuditEvent, AuditLogService } from 'src/audit/audit-log.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { YtdlpUpdateController } from 'src/ytdlp-update/ytdlp-update.controller'
import { YtdlpUpdateService } from 'src/ytdlp-update/ytdlp-update.service'

// D2: POST /api/ytdlp-update/check is the one mutating route here (it can
// replace the yt-dlp binary), so it is the one that writes an audit row.
// These tests pin the three things that are easy to regress: the row is
// written for both a human and a service caller, the GET routes stay silent,
// and a failed check writes nothing at all.
describe('YtdlpUpdateController - audit', () => {
  let controller: YtdlpUpdateController
  let ytdlpUpdateService: {
    checkForUpdates: jest.Mock<Promise<UpdateCheckResult>, []>
    getCurrentVersion: jest.Mock<Promise<string>, []>
    getUpdateStatus: jest.Mock
  }
  let auditLogService: { record: jest.Mock<void, [AuditEvent]> }

  const user: ForwardedUser = { email: 'alice@example.com', userId: 'u1' }

  const upToDate: UpdateCheckResult = {
    canUpdate: false,
    currentVersion: '2024.01.01',
    latestVersion: '2024.01.01',
    updateAvailable: false,
  }

  const updateAvailable: UpdateCheckResult = {
    canUpdate: true,
    currentVersion: '2024.01.01',
    latestVersion: '2024.06.01',
    updateAvailable: true,
  }

  beforeEach(async () => {
    ytdlpUpdateService = {
      checkForUpdates: jest.fn<Promise<UpdateCheckResult>, []>(),
      getCurrentVersion: jest.fn<Promise<string>, []>(),
      getUpdateStatus: jest.fn(),
    }
    auditLogService = { record: jest.fn<void, [AuditEvent]>() }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [YtdlpUpdateController],
      providers: [
        { provide: YtdlpUpdateService, useValue: ytdlpUpdateService },
        { provide: AuditLogService, useValue: auditLogService },
      ],
    }).compile()

    controller = module.get<YtdlpUpdateController>(YtdlpUpdateController)
  })

  // The audited fields are inspected directly (rather than only through
  // toHaveBeenCalledWith) in the cases below that care about a key being
  // absent vs. present-and-undefined - `noUncheckedIndexedAccess` makes the
  // raw mock.calls[0][0] read a type error, so it is narrowed once here.
  function firstRecordedEvent(): AuditEvent {
    const call = auditLogService.record.mock.calls[0]
    if (!call) throw new Error('AuditLogService.record() was never called')
    return call[0]
  }

  describe('POST /check', () => {
    it('records ytdlp.check_update with the forwarded identity as actor', async () => {
      ytdlpUpdateService.checkForUpdates.mockResolvedValue(updateAvailable)

      const result = await controller.checkForUpdates(undefined, user)

      expect(result).toEqual(updateAvailable)
      expect(auditLogService.record).toHaveBeenCalledTimes(1)
      expect(auditLogService.record).toHaveBeenCalledWith({
        action: 'ytdlp.check_update',
        actor: user,
        metadata: {
          canUpdate: true,
          currentVersion: '2024.01.01',
          dryRun: false,
          latestVersion: '2024.06.01',
          updateAvailable: true,
        },
      })
    })

    // The scheduler and apps/tdr-bot both reach this route with no
    // X-Forwarded-User header; `actor: undefined` is what the repo turns
    // into origin: 'service', so it has to be written out, not omitted.
    it('records actor: undefined for a caller with no forwarded identity', async () => {
      ytdlpUpdateService.checkForUpdates.mockResolvedValue(upToDate)

      await controller.checkForUpdates(undefined, undefined)

      expect(auditLogService.record).toHaveBeenCalledTimes(1)

      const event = firstRecordedEvent()
      expect(event.actor).toBeUndefined()
      expect('actor' in event).toBe(true)
      expect(event.action).toBe('ytdlp.check_update')
    })

    // AuditTargetType is only 'job' | 'media', and the table's CHECK
    // requires target type and id to be null together - so this action must
    // carry no target key at all.
    it('records no target', async () => {
      ytdlpUpdateService.checkForUpdates.mockResolvedValue(upToDate)

      await controller.checkForUpdates(undefined, user)

      expect(firstRecordedEvent().target).toBeUndefined()
    })

    it('records the dry-run result, flagged as a dry run', async () => {
      ytdlpUpdateService.checkForUpdates.mockResolvedValue(updateAvailable)

      const result = await controller.checkForUpdates('true', user)

      expect(result).toEqual({
        ...updateAvailable,
        canUpdate: false,
        reason: 'Dry-run mode - update would have proceeded',
      })
      expect(auditLogService.record).toHaveBeenCalledWith({
        action: 'ytdlp.check_update',
        actor: user,
        metadata: {
          canUpdate: false,
          currentVersion: '2024.01.01',
          dryRun: true,
          latestVersion: '2024.06.01',
          updateAvailable: true,
        },
      })
    })

    it('records nothing when the check fails', async () => {
      ytdlpUpdateService.checkForUpdates.mockRejectedValue(
        new Error('GitHub unreachable'),
      )

      await expect(controller.checkForUpdates(undefined, user)).rejects.toThrow(
        'GitHub unreachable',
      )

      expect(auditLogService.record).not.toHaveBeenCalled()
    })
  })

  describe('GET routes', () => {
    it('records nothing for GET /status', () => {
      ytdlpUpdateService.getUpdateStatus.mockReturnValue({
        isUpdating: false,
        lastAttempt: null,
        lastCheck: null,
        retryCount: 0,
      })

      controller.getUpdateStatus()

      expect(auditLogService.record).not.toHaveBeenCalled()
    })

    it('records nothing for GET /version', async () => {
      ytdlpUpdateService.getCurrentVersion.mockResolvedValue('2024.01.01')

      await expect(controller.getCurrentVersion()).resolves.toEqual({
        version: '2024.01.01',
      })

      expect(auditLogService.record).not.toHaveBeenCalled()
    })

    it('records nothing when GET /version fails', async () => {
      ytdlpUpdateService.getCurrentVersion.mockRejectedValue(
        new Error('spawn failed'),
      )

      await expect(controller.getCurrentVersion()).resolves.toEqual({
        version: 'error',
      })

      expect(auditLogService.record).not.toHaveBeenCalled()
    })
  })
})
