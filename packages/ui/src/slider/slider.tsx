'use client'

import { Slider as BaseSlider } from '@base-ui/react/slider'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

export type SliderProps = {
  value: number
  onValueChange: (value: number) => void
  min: number
  max: number
  step: number
  /** The accessible name, shown above the track on the left. */
  label: string
  /** Text for the current value; also read out as `aria-valuetext`. */
  format?: (value: number) => string
  disabled?: boolean
  /** Submitted under this name through the range input. */
  name?: string
  className?: string
}

function decimals(n: number): number {
  const [, fraction = ''] = String(n).split('.')
  return fraction.length
}

/**
 * Clamp into `[min, max]`, then snap to the nearest `step` counted from
 * `min`, without the float noise (`0.1 * 3`) of plain multiplication.
 */
function snap(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(Math.max(value, min), max)
  const places = Math.max(decimals(step), decimals(min))
  const snapped = min + Math.round((clamped - min) / step) * step

  // The last step can overshoot `max` when the range isn't a whole number of
  // steps.
  return Math.min(Number(snapped.toFixed(places)), max)
}

/**
 * A single-thumb slider with its label and current value above the track.
 * `value` is clamped and rounded to `step` before it is shown, so a stray
 * `0.30000000000000004` reads as `0.3`.
 *
 * ```tsx
 * <Slider
 *   label="Temperature"
 *   min={0}
 *   max={2}
 *   step={0.1}
 *   value={temperature}
 *   format={v => v.toFixed(1)}
 *   onValueChange={setTemperature}
 * />
 * ```
 */
export function Slider({
  value,
  onValueChange,
  min,
  max,
  step,
  label,
  format = String,
  disabled,
  name,
  className,
}: SliderProps): JSX.Element {
  const shown = snap(value, min, max, step)

  return (
    <BaseSlider.Root
      className={cns('flex flex-col gap-2', className)}
      disabled={disabled}
      max={max}
      min={min}
      name={name}
      step={step}
      value={shown}
      onValueChange={next => onValueChange(snap(next, min, max, step))}
    >
      <div className="flex items-baseline justify-between gap-3">
        <BaseSlider.Label className="text-sm font-medium text-ink-2">
          {label}
        </BaseSlider.Label>
        <BaseSlider.Value className="text-sm text-ink tabular-nums">
          {() => format(shown)}
        </BaseSlider.Value>
      </div>
      <BaseSlider.Control
        className={cns(
          'flex h-6 w-full touch-none items-center select-none',
          'pointer-coarse:h-11',
          'data-disabled:cursor-not-allowed data-disabled:opacity-40',
        )}
      >
        <BaseSlider.Track className="h-1.5 w-full rounded-full bg-surface-2">
          <BaseSlider.Indicator className="rounded-full bg-accent" />
          <BaseSlider.Thumb
            className={cns(
              'size-[18px] rounded-full border-[3px] border-accent bg-ink',
              'transition-[box-shadow] duration-200 ease-standard',
              'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent',
              'data-dragging:ring-4 data-dragging:ring-accent-ghost',
            )}
            getAriaValueText={(_formatted, v) =>
              format(snap(v, min, max, step))
            }
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  )
}
