import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/**
 * Every icon in the sprite (`sprite.tsx`), alphabetically.
 */
export const ICON_NAMES = [
  'alert',
  'arrow',
  'check',
  'clock',
  'download',
  'external',
  'file',
  'lock',
  'play',
  'recreate',
  'refresh',
  'search',
  'stop',
  'terminal',
  'trash',
  'x',
] as const

export type IconName = (typeof ICON_NAMES)[number]

/**
 * The doorplate's pepe badge. It lives in the same sprite but is not an
 * `IconName`: it is a fixed multi-colour 240x240 mark rather than a 16x16
 * `currentColor` line icon, so it is referenced by id directly.
 */
export const PEPE_SYMBOL_ID = 'pepe'

/** The `<symbol>` id a given icon name resolves to. */
export function iconSymbolId(name: IconName): string {
  return `i-${name}`
}

export type IconProps = Omit<ComponentPropsWithoutRef<'svg'>, 'name'> & {
  name: IconName
}

/**
 * A single icon, drawn by referencing the sprite rendered once in the root
 * layout (see `IconSprite`). Icons carry no intrinsic size — pass one, the way
 * the mockups do: `<Icon name="film" className="h-4 w-4" />`.
 *
 * Icons are decorative by default (`aria-hidden`, non-focusable). A caller
 * that needs an announced icon can override `aria-hidden` and supply a
 * `role`/`aria-label`.
 */
export function Icon({ name, className, ...props }: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      {...props}
      className={cns(className) || undefined}
    >
      <use href={`#${iconSymbolId(name)}`} />
    </svg>
  )
}
