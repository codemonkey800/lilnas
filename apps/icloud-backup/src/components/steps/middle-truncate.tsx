import type { JSX } from 'react'

const TAIL_LENGTH = 14

/**
 * A path that shortens in the middle with an ellipsis, so the file name and
 * its extension stay visible. The full text is the tooltip.
 */
export function MiddleTruncate({
  text,
  className,
}: {
  text: string
  className?: string
}): JSX.Element {
  const split = Math.max(0, text.length - TAIL_LENGTH)

  return (
    <span className={className} title={text}>
      <span className="flex min-w-0">
        <span className="truncate">{text.slice(0, split)}</span>
        <span className="shrink-0 whitespace-pre">{text.slice(split)}</span>
      </span>
    </span>
  )
}
