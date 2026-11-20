import type { BackupActions } from 'src/lib/use-backup'
import type { BackupView } from 'src/shared/contract'

/** A fake `BackupActions`: every call resolves with `view`. */
export function makeActions(
  view: BackupView,
  password = 'sample-temporary-phrase',
): jest.Mocked<BackupActions> {
  return {
    start: jest.fn().mockResolvedValue(view),
    sync: jest.fn().mockResolvedValue(view),
    submitPassword: jest.fn().mockResolvedValue(view),
    submitCode: jest.fn().mockResolvedValue(view),
    cancel: jest.fn().mockResolvedValue(view),
    resetImmichPassword: jest.fn().mockResolvedValue(password),
    reload: jest.fn(),
  }
}
