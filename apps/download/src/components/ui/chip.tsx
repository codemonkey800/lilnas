'use client'

import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'

import type { IconName } from 'src/components/ui/icon'
import { Icon } from 'src/components/ui/icon'
import type { StatusTone } from 'src/lib/format'

/**
 * A chip's tint is the same vocabulary `statusTone` speaks, so the two are the
 * same type — a tone that `statusTone` can return is always a tone `Chip` can
 * render.
 */
export type ChipTone = StatusTone

const CHIP_TONES: Record<ChipTone, string> = {
  uv: 'bg-uv-ghost text-uv-hi border-uv/30',
  ok: 'bg-ok-ghost text-ok border-ok/30',
  warn: 'bg-warn-ghost text-warn border-warn/30',
  bad: 'bg-bad-ghost text-bad border-bad/32',
  mute: 'bg-surface-2 text-ink-3 border-line',
}

/**
 * `active` wins over `tone` so a selected filter chip always reads as
 * "applied", whatever status tint it would otherwise carry.
 */
const CHIP_ACTIVE = 'border-uv/35 bg-uv-ghost text-uv-hi'

const CHIP_BASE = cns(
  'inline-flex h-[23px] items-center gap-1.5 rounded-full border px-2.5',
  'font-mono text-[11px] font-medium tracking-[0.01em] whitespace-nowrap',
)

const CHIP_INTERACTIVE = cns(
  'cursor-pointer',
  'transition-[border-color,background-color,color] duration-200 ease-uv',
)

const CHIP_INTERACTIVE_ACTIVE = 'hover:border-uv/55'
const CHIP_INTERACTIVE_IDLE = 'hover:border-uv-dim hover:bg-surface-2'

const CHIP_ICON = 'h-[11px] w-[11px]'

type ChipOwnProps = {
  /** Status tint. Omitted renders an untinted, borderless chip. */
  tone?: ChipTone
  /** Chip text. Rendered before `children`. */
  label?: string
  /** Icon rendered before the label. */
  icon?: IconName
  /** Toggle-checked look. Overrides `tone`. */
  active?: boolean
  className?: string
  children?: ReactNode
}

/**
 * An interactive chip is a real `<button>` with `aria-pressed` mirroring
 * `active`. It is opt-in: most chips in the app are read-only status badges,
 * and making every one of them focusable would imply they all do something.
 */
export type InteractiveChipProps = ChipOwnProps &
  Omit<
    ComponentPropsWithoutRef<'button'>,
    keyof ChipOwnProps | 'aria-pressed'
  > & {
    interactive: true
  }

export type StaticChipProps = ChipOwnProps &
  Omit<ComponentPropsWithoutRef<'span'>, keyof ChipOwnProps> & {
    interactive?: false
  }

export type ChipProps = InteractiveChipProps | StaticChipProps

export function Chip(props: ChipProps): JSX.Element {
  const {
    tone,
    label,
    icon,
    active = false,
    interactive,
    className,
    children,
    ...rest
  } = props

  const chipClassName = cns(
    CHIP_BASE,
    active ? CHIP_ACTIVE : tone ? CHIP_TONES[tone] : 'border-transparent',
    interactive && CHIP_INTERACTIVE,
    interactive && (active ? CHIP_INTERACTIVE_ACTIVE : CHIP_INTERACTIVE_IDLE),
    className,
  )

  const content = (
    <>
      {icon ? <Icon className={CHIP_ICON} name={icon} /> : null}
      {label}
      {children}
    </>
  )

  if (interactive) {
    return (
      <button
        type="button"
        {...(rest as ComponentPropsWithoutRef<'button'>)}
        aria-pressed={active}
        className={chipClassName}
      >
        {content}
      </button>
    )
  }

  return (
    <span
      {...(rest as ComponentPropsWithoutRef<'span'>)}
      className={chipClassName}
    >
      {content}
    </span>
  )
}
