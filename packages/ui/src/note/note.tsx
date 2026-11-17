import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

export type NoteTone = 'accent' | 'ok' | 'warn' | 'bad'

/** The tone tints the fill, the icon and the bold lead; the body stays `ink-2`. */
const NOTE_TONES: Record<NoteTone, { fill: string; accent: string }> = {
  accent: { fill: 'bg-accent-ghost', accent: 'text-accent' },
  ok: { fill: 'bg-ok-ghost', accent: 'text-ok' },
  warn: { fill: 'bg-warn-ghost', accent: 'text-warn' },
  bad: { fill: 'bg-bad-ghost', accent: 'text-bad' },
}

export type NoteProps = Omit<ComponentPropsWithoutRef<'div'>, 'role'> & {
  tone?: NoteTone
  /** The bold first sentence. */
  lead: ReactNode
  /** A leading icon, tinted with the tone. */
  icon?: ReactNode
  /** Renders a labelled × button that calls this. */
  onDismiss?: () => void
}

/**
 * Inline banner: a bold lead sentence, then the detail. It is the thing that
 * gets a sentence; a toast only confirms. `role="alert"` for `bad` so a
 * failure is announced when it appears, `status` for the quieter tones.
 */
export function Note({
  tone = 'accent',
  lead,
  icon,
  onDismiss,
  className,
  children,
  ...props
}: NoteProps): JSX.Element {
  const { fill, accent } = NOTE_TONES[tone]

  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      {...props}
      className={cns(
        'flex gap-2.5 rounded-lg px-3 py-2.5 text-sm text-ink-2',
        fill,
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cns('mt-0.5 flex shrink-0 [&_svg]:size-4', accent)}
        >
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <strong className={cns('font-semibold', accent)}>{lead}</strong>
        {children ? <> {children}</> : null}
      </div>
      {onDismiss ? (
        <button
          aria-label="Dismiss"
          className={cns(
            '-my-0.5 -mr-1 flex size-6 shrink-0 items-center justify-center rounded-md',
            'text-ink-3 transition-press hover:bg-surface-2 hover:text-ink',
          )}
          onClick={onDismiss}
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.75"
            viewBox="0 0 24 24"
            width="14"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      ) : null}
    </div>
  )
}
