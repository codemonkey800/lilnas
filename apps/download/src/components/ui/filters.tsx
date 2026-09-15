'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  FocusEvent,
  JSX,
  ReactNode,
  RefObject,
} from 'react'
import { useCallback, useEffect, useId, useRef } from 'react'

import type { ButtonProps } from 'src/components/ui/button'
import { Button } from 'src/components/ui/button'
import { Icon } from 'src/components/ui/icon'

/**
 * The open tint. `ui.pug` leaves this on the call site — every `+filtersBtn`
 * in gallery.pug and search.pug pairs `open: true` with exactly this class
 * string — so it is folded into the component instead of being retyped at
 * four call sites, where one of them would eventually drift.
 *
 * It lands through `cns` on top of `outline`'s `border-line bg-surface
 * text-ink`, which is the same conflict the mockup resolves with `&attributes`
 * and tailwind-merge resolves here. A caller's own `className` still wins over
 * it, because it is merged last.
 */
const FILTERS_BUTTON_OPEN = 'border-uv/35 bg-uv-ghost text-uv-hi'

const FILTERS_BUTTON_COUNT = cns(
  'inline-flex h-4 min-w-4 items-center justify-center rounded-full',
  'bg-uv px-1 font-mono text-[10px] font-bold text-uv-ink',
)

const FILTERS_BUTTON_CHEVRON = 'h-[13px] w-[13px] shrink-0 text-ink-3'

export type FiltersButtonProps = Omit<
  ButtonProps,
  'children' | 'icon' | 'iconEnd' | 'variant'
> & {
  /**
   * `ref` is declared because this button is the popover's trigger: a
   * `FilterPanel` needs the element to keep a press on it from counting as an
   * outside dismissal, and to hand focus back on close. React 19 treats `ref`
   * as an ordinary prop, so it reaches the underlying `<button>` through
   * `Button`'s own prop spread.
   */
  ref?: ComponentPropsWithRef<'button'>['ref']
  /** Number of filters currently applied. Falsy renders no badge. */
  count?: number
  /** Whether the filter panel is open — flips the chevron and the tint. */
  open?: boolean
  /** Overrides the default "Filters" text. */
  label?: ReactNode
}

/**
 * The Filters trigger: an `outline` button carrying a count of what's applied
 * and a chevron that flips while the panel is open.
 *
 * `aria-haspopup`/`aria-expanded` are emitted before the prop spread, so a
 * call site driving something other than a `FilterPanel` can override them.
 * `aria-expanded` is omitted entirely when `open` is, since a button that
 * never reports an open state should not claim a collapsed one either.
 */
export function FiltersButton({
  count,
  open,
  label = 'Filters',
  className,
  ...props
}: FiltersButtonProps): JSX.Element {
  return (
    <Button
      aria-expanded={open}
      aria-haspopup="dialog"
      {...props}
      className={cns(open && FILTERS_BUTTON_OPEN, className)}
      variant="outline"
    >
      {label}
      {count ? <span className={FILTERS_BUTTON_COUNT}>{count}</span> : null}
      <Icon
        className={cns(FILTERS_BUTTON_CHEVRON, open && 'rotate-180')}
        name="chevron"
      />
    </Button>
  )
}

const APPLIED_FILTER_CHIP = cns(
  'inline-flex h-[27px] items-center gap-[7px] rounded-full border',
  'border-uv/30 bg-uv-ghost py-0 pr-2 pl-[11px]',
  'text-[12.5px] font-[550] text-uv-hi',
)

const APPLIED_FILTER_CHIP_REMOVE = cns(
  'flex opacity-70 transition-opacity duration-200 ease-uv',
  'hover:opacity-100',
)

export type AppliedFilterChipProps = Omit<
  ComponentPropsWithoutRef<'span'>,
  'children'
> & {
  /** What the filter is currently set to — `Comedy`, `2019–2024`. */
  label: ReactNode
  /**
   * The remove button's whole accessible name, and required for that reason:
   * a screen-reader user meets a row of these and "Remove" alone tells them
   * nothing about which one they are on. The mockups name the facet
   * (`Remove year filter`) rather than the value.
   */
  removeLabel: string
  onRemove?: () => void
  /** Escape hatch onto the remove button. */
  removeButtonProps?: Omit<
    ComponentPropsWithoutRef<'button'>,
    'aria-label' | 'children' | 'onClick' | 'type'
  >
}

/**
 * One applied filter, with its own remove button. Accent-tinted, because it's
 * a thing you did rather than a thing the system reports.
 */
export function AppliedFilterChip({
  label,
  removeLabel,
  onRemove,
  removeButtonProps,
  className,
  ...props
}: AppliedFilterChipProps): JSX.Element {
  return (
    <span {...props} className={cns(APPLIED_FILTER_CHIP, className)}>
      {label}
      <button
        type="button"
        {...removeButtonProps}
        aria-label={removeLabel}
        className={cns(
          APPLIED_FILTER_CHIP_REMOVE,
          removeButtonProps?.className,
        )}
        onClick={onRemove}
      >
        <Icon className="h-3 w-3" name="x" />
      </button>
    </span>
  )
}

/**
 * `@container` so `FilterGrid` can key its column count off the panel's own
 * width rather than the viewport — the same panel markup renders inside a
 * 340px mobile popover and a 480px desktop one.
 */
const FILTER_PANEL = cns(
  '@container rounded-lg border border-line bg-surface',
  'px-[22px] pt-5 pb-[18px] shadow-lift',
)

type FilterPanelBaseProps = ComponentPropsWithoutRef<'div'>

type FilterPanelStaticProps = FilterPanelBaseProps & {
  open?: never
  onOpenChange?: never
  triggerRef?: never
}

type FilterPanelPopoverProps = FilterPanelBaseProps & {
  /** Renders nothing while `false`. */
  open: boolean
  /** Called with `false` on Escape, a press outside, or a tab out. */
  onOpenChange?: (open: boolean) => void
  /**
   * The `FiltersButton` that opened the panel. A press on it is not an
   * outside press — without this the trigger's own click would dismiss and
   * immediately re-open — and Escape hands focus back to it.
   */
  triggerRef?: RefObject<HTMLElement | null>
}

/**
 * Omitting `open` renders a plain, always-present panel with no popover
 * behaviour; passing it opts into the dismissal and focus model below. The two
 * are split at the type level so `onOpenChange`/`triggerRef` can't be passed
 * to a panel that will never call them.
 */
export type FilterPanelProps = FilterPanelStaticProps | FilterPanelPopoverProps

/**
 * The filter panel. In popover mode it follows `menu.tsx`'s model:
 *
 * - Opening moves real DOM focus onto the panel itself rather than its first
 *   control, so a screen reader announces the dialog and a mobile keyboard
 *   does not spring open on the date field.
 * - `Escape` closes and returns focus to the trigger. The listener is on the
 *   document, not the panel, so it fires even when the pointer left focus on
 *   a non-focusable part of the panel; a nested popup that already handled
 *   the key (`Menu` calls `preventDefault`) is skipped, so Escape peels one
 *   layer at a time.
 * - A pointer press outside the panel and outside the trigger closes it,
 *   deliberately leaving focus where the pointer put it.
 * - Tabbing out closes it. A `focusout` with no `relatedTarget` does not:
 *   clicking a label inside the panel drops focus to `<body>` and would
 *   otherwise read as leaving.
 *
 * Focus is *not* trapped. This is a non-modal popover — the page underneath
 * stays reachable, which is why dismissal is so generous.
 */
export function FilterPanel({
  open,
  onOpenChange,
  triggerRef,
  className,
  children,
  ...props
}: FilterPanelProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null)

  const isPopover = open !== undefined
  const isOpen = open ?? true

  const close = useCallback(() => onOpenChange?.(false), [onOpenChange])

  const closeAndReturnFocus = useCallback(() => {
    close()
    triggerRef?.current?.focus()
  }, [close, triggerRef])

  useEffect(() => {
    if (!isPopover || !isOpen) {
      return
    }

    panelRef.current?.focus()
  }, [isPopover, isOpen])

  useEffect(() => {
    if (!isPopover || !isOpen) {
      return
    }

    function isInside(target: EventTarget | null): boolean {
      if (!(target instanceof Node)) {
        return false
      }

      return Boolean(
        panelRef.current?.contains(target) ||
          triggerRef?.current?.contains(target),
      )
    }

    function handlePointerDown(event: PointerEvent): void {
      if (isInside(event.target)) {
        return
      }

      close()
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }

      event.preventDefault()
      closeAndReturnFocus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isPopover, isOpen, triggerRef, close, closeAndReturnFocus])

  function handleBlur(event: FocusEvent<HTMLDivElement>): void {
    const next = event.relatedTarget

    if (!(next instanceof Node)) {
      return
    }

    if (
      event.currentTarget.contains(next) ||
      triggerRef?.current?.contains(next)
    ) {
      return
    }

    close()
  }

  if (!isOpen) {
    return null
  }

  if (!isPopover) {
    return (
      <div {...props} className={cns(FILTER_PANEL, className)}>
        {children}
      </div>
    )
  }

  return (
    <div
      aria-label="Filters"
      role="dialog"
      tabIndex={-1}
      {...props}
      ref={panelRef}
      className={cns(FILTER_PANEL, className)}
      onBlur={handleBlur}
    >
      {children}
    </div>
  )
}

/**
 * Single column below 400px of *panel* width — two auto-fill columns at 190px
 * min plus the `wide` groups' `col-span-2` don't fit the ~296px a mobile
 * popover has left after the panel's padding, and previously overflowed.
 *
 * The threshold is a container query, so it reads the enclosing
 * `FilterPanel`'s width. Do not convert it to a viewport breakpoint: the same
 * markup has to lay out one way in a 340px popover and another in a 480px one
 * at the same viewport width.
 */
const FILTER_GRID = cns(
  'grid grid-cols-1 gap-x-7 gap-y-[22px]',
  '@min-[400px]:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]',
)

export type FilterGridProps = ComponentPropsWithoutRef<'div'>

/** The panel's groups, laid out against the panel's own width. */
export function FilterGrid({
  className,
  children,
  ...props
}: FilterGridProps): JSX.Element {
  return (
    <div {...props} className={cns(FILTER_GRID, className)}>
      {children}
    </div>
  )
}

const FILTER_GROUP = 'flex flex-col gap-[9px]'

/**
 * The same 400px container threshold `FilterGrid` switches on. Kept next to it
 * rather than retyped at call sites so the two can never disagree.
 */
const FILTER_GROUP_WIDE = '@min-[400px]:col-span-2'

const FILTER_GROUP_LABEL = cns(
  'font-mono text-label uppercase',
  // After the `text-label` token, which carries its own tracking: a font-size
  // utility clears a preceding `tracking-*` through tailwind-merge.
  'tracking-[0.11em] text-ink-4',
)

export type FilterGroupProps = ComponentPropsWithoutRef<'div'> & {
  /** The facet's name — `uploaded by`, `release year`. */
  label: ReactNode
  /** Span both columns once the panel is wide enough to have two. */
  wide?: boolean
  labelClassName?: string
}

/**
 * One labelled facet inside the panel.
 *
 * Deviation from `ui.pug`, which renders a bare `<div>` with a `<span>` over
 * it: the group is a real `role="group"` named by that span, so a multi-select
 * facet's checkboxes are announced as belonging to "uploaded by" and a test
 * can address the whole facet by name. Both attributes precede the prop
 * spread, so a call site can drop back to a plain container.
 */
export function FilterGroup({
  label,
  wide = false,
  labelClassName,
  className,
  children,
  ...props
}: FilterGroupProps): JSX.Element {
  const labelId = useId()

  return (
    <div
      aria-labelledby={labelId}
      role="group"
      {...props}
      className={cns(FILTER_GROUP, wide && FILTER_GROUP_WIDE, className)}
    >
      <span className={cns(FILTER_GROUP_LABEL, labelClassName)} id={labelId}>
        {label}
      </span>
      {children}
    </div>
  )
}

const FILTER_FOOT = cns(
  'mt-5 flex items-center justify-between gap-[14px]',
  'border-t border-line-soft pt-4',
)

export type FilterFootProps = ComponentPropsWithoutRef<'div'>

/** The panel's footer rule — "Clear all" on the left, the confirm on the right. */
export function FilterFoot({
  className,
  children,
  ...props
}: FilterFootProps): JSX.Element {
  return (
    <div {...props} className={cns(FILTER_FOOT, className)}>
      {children}
    </div>
  )
}

/**
 * Deviation from `ui.pug`: `absolute` there, because the mockup's scrim is a
 * child of the fixed-size `appFrame` element that stands in for the viewport.
 * The real app has no such element, so the scrim is `fixed` and covers the
 * actual viewport. `z-10` is unchanged and is the whole point — it sits below
 * the `z-20` the panel's positioning wrapper carries.
 */
const FILTER_SCRIM = 'fixed inset-0 z-10 bg-black/55'

export type FilterScrimProps = ComponentPropsWithoutRef<'div'>

/**
 * Dims the app behind an open filter panel, so the panel reads as a floating
 * popup over the app rather than a bug that hides the first row of a grid.
 *
 * Decorative: `aria-hidden` before the spread. It needs no dismiss handler of
 * its own — a press on it is a press outside the panel, which `FilterPanel`
 * already treats as a dismissal.
 */
export function FilterScrim({
  className,
  ...props
}: FilterScrimProps): JSX.Element {
  return (
    <div
      aria-hidden="true"
      {...props}
      className={cns(FILTER_SCRIM, className)}
    />
  )
}
