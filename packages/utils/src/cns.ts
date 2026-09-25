import clsx, { ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * Font-size token names declared in this repo's Tailwind `@theme` blocks —
 * currently `apps/download/src/tailwind.css`, ported from the Ultraviolet
 * design system.
 *
 * tailwind-merge only recognises Tailwind's *built-in* font-size scale, so a
 * custom `text-<token>` utility falls through to its `text-color` group
 * instead. That puts a size token and an ink colour into the same conflict
 * group, and twMerge keeps only the last member — so whichever is written
 * second silently deletes the first:
 *
 * ```
 * cns('text-cap text-ink-3')   // -> 'text-ink-3'  (size lost)
 * cns('text-ink-3 text-cap')   // -> 'text-cap'    (colour lost)
 * ```
 *
 * Registering the names under the `text` theme namespace puts them back in the
 * `font-size` group, where Tailwind itself puts them, so a size and a colour
 * can coexist. `text-sm` is deliberately absent — the theme shadows its *value*
 * but the name is built in, so tailwind-merge already classifies it correctly.
 */
export const THEME_FONT_SIZES = [
  'h1',
  'h2',
  'h3',
  'body',
  'cap',
  'mono',
  'mono-sm',
  'label',
] as const

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...THEME_FONT_SIZES],
    },
  },
})

export function cns(...values: ClassValue[]): string {
  return twMerge(clsx(...values))
}

export function cnsNoMerge(...values: ClassValue[]): string {
  return clsx(...values)
}
