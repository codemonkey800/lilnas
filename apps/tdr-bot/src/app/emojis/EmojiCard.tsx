import { Badge, Button, Spinner } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'

import type { EmojiView } from 'src/api/api.types'

import { DescriptionEditor } from './DescriptionEditor'
import { EmojiImage } from './EmojiImage'
import { formatDay, formatWhen, hasActions, isPending } from './format'
import { SourceChip } from './SourceChip'

export interface EmojiCardProps {
  emoji: EmojiView
  editing: boolean
  /** A reconcile is running, so pending cards are being described. */
  reconciling: boolean
  /** This card's re-describe request is in flight. */
  redescribing: boolean
  onEdit: (emoji: EmojiView) => void
  onCloseEdit: () => void
  onRedescribe: (emoji: EmojiView) => void
}

function Description({
  emoji,
  reconciling,
}: Pick<EmojiCardProps, 'emoji' | 'reconciling'>) {
  if (emoji.description) {
    return <p className="text-sm text-ink-2">{emoji.description}</p>
  }
  if (reconciling && isPending(emoji)) {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-3 italic">
        <Spinner size={14} />
        Describing…
      </p>
    )
  }

  return <p className="text-sm text-ink-3 italic">Waiting for a description</p>
}

function Provenance({ emoji }: { emoji: EmojiView }) {
  if (emoji.deletedAt) return <>Deleted {formatDay(emoji.deletedAt)}</>
  if (!emoji.describedAt) return <>Not described yet</>

  return (
    <span className="font-mono text-mono-sm">
      {emoji.model ?? 'by hand'} · {formatWhen(emoji.describedAt)}
    </span>
  )
}

/** One emoji: image, name, source, the description (or its editor), actions. */
export function EmojiCard({
  emoji,
  editing,
  reconciling,
  redescribing,
  onEdit,
  onCloseEdit,
  onRedescribe,
}: EmojiCardProps) {
  return (
    <li
      className={cns(
        'flex flex-col gap-3 rounded-lg border border-line bg-surface p-3',
        emoji.deletedAt && 'opacity-60',
      )}
      data-testid={`emoji-${emoji.name}`}
    >
      <div className="flex items-center gap-3">
        <EmojiImage emoji={emoji} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate font-mono text-mono">:{emoji.name}:</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceChip emoji={emoji} />
            {emoji.animated && <Badge>Animated</Badge>}
          </div>
        </div>
      </div>

      {editing ? (
        <DescriptionEditor emoji={emoji} onClose={onCloseEdit} />
      ) : (
        <Description emoji={emoji} reconciling={reconciling} />
      )}

      <div className="mt-auto flex flex-col gap-1.5 border-t border-line-soft pt-2.5">
        <p className="truncate text-cap text-ink-3">
          <Provenance emoji={emoji} />
        </p>
        {!editing && hasActions(emoji) && (
          <div className="-mx-1 flex gap-1">
            <Button
              aria-label={`Edit :${emoji.name}:`}
              size="sm"
              variant="ghost"
              onClick={() => onEdit(emoji)}
            >
              Edit
            </Button>
            <Button
              aria-label={`Re-describe :${emoji.name}:`}
              loading={redescribing}
              size="sm"
              variant="ghost"
              onClick={() => onRedescribe(emoji)}
            >
              {redescribing ? 'Re-describing…' : 'Re-describe'}
            </Button>
          </div>
        )}
      </div>
    </li>
  )
}
