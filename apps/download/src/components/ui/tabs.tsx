'use client'

import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX, KeyboardEvent } from 'react'
import { createContext, useContext } from 'react'

type TabsContextValue = {
  value: string
  onValueChange: (value: string) => void
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined)

function useTabsContext(component: string): TabsContextValue {
  const context = useContext(TabsContext)

  if (!context) {
    throw new Error(`<${component}> must be rendered inside a <Tabs>`)
  }

  return context
}

/** The tab's own value, read back off the DOM during keyboard navigation. */
const TAB_VALUE_ATTRIBUTE = 'data-value'

const TABS_BASE = 'border-b border-line'

/**
 * `stretch` is `grid-cols-3` verbatim from `ui.pug` — the stretched strip in
 * the mockups always holds exactly three tabs.
 */
const TABS_LAYOUT_STRETCH = 'grid grid-cols-3'
const TABS_LAYOUT_INLINE = 'flex gap-[22px]'

export type TabsProps = Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> & {
  /** The selected tab's value. `Tabs` is always controlled. */
  value: string
  onValueChange: (value: string) => void
  /** Split the width evenly across three tabs instead of packing them left. */
  stretch?: boolean
  /** Let the strip scroll sideways rather than wrap, as the season strip does. */
  scroll?: boolean
  /**
   * `'automatic'` (APG automatic activation, the default): arrow keys move
   * focus and select in one step. `'manual'`: arrow keys only move focus;
   * activating a tab needs Enter/Space (or a click). Use `'manual'` when
   * selecting a tab carries a real cost — APG's own example is a tab that
   * triggers a network fetch, which is exactly what a strip wired to
   * `router.push` does.
   */
  activationMode?: 'automatic' | 'manual'
}

/**
 * A tab strip.
 *
 * Deviation from `ui.pug`: the `tabs` mixin sets `role="tab"` on each tab but
 * never gives the container `role="tablist"`, which leaves the tabs orphaned
 * — assistive technology needs the owning list to report position ("tab 2 of
 * 4") and to treat the group as one stop. The container carries it here.
 *
 * Arrow keys move between tabs with wrap-around, Home/End jump to the ends.
 * By default selection follows focus (APG's automatic activation), because
 * most tab strips in this app swap already-loaded content. A strip that
 * activates a tab by navigating instead should pass `activationMode="manual"`
 * — arrow keys then only move focus, and activating needs Enter/Space or a
 * click. Focus roves: only the selected tab is in the tab order.
 */
export function Tabs({
  value,
  onValueChange,
  stretch = false,
  scroll = false,
  activationMode = 'automatic',
  className,
  children,
  onKeyDown,
  ...props
}: TabsProps): JSX.Element {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    onKeyDown?.(event)

    if (event.defaultPrevented) {
      return
    }

    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        '[role="tab"]:not([disabled]):not([aria-disabled="true"])',
      ),
    )

    if (tabs.length === 0) {
      return
    }

    const current = tabs.findIndex(tab => tab === document.activeElement)
    let next: number

    switch (event.key) {
      case 'ArrowRight':
        next = current < 0 ? 0 : (current + 1) % tabs.length
        break
      case 'ArrowLeft':
        next =
          current < 0
            ? tabs.length - 1
            : (current - 1 + tabs.length) % tabs.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = tabs.length - 1
        break
      default:
        return
    }

    event.preventDefault()

    const target = tabs[next]

    if (!target) {
      return
    }

    const targetValue = target.getAttribute(TAB_VALUE_ATTRIBUTE)

    target.focus()

    if (
      activationMode === 'automatic' &&
      targetValue !== null &&
      targetValue !== value
    ) {
      onValueChange(targetValue)
    }
  }

  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div
        role="tablist"
        {...props}
        className={cns(
          TABS_BASE,
          stretch ? TABS_LAYOUT_STRETCH : TABS_LAYOUT_INLINE,
          scroll && 'overflow-x-auto',
          className,
        )}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </TabsContext.Provider>
  )
}

const TAB_BASE = cns(
  'relative px-px py-[9px] text-[14px] font-[550] whitespace-nowrap',
  'transition-colors duration-200 ease-uv',
)

const TAB_SELECTED = cns(
  'text-ink',
  "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-sm after:bg-uv after:content-['']",
)

const TAB_IDLE = 'text-ink-3 hover:text-ink-2'

export type TabProps = Omit<ComponentPropsWithoutRef<'button'>, 'value'> & {
  /** Identifies the tab to `Tabs`. */
  value: string
}

/** One tab in a `Tabs` strip. Selection is derived from the strip's `value`. */
export function Tab({
  value,
  className,
  children,
  onClick,
  ...props
}: TabProps): JSX.Element {
  const { value: selectedValue, onValueChange } = useTabsContext('Tab')
  const selected = value === selectedValue

  return (
    <button
      type="button"
      {...props}
      role="tab"
      aria-selected={selected}
      className={cns(TAB_BASE, selected ? TAB_SELECTED : TAB_IDLE, className)}
      data-value={value}
      tabIndex={selected ? 0 : -1}
      onClick={event => {
        onClick?.(event)

        if (!event.defaultPrevented) {
          onValueChange(value)
        }
      }}
    >
      {children}
    </button>
  )
}
