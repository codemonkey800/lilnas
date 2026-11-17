import { ConfirmDialog } from '@lilnas/ui'

import { useRedescribeAllEmojis } from 'src/queries/useEmojis'

import { DialogNote } from './DialogNote'

interface RedescribeAllDialogProps {
  open: boolean
  total: number
  manual: number
  onClose: () => void
  onStarted: () => void
}

/** Confirms replacing every description with a fresh AI one. */
export function RedescribeAllDialog({
  open,
  total,
  manual,
  onClose,
  onStarted,
}: RedescribeAllDialogProps) {
  const redescribeAll = useRedescribeAllEmojis()

  const close = () => {
    redescribeAll.reset()
    onClose()
  }

  const confirm = () => {
    redescribeAll.mutate(undefined, {
      onSuccess: () => {
        onStarted()
        close()
      },
    })
  }

  return (
    <ConfirmDialog
      body={
        <>
          <span className="block">
            Every emoji gets a new AI description, written in batches so similar
            emojis stay distinct. This runs in the background.
          </span>
          {manual > 0 && (
            <DialogNote
              lead={`${manual} manual description${manual === 1 ? '' : 's'}`}
              tone="warn"
            >
              will be replaced. The old text isn’t kept.
            </DialogNote>
          )}
          {redescribeAll.error && (
            <DialogNote lead="Couldn’t start." tone="bad">
              {redescribeAll.error.message}
            </DialogNote>
          )}
        </>
      }
      cancelLabel="Cancel"
      confirmLabel="Re-describe all"
      open={open}
      pending={redescribeAll.isPending}
      title={`Re-describe all ${total} emojis?`}
      tone="accent"
      onConfirm={confirm}
      onOpenChange={next => {
        if (!next) close()
      }}
    />
  )
}
