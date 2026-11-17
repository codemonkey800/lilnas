import { ConfirmDialog } from '@lilnas/ui'

import type { ReminderView } from 'src/api/api.types'
import { useCancelReminder } from 'src/queries/useReminders'

interface CancelDialogProps {
  reminder: ReminderView | null
  onClose: () => void
}

export function CancelDialog({ reminder, onClose }: CancelDialogProps) {
  const cancel = useCancelReminder()

  const close = () => {
    cancel.reset()
    onClose()
  }

  const confirm = () => {
    if (!reminder) return
    cancel.mutate(reminder.id, { onSuccess: close })
  }

  const schedule = reminder?.scheduleDescription.replace(/\.$/, '')
  const consequence = reminder?.isRecurring
    ? 'cancelling stops every future run.'
    : 'cancelling means it won’t be sent.'

  return (
    <ConfirmDialog
      body={
        <>
          {reminder ? `${schedule}, and ${consequence}` : null}
          {cancel.error && (
            <span className="mt-2 block text-bad" role="alert">
              {cancel.error.message}
            </span>
          )}
        </>
      }
      cancelLabel="Keep it"
      confirmLabel="Cancel reminder"
      open={!!reminder}
      pending={cancel.isPending}
      title={reminder ? `Cancel “${reminder.what}”?` : ''}
      onConfirm={confirm}
      onOpenChange={next => {
        if (!next) close()
      }}
    />
  )
}
