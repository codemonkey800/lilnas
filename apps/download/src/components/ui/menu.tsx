'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  FocusEvent,
  JSX,
  KeyboardEvent,
  ReactNode,
} from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { Icon } from 'src/components/ui/icon'
import { useFieldId } from 'src/components/ui/input'

const MENU_TRIGGER_BASE = cns(
  'flex h-[38px] w-full items-center justify-between rounded-md border',
  'bg-bg-sunk px-3 text-left text-[14px]',
  'transition-[border-color,box-shadow] duration-200 ease-uv',
)

const MENU_TRIGGER_OPEN = 'border-uv shadow-[0_0_0_3px_var(--color-uv-ghost)]'
const MENU_TRIGGER_CLOSED = 'border-line'

const MENU_TRIGGER_CHEVRON = 'h-[13px] w-[13px] shrink-0 text-ink-3'

export type MenuTriggerProps = ComponentPropsWithRef<'button'> & {
  /** What the trigger reads as — in practice the selected option's label. */
  label: ReactNode
  /** Drives the accent ring and the chevron flip. */
  open?: boolean
}

/**
 * The select, drawn as an input-shaped button.
 *
 * Presentational on purpose: `Menu` renders one of these and supplies every
 * ARIA attribute and handler, but the component is exported so a call site
 * that manages its own popup can reuse the shape.
 *
 * Inside a `Field` it adopts the field's id so the label points at it, the
 * same way `Input` does. An explicit `id` always wins.
 */
export function MenuTrigger({
  label,
  open = false,
  className,
  id,
  children,
  ...props
}: MenuTriggerProps): JSX.Element {
  const fieldId = useFieldId()

  return (
    <button
      type="button"
      id={id ?? fieldId}
      {...props}
      className={cns(
        MENU_TRIGGER_BASE,
        open ? MENU_TRIGGER_OPEN : MENU_TRIGGER_CLOSED,
        className,
      )}
    >
      {label}
      {children}
      <Icon
        className={cns(MENU_TRIGGER_CHEVRON, open && 'rotate-180')}
        name="chevron"
      />
    </button>
  )
}

const MENU_PANEL = cns(
  'flex flex-col gap-px rounded-lg border border-line-loud',
  'bg-surface-3 p-1 shadow-lift',
)

/**
 * Deviation from `ui.pug`: the mockup renders the open menu in normal flow
 * (`mt-0.5` under the trigger) because its "sort menu, open" card exists
 * precisely so the popup does not cover the grid it sorts — a documentation
 * constraint, not a design decision. A real menu overlays, so the panel is
 * absolutely positioned against the root and given the same 2px offset.
 */
const MENU_PANEL_POSITION = 'absolute top-full right-0 left-0 z-20 mt-0.5'

type MenuContextValue = {
  value: string | undefined
  onSelect: (value: string) => void
}

const MenuContext = createContext<MenuContextValue | undefined>(undefined)

function useMenuContext(component: string): MenuContextValue {
  const context = useContext(MenuContext)

  if (!context) {
    throw new Error(`<${component}> must be rendered inside a <Menu>`)
  }

  return context
}

const OPTION_SELECTOR =
  '[role="option"]:not([disabled]):not([aria-disabled="true"])'

export type MenuProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'onChange' | 'defaultValue'
> & {
  /** The trigger's label. Callers normally pass the selected option's text. */
  label: ReactNode
  /** The selected option's value. */
  value?: string
  onValueChange?: (value: string) => void
  /** Controlled open state. Omit for an uncontrolled menu. */
  open?: boolean
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Extra classes for the trigger button. */
  triggerClassName?: string
  /** Extra classes for the popup panel. */
  panelClassName?: string
  /** Escape hatch onto the trigger button — `aria-label`, `name`, and so on. */
  triggerProps?: Omit<
    MenuTriggerProps,
    'label' | 'open' | 'aria-expanded' | 'aria-haspopup' | 'aria-controls'
  >
  /** `MenuItem`s. */
  children?: ReactNode
}

/**
 * A styled listbox, not a native `<select>`, so every keyboard affordance a
 * `<select>` gives for free is implemented here:
 *
 * - `ArrowDown`/`ArrowUp` on the closed trigger open the menu; `Enter` and
 *   `Space` do too, as the trigger's native button activation.
 * - Opening moves real DOM focus onto the selected option, or the first one
 *   when nothing is selected. That is the focus model — managed DOM focus
 *   rather than `aria-activedescendant`, so the browser's own focus ring and
 *   `document.activeElement` both tell the truth. Options sit at
 *   `tabIndex={-1}`; the menu is the only thing that ever focuses them.
 * - `ArrowDown`/`ArrowUp` move between options with wrap-around, `Home`/`End`
 *   jump to the ends.
 * - `Enter`/`Space` select (native button activation on the option).
 * - `Escape` closes and returns focus to the trigger, as does selecting.
 * - `Tab` out, or a pointer press outside, closes without stealing focus.
 */
export function Menu({
  label,
  value,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  triggerClassName,
  panelClassName,
  triggerProps,
  className,
  children,
  ...props
}: MenuProps): JSX.Element {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const panelId = useId()
  const generatedTriggerId = useId()
  const fieldId = useFieldId()

  // The panel names itself after the trigger, so the trigger's id has to be
  // known here rather than resolved inside `MenuTrigger`. An enclosing
  // `Field`'s id wins over the generated one so its label still points at the
  // trigger; an explicit `triggerProps.id` wins over both.
  const triggerId = triggerProps?.id ?? fieldId ?? generatedTriggerId

  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) {
        setUncontrolledOpen(next)
      }

      onOpenChange?.(next)
    },
    [openProp, onOpenChange],
  )

  const closeAndReturnFocus = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [setOpen])

  // Opening hands focus to the option the menu is currently sitting on, so
  // the first arrow press moves from somewhere meaningful.
  useEffect(() => {
    if (!open) {
      return
    }

    const panel = panelRef.current

    if (!panel) {
      return
    }

    const options = Array.from(
      panel.querySelectorAll<HTMLElement>(OPTION_SELECTOR),
    )
    const selected = options.find(
      option => option.getAttribute('aria-selected') === 'true',
    )

    ;(selected ?? options[0])?.focus()
  }, [open])

  // A pointer press anywhere else dismisses. `pointerdown` rather than
  // `click` so the menu is gone before the press lands on whatever is under
  // it, and focus is deliberately left where the pointer put it.
  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target

      if (target instanceof Node && rootRef.current?.contains(target)) {
        return
      }

      setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open, setOpen])

  const onSelect = useCallback(
    (next: string) => {
      onValueChange?.(next)
      closeAndReturnFocus()
    },
    [onValueChange, closeAndReturnFocus],
  )

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (open || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
      return
    }

    event.preventDefault()
    setOpen(true)
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeAndReturnFocus()

      return
    }

    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(OPTION_SELECTOR),
    )

    if (options.length === 0) {
      return
    }

    const current = options.findIndex(
      option => option === document.activeElement,
    )
    let next: number

    switch (event.key) {
      case 'ArrowDown':
        next = current < 0 ? 0 : (current + 1) % options.length
        break
      case 'ArrowUp':
        next =
          current < 0
            ? options.length - 1
            : (current - 1 + options.length) % options.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = options.length - 1
        break
      default:
        return
    }

    event.preventDefault()
    options[next]?.focus()
  }

  // Tabbing out of the menu dismisses it. Checked against the root rather
  // than the panel so moving focus back to the trigger does not close it
  // twice over.
  function handleBlur(event: FocusEvent<HTMLDivElement>): void {
    if (!open) {
      return
    }

    const next = event.relatedTarget

    if (next instanceof Node && event.currentTarget.contains(next)) {
      return
    }

    setOpen(false)
  }

  return (
    <MenuContext.Provider value={{ value, onSelect }}>
      <div
        {...props}
        ref={rootRef}
        className={cns('relative', className)}
        onBlur={handleBlur}
      >
        <MenuTrigger
          {...triggerProps}
          ref={triggerRef}
          aria-controls={open ? panelId : undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={triggerClassName}
          id={triggerId}
          label={label}
          open={open}
          onClick={() => setOpen(!open)}
          onKeyDown={handleTriggerKeyDown}
        />
        {open ? (
          <div
            ref={panelRef}
            aria-labelledby={triggerId}
            className={cns(MENU_PANEL, MENU_PANEL_POSITION, panelClassName)}
            id={panelId}
            role="listbox"
            tabIndex={-1}
            onKeyDown={handlePanelKeyDown}
          >
            {children}
          </div>
        ) : null}
      </div>
    </MenuContext.Provider>
  )
}

const MENU_ITEM_BASE = cns(
  'flex h-8 w-full items-center justify-between rounded-xs px-2.5 text-left text-[14px]',
  'transition-colors duration-200 ease-uv',
  // The mockup draws no keyboard state, so focus reuses the pointer
  // highlight: keyboard and mouse land on exactly the same affordance. The
  // outline is deliberately left alone — the theme's base `:focus-visible`
  // rule adds the uv ring on top for anyone who arrived by keyboard, and
  // suppresses it for the click that opened the menu.
  'hover:bg-surface-2 focus:bg-surface-2',
)

const MENU_ITEM_SELECTED = 'bg-uv-ghost font-[550] text-uv-hi'
const MENU_ITEM_IDLE = 'text-ink-2'

const MENU_ITEM_CHECK = 'h-[14px] w-[14px] shrink-0 text-uv-hi'

export type MenuItemProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'value'
> & {
  /** Reported to `Menu`'s `onValueChange` when chosen. */
  value: string
  /** Overrides the selected look, which otherwise tracks `Menu`'s `value`. */
  selected?: boolean
}

/** One option in a `Menu`. */
export function MenuItem({
  value,
  selected: selectedProp,
  className,
  children,
  onClick,
  ...props
}: MenuItemProps): JSX.Element {
  const { value: menuValue, onSelect } = useMenuContext('MenuItem')
  const selected = selectedProp ?? value === menuValue

  return (
    <button
      type="button"
      {...props}
      aria-selected={selected}
      className={cns(
        MENU_ITEM_BASE,
        selected ? MENU_ITEM_SELECTED : MENU_ITEM_IDLE,
        className,
      )}
      role="option"
      tabIndex={-1}
      onClick={event => {
        onClick?.(event)

        if (!event.defaultPrevented) {
          onSelect(value)
        }
      }}
    >
      {children}
      {selected ? <Icon className={MENU_ITEM_CHECK} name="check" /> : null}
    </button>
  )
}
