'use client'

import {
  Radio,
  RadioGroup,
  type RadioGroupProps,
  type RadioProps,
} from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

/**
 * One choice among several, picked by value - the "what's wrong with this
 * file?" list and the import dialog's file list.
 *
 * A thin layer over the package's `RadioGroup` and `Radio`, so the semantics
 * are Base UI's: one `radiogroup`, one tab stop on the chosen radio, the arrow
 * keys moving and choosing, Home and End, a native `form` value. This file
 * used to hand-roll all of that on `<button role="radio">`; it now only names
 * the pair and gives a row its breathing room.
 */
export type ReasonGroupProps = RadioGroupProps<string>

/** The radio group. Name it with `aria-label` or `aria-labelledby`. */
export function ReasonGroup({
  className,
  ...props
}: ReasonGroupProps): JSX.Element {
  return <RadioGroup<string> {...props} className={cns('gap-2.5', className)} />
}

export type ReasonProps = RadioProps<string>

/**
 * A radio and its label. `value` is what the group reports; `label` is what
 * the person reads - a string, or a few lines of it.
 */
export function Reason({ className, ...props }: ReasonProps): JSX.Element {
  return <Radio<string> {...props} className={cns('items-start', className)} />
}
