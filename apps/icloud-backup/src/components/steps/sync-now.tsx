import { Button, Note } from '@lilnas/ui'
import type { JSX } from 'react'

import { PHONE_FULL } from 'src/components/steps/styles'
import { useAction } from 'src/components/steps/use-action'
import type { BackupActions } from 'src/lib/use-backup'

/**
 * "Sync now": off while the server is low on space, with the reason beside it.
 * A failed call shows its message under the button.
 */
export function SyncNow({
  actions,
  lowDiskSpace,
  className,
}: {
  actions: BackupActions
  lowDiskSpace: boolean
  className?: string
}): JSX.Element {
  const sync = useAction()

  return (
    <div className={className}>
      <Button
        className={PHONE_FULL}
        disabled={lowDiskSpace}
        icon="refresh"
        loading={sync.pending}
        size="sm"
        onClick={() => void sync.run(actions.sync)}
      >
        Sync now
      </Button>
      {lowDiskSpace ? (
        <p className="mt-2 text-cap text-warn">
          The server is low on space, so Sync now is off until there is room.
        </p>
      ) : null}
      {sync.error ? (
        <Note className="mt-3" lead="Couldn't start the backup." tone="bad">
          {sync.error}
        </Note>
      ) : null}
    </div>
  )
}
