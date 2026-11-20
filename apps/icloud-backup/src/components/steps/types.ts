import type { BackupActions } from 'src/lib/use-backup'
import type { BackupView } from 'src/shared/contract'

/** What every step component receives. */
export interface StepProps {
  view: BackupView
  actions: BackupActions
}
