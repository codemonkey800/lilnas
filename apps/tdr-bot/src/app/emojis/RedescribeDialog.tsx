import { ConfirmDialog } from '@lilnas/ui'

import type { EmojiView } from 'src/api/api.types'
import { useRedescribeEmoji } from 'src/queries/useEmojis'

import { DialogNote } from './DialogNote'
import { EmojiImage } from './EmojiImage'

interface RedescribeDialogProps {
  emoji: EmojiView | null
  onClose: () => void
}

/** Confirms replacing a manual description with an AI one. */
export function RedescribeDialog({ emoji, onClose }: RedescribeDialogProps) {
  const redescribe = useRedescribeEmoji()

  const close = () => {
    redescribe.reset()
    onClose()
  }

  const confirm = () => {
    if (!emoji) return
    redescribe.mutate(emoji.id, { onSuccess: close })
  }

  return (
    <ConfirmDialog
      body={
        <>
          <span className="block">
            Replace this hand-written description with an AI one? The old text
            isn’t kept.
          </span>
          {emoji && (
            <span className="mt-3 flex items-start gap-3 rounded-md border border-line bg-bg-sunk p-3">
              <EmojiImage emoji={emoji} />
              <span className="text-sm text-ink-2">{emoji.description}</span>
            </span>
          )}
          {redescribe.error && (
            <DialogNote lead="Couldn’t re-describe." tone="bad">
              {redescribe.error.message}
            </DialogNote>
          )}
        </>
      }
      cancelLabel="Keep it"
      confirmLabel="Re-describe"
      open={!!emoji}
      pending={redescribe.isPending}
      title={`Re-describe :${emoji?.name ?? ''}:?`}
      tone="accent"
      onConfirm={confirm}
      onOpenChange={open => {
        if (!open) close()
      }}
    />
  )
}
