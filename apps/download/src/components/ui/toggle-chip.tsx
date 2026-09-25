'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  ChangeEvent,
  ComponentPropsWithoutRef,
  JSX,
  ReactNode,
} from 'react'

const TOGGLE_CHIP_BASE = cns(
  'inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border',
  'py-0 pr-[13px] pl-[11px] text-[12.5px] select-none',
  'transition-[border-color,background-color,color] duration-200 ease-uv',
)

const TOGGLE_CHIP_CHECKED = 'border-uv/35 bg-uv-ghost text-uv-hi'
const TOGGLE_CHIP_IDLE = 'border-line bg-surface text-ink-3'

/**
 * The box itself, verbatim from `ui.pug`: an `appearance-none` checkbox that
 * draws its own tick with a rotated `::after`, so it is a real checkbox all
 * the way down rather than a `<div>` wearing one's clothes.
 */
const TOGGLE_CHIP_BOX = cns(
  'relative h-[14px] w-[14px] shrink-0 cursor-pointer appearance-none',
  'rounded-[3px] border-[1.5px] border-line-loud bg-bg-sunk',
  'transition-[background-color,border-color] duration-200 ease-uv',
  'checked:border-uv checked:bg-uv',
  "checked:after:absolute checked:after:top-[-0.5px] checked:after:left-[3px] checked:after:h-[7px] checked:after:w-1 checked:after:rotate-45 checked:after:border-r-[1.6px] checked:after:border-b-[1.6px] checked:after:border-uv-ink checked:after:content-['']",
)

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
  /** Rendered between the box and the label — the mockups put an avatar here. */
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
        className={cns(TOGGLE_CHIP_BOX, inputProps?.className)}
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
