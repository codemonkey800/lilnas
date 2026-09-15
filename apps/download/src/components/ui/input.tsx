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
 * Spelled out rather than written as `text-mono`, because of a *second*,
 * independent mechanism that eats a font-size utility.
 *
 * `cns` is `twMerge(clsx(...))`, and tailwind-merge only knows Tailwind's
 * built-in font-size names. Every custom `--text-*` token in `tailwind.css`
 * is therefore misclassified as a text *colour*, so `text-mono` and any text
 * colour land in the same conflict group and the size is silently dropped:
 *
 *     cns('font-mono text-mono text-ink-3') === 'font-mono text-ink-3'
 *
 * `Input`'s own base classes carry no bare text colour — `placeholder:` is a
 * variant, which twMerge groups separately — so the bug only bites once a
 * caller passes one through `className`. That is a live call site away, and
 * it fails silently, so the token is expanded here instead.
 *
 * `text-[length:var(--text-mono)]` is classified correctly. It only carries
 * the size, though: `--text-mono` also declares `--text-mono--font-weight`
 * and `--text-mono--letter-spacing`, which `text-mono` would have emitted
 * too, so both are restated explicitly. Dropping them is the quiet way to
 * get this substitution wrong.
 *
 * The proper fix is an `extendTailwindMerge` config in `@lilnas/utils`, which
 * also covers `portal` and `dashcam`; that is a separate, wider change.
 */
const INPUT_MONO = cns(
  'font-mono text-[length:var(--text-mono)] font-[450] tracking-[-0.01em]',
)
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
