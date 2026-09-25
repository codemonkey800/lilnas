import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { PEPE_SYMBOL_ID } from 'src/components/ui/icon'

type DoorplateElementProps = Omit<
  ComponentPropsWithoutRef<'span'>,
  'children' | 'color'
>

export type DoorplateProps = DoorplateElementProps & {
  /**
   * Renders an `<a>` instead of a `<span>`. The mockups always pass
   * `https://lilnas.io` here - the doorplate is the way back out to the rest
   * of the lilnas apps - but the signature is also legitimately inert, so the
   * link is opt-in rather than baked in.
   */
  href?: string
  /** The subdomain, in mono. `Download` for this app. */
  name: string
}

/**
 * The signature: pepe badge + subdomain in mono. Byte-identical in every
 * lilnas app - see `docs/features/download/designs/README.md`.
 *
 * Ported from `docs/features/download/designs/src/mixins/ui.pug`'s `doorplate`
 * mixin. The pepe mark is referenced straight out of the sprite rather than
 * through `Icon`: it is a fixed multi-colour 240x240 badge, not a 16x16
 * `currentColor` line icon, so it is not an `IconName`. `IconSprite` must be
 * rendered once in the document for it to paint.
 */
export function Doorplate({
  className,
  href,
  name,
  ...props
}: DoorplateProps): JSX.Element {
  const classes = cns(
    'inline-flex h-8 items-center gap-[9px] rounded-full border border-transparent bg-transparent py-0 pr-3 pl-1 transition-[border-color,background-color] duration-200 ease-uv hover:border-uv-dim hover:bg-surface-2',
    className,
  )
  const content = (
    <>
      <span className={cns('grid h-6 w-6 shrink-0 place-items-center')}>
        <svg aria-hidden="true" className={cns('h-full w-full')}>
          <use href={`#${PEPE_SYMBOL_ID}`} />
        </svg>
      </span>
      <span
        className={cns('font-mono text-[12px] font-medium tracking-[-0.01em]')}
      >
        {name}
      </span>
    </>
  )

  if (href) {
    return (
      <a className={classes} href={href} {...props}>
        {content}
      </a>
    )
  }

  return (
    <span className={classes} {...props}>
      {content}
    </span>
  )
}
