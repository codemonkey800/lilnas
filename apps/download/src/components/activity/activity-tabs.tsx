'use client'

import type { JSX } from 'react'
import { useOptimistic, useTransition } from 'react'

import { Tab, Tabs } from 'src/components/ui/tabs'
import type { ActivityFilters } from 'src/lib/activity-filters'
import {
  ACTIVITY_ALL_TYPES_TAB,
  ACTIVITY_MIXED_TYPES_TAB,
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_ORDER,
  activityFiltersForTab,
  activityHref,
  activityTabValue,
} from 'src/lib/activity-filters'

/**
 * The four tabs, left to right. Each carries its own value rather than the
 * handler casting a tab's string back into a `DownloadType`: `all` is a real tab
 * value and is not a member of the enum, so the cast would be the only thing
 * standing between a typo and a filter nobody can clear.
 */
const TABS: Array<{ label: string; value: string }> = [
  { label: 'All', value: ACTIVITY_ALL_TYPES_TAB },
  ...ACTIVITY_TYPE_ORDER.map(type => ({
    label: ACTIVITY_TYPE_LABELS[type],
    value: type as string,
  })),
]

export type ActivityTabsProps = {
  /** The filter the URL currently describes. */
  filters: ActivityFilters
  /** Pushes the new address. Injected so the feed can own the transition. */
  onNavigate: (href: string) => void
}

/**
 * The type filter, as a tab strip.
 *
 * All of it is a projection of the URL: the strip pushes a new query string at
 * the router and then re-renders from whatever comes back, so a filtered feed is
 * a link and the back button steps through filter changes. There is no second
 * copy of the filter state to drift.
 *
 * ⚠️ The bridge between "the URL is the state" and "a tab must respond the
 * instant it is pressed" is `useOptimistic`, not an effect. A strip whose
 * selection came straight from `props.filters` would visibly stay on the old tab
 * until the server answered; syncing a local copy in a `useEffect` is a
 * `react-hooks/set-state-in-effect` error in this package, and the render-phase
 * equivalent is a `react-hooks/set-state-in-render` error.
 *
 * ⚠️ `Tabs` is `activationMode="manual"` here, not the default automatic:
 * activating a tab pushes a route and fetches, so arrowing through the strip
 * must not fire a push per key. Selecting still needs Enter/Space or a click,
 * same as `GalleryControls`, which makes the same trade for the same reason.
 */
export function ActivityTabs({
  filters,
  onNavigate,
}: ActivityTabsProps): JSX.Element {
  const [applied, setApplied] = useOptimistic(filters)
  const [, startTransition] = useTransition()

  function selectTab(value: string): void {
    const next = activityFiltersForTab(value)

    startTransition(() => {
      setApplied(next)
      onNavigate(activityHref(next))
    })
  }

  const value = activityTabValue(applied)

  return (
    <Tabs
      activationMode="manual"
      aria-label="Media type"
      className="w-full sm:w-auto"
      onValueChange={selectTab}
      // A two-type selection is reachable from a shared link and no single tab
      // can report it, so none is selected — and `Tab`'s roving `tabIndex`
      // would then leave the whole strip out of the tab order. The strip takes
      // the stop instead; an arrow key from there lands on a tab exactly as it
      // does from a selected one.
      tabIndex={value === ACTIVITY_MIXED_TYPES_TAB ? 0 : undefined}
      value={value}
    >
      {TABS.map(tab => (
        <Tab key={tab.value} value={tab.value}>
          {tab.label}
        </Tab>
      ))}
    </Tabs>
  )
}
