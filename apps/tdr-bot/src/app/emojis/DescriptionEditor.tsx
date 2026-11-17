import { Button, Note, Textarea } from '@lilnas/ui'
import { useState } from 'react'

import type { EmojiView } from 'src/api/api.types'
import { useUpdateEmoji } from 'src/queries/useEmojis'

import { canSaveDescription, DESCRIPTION_MAX } from './format'

interface DescriptionEditorProps {
  emoji: EmojiView
  onClose: () => void
}

/** The inline description editor; saving marks the description manual. */
export function DescriptionEditor({ emoji, onClose }: DescriptionEditorProps) {
  const [draft, setDraft] = useState(emoji.description ?? '')
  const update = useUpdateEmoji()

  const save = () => {
    update.mutate(
      { id: emoji.id, description: draft.trim() },
      { onSuccess: onClose },
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        aria-label={`Description of :${emoji.name}:`}
        className="border-accent"
        maxLength={DESCRIPTION_MAX}
        rows={4}
        value={draft}
        onChange={e => setDraft(e.target.value)}
      />
      <div className="flex items-start justify-between gap-3 text-xs text-ink-3">
        <span>Saving marks this description as manual.</span>
        <span className="shrink-0 font-mono tabular-nums">
          {draft.length} / {DESCRIPTION_MAX}
        </span>
      </div>
      {update.error && (
        <Note lead="Couldn’t save." tone="bad">
          {update.error.message}
        </Note>
      )}
      <div className="flex gap-2">
        <Button
          disabled={!canSaveDescription(draft, emoji.description)}
          loading={update.isPending}
          size="sm"
          variant="accent"
          onClick={save}
        >
          Save
        </Button>
        <Button
          disabled={update.isPending}
          size="sm"
          variant="ghost"
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
