'use client'

import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import { Radio as BaseRadio } from '@base-ui/react/radio'
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group'
import { Switch as BaseSwitch } from '@base-ui/react/switch'
import { cns } from '@lilnas/utils/cns'
import type { JSX, ReactNode } from 'react'

// The label is part of the tap target: the whole row is one <label>, 44px
// tall on touch.
const CHOICE_ROW = cns(
  'inline-flex min-h-6 cursor-pointer items-center gap-2 text-sm text-ink-2',
  'has-data-disabled:cursor-not-allowed has-data-disabled:opacity-40',
  'pointer-coarse:min-h-11',
)

const CHOICE_FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const CHOICE_BOX = cns(
  'flex size-[18px] shrink-0 items-center justify-center border border-line-control bg-bg-sunk',
  'transition-[background-color,border-color] duration-200 ease-standard',
  CHOICE_FOCUS,
)

export type CheckboxProps = Omit<BaseCheckbox.Root.Props, 'children'> & {
  label?: ReactNode
}

/** `className` lands on the whole row; the box itself is not restyleable. */
export function Checkbox({
  label,
  className,
  ...props
}: CheckboxProps): JSX.Element {
  return (
    <label className={cns(CHOICE_ROW, className)}>
      <BaseCheckbox.Root
        {...props}
        className={cns(
          CHOICE_BOX,
          'rounded-xs',
          'data-checked:border-accent data-checked:bg-accent',
          'data-indeterminate:border-accent data-indeterminate:bg-accent',
        )}
      >
        <BaseCheckbox.Indicator className="flex text-accent-ink">
          <svg
            aria-hidden="true"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 12 12"
          >
            <IndicatorPath indeterminate={props.indeterminate} />
          </svg>
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {label != null && <span>{label}</span>}
    </label>
  )
}

function IndicatorPath({
  indeterminate,
}: {
  indeterminate?: boolean
}): JSX.Element {
  return indeterminate ? (
    <path d="M2.5 6h7" />
  ) : (
    <path d="m2.5 6.5 2.5 2.5 4.5-5" />
  )
}

export type RadioGroupProps<T = string> = BaseRadioGroup.Props<T>

export function RadioGroup<T = string>({
  className,
  ...props
}: RadioGroupProps<T>): JSX.Element {
  return (
    <BaseRadioGroup<T>
      {...props}
      className={cns('flex flex-col gap-1', className)}
    />
  )
}

export type RadioProps<T = string> = Omit<
  BaseRadio.Root.Props<T>,
  'children'
> & {
  label?: ReactNode
}

export function Radio<T = string>({
  label,
  className,
  ...props
}: RadioProps<T>): JSX.Element {
  return (
    <label className={cns(CHOICE_ROW, className)}>
      <BaseRadio.Root
        {...props}
        className={cns(CHOICE_BOX, 'rounded-full data-checked:border-accent')}
      >
        <BaseRadio.Indicator className="size-2 rounded-full bg-accent" />
      </BaseRadio.Root>
      {label != null && <span>{label}</span>}
    </label>
  )
}

export type SwitchProps = Omit<BaseSwitch.Root.Props, 'children'> & {
  label?: ReactNode
}

export function Switch({
  label,
  className,
  ...props
}: SwitchProps): JSX.Element {
  return (
    <label className={cns(CHOICE_ROW, className)}>
      <BaseSwitch.Root
        {...props}
        className={cns(
          'relative h-5 w-9 shrink-0 rounded-full border border-line-control bg-surface-2',
          'transition-[background-color,border-color] duration-200 ease-standard',
          'data-checked:border-accent data-checked:bg-accent',
          CHOICE_FOCUS,
        )}
      >
        <BaseSwitch.Thumb
          className={cns(
            'absolute top-1/2 left-0.5 size-3.5 -translate-y-1/2 rounded-full bg-ink-3',
            'transition-[translate,background-color] duration-[120ms] ease-spring',
            'data-checked:translate-x-4 data-checked:bg-accent-ink',
          )}
        />
      </BaseSwitch.Root>
      {label != null && <span>{label}</span>}
    </label>
  )
}

export type SegmentedOption<T extends string> = {
  value: T
  label: string
}

export type SegmentedProps<T extends string> = {
  options: readonly SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
  /** The group's accessible name. */
  label: string
  size?: 'sm' | 'md'
  className?: string
}

/**
 * A short row of exclusive choices. A radio group underneath, so arrow keys
 * move and select, and the selected segment reports `aria-checked`.
 */
export function Segmented<T extends string>({
  options,
  value,
  onValueChange,
  label,
  size = 'md',
  className,
}: SegmentedProps<T>): JSX.Element {
  return (
    <BaseRadioGroup<T>
      aria-label={label}
      className={cns(
        'inline-flex rounded-md border border-line-control bg-surface p-0.5',
        className,
      )}
      value={value}
      onValueChange={next => onValueChange(next)}
    >
      {options.map(option => (
        <BaseRadio.Root
          className={cns(
            'inline-flex cursor-pointer items-center justify-center rounded-xs px-3 font-medium text-ink-3 select-none',
            'transition-[background-color,color] duration-200 ease-standard',
            'hover:text-ink data-checked:bg-accent data-checked:text-accent-ink',
            'pointer-coarse:min-h-11',
            size === 'sm' ? 'h-6 text-cap' : 'h-7 text-sm',
            CHOICE_FOCUS,
          )}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </BaseRadio.Root>
      ))}
    </BaseRadioGroup>
  )
}
