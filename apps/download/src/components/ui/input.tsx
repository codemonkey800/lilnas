'use client'

import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'
import { createContext, useContext, useId } from 'react'

import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'

/**
 * The id `Field` minted for its label, handed to whichever control renders
 * inside it. `undefined` outside a `Field`.
 *
 * A control reads this only as a *default* for its own `id`, so a call site
 * that needs something else — or a `Field` holding more than one control,
 * where a single shared id would duplicate — can always pass `id` explicitly.
 */
const FieldIdContext = createContext<string | undefined>(undefined)

/**
 * The id of the enclosing `Field`'s label target, for controls that want to
 * associate themselves with it (`Input` and `MenuTrigger` both do).
 */
export function useFieldId(): string | undefined {
  return useContext(FieldIdContext)
}

/**
 * `ui.pug` leaves `text-[14px]` on the base and lets `mono`'s `text-mono` land
 * on top of it. Both are font-size utilities, and two utilities for the same
 * property are resolved by Tailwind's output order rather than by source
 * order, so the type size is folded into the mono/proportional pair below and
 * the base carries none. Same reasoning as `BUTTON_SIZES` in `button.tsx`.
 *
 * `px-3` is likewise split into its two sides so that the icon variant's
 * wider left inset is the only padding-left utility on the element.
 */
const INPUT_BASE = cns(
  'h-[38px] w-full rounded-md border border-line bg-bg-sunk pr-3',
  'transition-[border-color,box-shadow] duration-200 ease-uv',
  'placeholder:text-ink-4',
  'focus:border-uv focus:shadow-[0_0_0_3px_var(--color-uv-ghost)] focus:outline-none',
  // Not in the mockup, which draws no disabled field. Mirrors `Button`'s
  // disabled treatment so the two read as one system.
  'disabled:pointer-events-none disabled:opacity-38',
)

/**
 * The bare `text-mono` token, which carries `--text-mono--font-weight: 450`
 * and `--text-mono--letter-spacing: -0.01em` along with the size.
 *
 * It survives a caller's `className` colour only because
 * `packages/utils/src/cns.ts` registers this theme's `--text-*` names as font
 * sizes with `extendTailwindMerge`. Without that, tailwind-merge reads
 * `text-mono` as a text colour and `cns('font-mono text-mono', 'text-ink-3')`
 * silently collapses to `font-mono text-ink-3` — the size gone, at 14px
 * proportional, with nothing in the DOM to say why.
 */
const INPUT_MONO = cns('font-mono text-mono')
const INPUT_PROPORTIONAL = 'text-[14px]'

/** 12px inset + a 14px glyph + an 8px gap. */
const INPUT_PAD_WITH_ICON = 'pl-[34px]'
const INPUT_PAD = 'pl-3'

const INPUT_ICON = cns(
  'pointer-events-none absolute top-1/2 left-3 -translate-y-1/2',
  'h-[14px] w-[14px] shrink-0 text-ink-4',
)

export type InputProps = ComponentPropsWithoutRef<'input'> & {
  /** Render the value in the machine face, the way numeric filters do. */
  mono?: boolean
  /**
   * Icon drawn inside the field's leading edge. Supplying one wraps the input
   * in a positioning element; `className` still lands on the `<input>`, and
   * `wrapperClassName` targets the wrapper.
   */
  icon?: IconName
  /** Only meaningful alongside `icon`. */
  wrapperClassName?: string
}

/**
 * A text field. Defaults to `type="text"`, the way the mixin does.
 *
 * Inside a `Field` the input adopts the field's id automatically so the
 * label points at it; an explicit `id` always wins.
 */
export function Input({
  mono = false,
  icon,
  wrapperClassName,
  className,
  id,
  ...props
}: InputProps): JSX.Element {
  const fieldId = useFieldId()

  const input = (
    <input
      type="text"
      id={id ?? fieldId}
      {...props}
      className={cns(
        INPUT_BASE,
        mono ? INPUT_MONO : INPUT_PROPORTIONAL,
        icon ? INPUT_PAD_WITH_ICON : INPUT_PAD,
        className,
      )}
    />
  )

  if (!icon) {
    return input
  }

  return (
    <div className={cns('relative', wrapperClassName)}>
      <Icon className={INPUT_ICON} name={icon} />
      {input}
    </div>
  )
}

const FIELD_BASE = 'flex flex-col gap-1.5'
const FIELD_LABEL = 'text-[13px] font-[560] text-ink-2'

export type FieldProps = ComponentPropsWithoutRef<'div'> & {
  /** The label's text. */
  label: ReactNode
  /**
   * The id of the control this field labels. Omitted, the field mints one and
   * hands it to the control it wraps through context.
   */
  htmlFor?: string
  labelClassName?: string
}

/**
 * A label stacked over its control.
 *
 * Deviation from `ui.pug`: the mixin renders a bare `<label>` with no
 * `for`, so clicking it does nothing and a screen reader announces the
 * control unnamed. Here the field mints an id with `useId`, points the label
 * at it, and publishes it on `FieldIdContext` for `Input`/`MenuTrigger` to
 * pick up.
 */
export function Field({
  label,
  htmlFor,
  labelClassName,
  className,
  children,
  ...props
}: FieldProps): JSX.Element {
  const generatedId = useId()
  const controlId = htmlFor ?? generatedId

  return (
    <FieldIdContext.Provider value={controlId}>
      <div {...props} className={cns(FIELD_BASE, className)}>
        <label className={cns(FIELD_LABEL, labelClassName)} htmlFor={controlId}>
          {label}
        </label>
        {children}
      </div>
    </FieldIdContext.Provider>
  )
}
