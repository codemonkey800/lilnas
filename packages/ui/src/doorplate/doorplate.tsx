import { cns } from '@lilnas/utils/cns'
import type { HTMLAttributes, JSX, Ref } from 'react'

import { PepeBadge } from '../marks'

export type DoorplateProps = Omit<HTMLAttributes<HTMLElement>, 'children'> & {
  /** The subdomain: `swole` reads `swole.lilnas.io`. Omit it on the portal. */
  app?: string
  /** Where it links: the app's own root by default. `null` makes it inert. */
  href?: string | null
  ref?: Ref<HTMLElement>
}

const TLD = 'lilnas.io'

/**
 * The signature: pepe badge plus the app's address in mono. The only
 * component with no variants, because its whole job is to be the same
 * everywhere. With `app` it links to that app's home (`/`); without `app` it
 * reads `lilnas.io` and doesn't link anywhere.
 */
export function Doorplate({
  app,
  href = '/',
  className,
  ref,
  ...props
}: DoorplateProps): JSX.Element {
  const link = app !== undefined && href !== null
  const classes = cns(
    'inline-flex h-8 items-center gap-2 rounded-full border border-line bg-surface pr-3 pl-1',
    link &&
      'transition-[border-color,background-color] duration-200 ease-standard hover:border-line-loud hover:bg-surface-2',
    className,
  )
  const content = (
    <>
      <PepeBadge size={24} />
      <span className="font-mono text-xs font-medium text-ink">
        {app ? (
          <>
            {app}
            <span className="text-ink-3">.{TLD}</span>
          </>
        ) : (
          TLD
        )}
      </span>
    </>
  )

  if (link) {
    return (
      <a
        aria-label={`${app}.${TLD}`}
        {...props}
        className={classes}
        href={href}
        ref={ref as Ref<HTMLAnchorElement>}
      >
        {content}
      </a>
    )
  }

  return (
    <span {...props} className={classes} ref={ref as Ref<HTMLSpanElement>}>
      {content}
    </span>
  )
}
