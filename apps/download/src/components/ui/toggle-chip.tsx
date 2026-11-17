'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  ChangeEvent,
  ComponentPropsWithoutRef,
  JSX,
  ReactNode,
} from 'react'

const TOGGLE_CHIP_BASE = cns(
  'inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm select-none',
  'transition-[border-color,background-color,color] duration-200 ease-standard',
  'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
  'has-disabled:cursor-not-allowed has-disabled:opacity-40',
)

const TOGGLE_CHIP_CHECKED = 'border-accent-dim bg-accent-ghost text-accent-hi'
const TOGGLE_CHIP_IDLE =
  'border-line-control bg-bg-sunk text-ink-2 hover:border-line-loud'

export type ToggleChipProps = Omit<
  ComponentPropsWithoutRef<'label'>,
  'onChange'
> & {
  /** The chip's text — a genre, or a person's name. */
  label: ReactNode
  /** Controlled checked state. */
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  /** Forwarded to the checkbox, for chips that post as part of a form. */
  name?: string
  /** Forwarded to the checkbox. */
  value?: string
  /** Forwarded to the checkbox. */
  disabled?: boolean
  /** Escape hatch onto the checkbox itself. */
  inputProps?: Omit<
    ComponentPropsWithoutRef<'input'>,
    'checked' | 'name' | 'type' | 'value' | 'onChange'
  >
  /** Rendered before the label — the mockups put an avatar here. */
  children?: ReactNode
}

/**
 * A person or a genre you can filter by.
 *
 * `ui.pug` reads the checked state straight off the input with `:has()` so
 * the mockup works without JavaScript. Here the chip is controlled, but the
 * nested checkbox stays: it is the accessible control, it carries the label
 * through the wrapping `<label>`, and it keeps the chip usable with a
 * keyboard and inside a form.
 */
export function ToggleChip({
  label,
  checked,
  onCheckedChange,
  name,
  value,
  disabled,
  inputProps,
  className,
  children,
  ...props
}: ToggleChipProps): JSX.Element {
  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onCheckedChange?.(event.target.checked)
  }

  return (
    <label
      {...props}
      className={cns(
        TOGGLE_CHIP_BASE,
        checked ? TOGGLE_CHIP_CHECKED : TOGGLE_CHIP_IDLE,
        className,
      )}
    >
      <input
        {...inputProps}
        checked={checked}
        className={cns('sr-only', inputProps?.className)}
        disabled={disabled}
        name={name}
        type="checkbox"
        value={value}
        onChange={handleChange}
      />
      {children}
      {label}
    </label>
  )
}
