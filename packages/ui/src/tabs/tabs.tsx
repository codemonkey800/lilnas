'use client'

import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { cns } from '@lilnas/utils/cns'
import type { ComponentProps, JSX } from 'react'

export type TabsListProps = ComponentProps<typeof BaseTabs.List> & {
  /**
   * `'automatic'` (the default): arrow keys move focus and select in one
   * step. `'manual'`: arrow keys only move focus; Enter/Space (or a click)
   * activates. Use manual when selecting a tab is expensive — a strip wired to
   * `router.push`, say.
   */
  activationMode?: 'automatic' | 'manual'
  /** Share the width evenly across the tabs instead of packing them left. */
  stretch?: boolean
  /** Scroll sideways rather than wrap. */
  scroll?: boolean
}

function List({
  activationMode = 'automatic',
  stretch = false,
  scroll = false,
  className,
  children,
  ...props
}: TabsListProps): JSX.Element {
  return (
    <BaseTabs.List
      activateOnFocus={activationMode === 'automatic'}
      {...props}
      className={cns(
        'relative border-b border-line',
        stretch ? 'grid auto-cols-fr grid-flow-col' : 'flex gap-1',
        scroll && 'overflow-x-auto',
        className,
      )}
    >
      {children}
    </BaseTabs.List>
  )
}

export type TabProps = ComponentProps<typeof BaseTabs.Tab> & {
  /** A small mono pill after the label. */
  count?: number
}

function Tab({ count, className, children, ...props }: TabProps): JSX.Element {
  return (
    <BaseTabs.Tab
      {...props}
      className={cns(
        'inline-flex h-10 items-center justify-center gap-2 px-3.5 text-body font-medium whitespace-nowrap text-ink-3',
        'transition-colors duration-200 ease-standard hover:text-ink data-active:text-ink',
        'pointer-coarse:min-h-11',
        className,
      )}
    >
      {children}
      {count != null && (
        <span className="rounded-full bg-surface-2 px-1.5 font-mono text-[11px] text-ink">
          {count}
        </span>
      )}
    </BaseTabs.Tab>
  )
}

/** The underline: slides to the active tab via Base UI's `--active-tab-*`. */
function Indicator({
  className,
  ...props
}: ComponentProps<typeof BaseTabs.Indicator>): JSX.Element {
  return (
    <BaseTabs.Indicator
      {...props}
      className={cns(
        'pointer-events-none absolute bottom-[-1px] left-(--active-tab-left) h-0.5 w-(--active-tab-width) rounded-sm bg-accent',
        'transition-[left,width] duration-200 ease-standard',
        className,
      )}
    />
  )
}

export const Tabs = {
  Root: BaseTabs.Root,
  List,
  Tab,
  Panel: BaseTabs.Panel,
  Indicator,
}
