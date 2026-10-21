import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'

export type CalloutTone = 'warn' | 'bad' | 'mute'

/**
 * `[&_svg]:` reaches the leading icon, which is the only svg inside a callout.
 * A tone is a status, so `warn` and `bad` tint the border, the fill and the
 * icon; `mute` is the neutral aside.
 */
const CALLOUT_TONES: Record<CalloutTone, string> = {
  warn: 'border-warn/30 bg-warn-ghost [&_svg]:text-warn',
  bad: 'border-bad/32 bg-bad-ghost [&_svg]:text-bad',
  mute: 'border-line bg-bg-sunk [&_svg]:text-ink-3',
}

export type CalloutProps = ComponentPropsWithoutRef<'div'> & {
  /** Defaults to the neutral aside. */
  tone?: CalloutTone
  /** The leading icon. Defaults to `alert`. */
  icon?: IconName
}

/**
 * A tinted aside inside a card. Ported from `dev.pug`'s `+callout`.
 *
 * `role="status"` for the quiet tones and `role="alert"` for `bad`, so an
 * action's failure is announced when it appears.
 */
export function Callout({
  tone = 'mute',
  icon = 'alert',
  className,
  children,
  ...props
}: CalloutProps): JSX.Element {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      {...props}
      className={cns(
        'flex gap-2.5 rounded-md border px-3 py-2.5 text-sm text-ink-2',
        CALLOUT_TONES[tone],
        className,
      )}
    >
      <Icon className="mt-0.5 h-[15px] w-[15px] shrink-0" name={icon} />
      <div className="min-w-0">{children}</div>
    </div>
  )
}
