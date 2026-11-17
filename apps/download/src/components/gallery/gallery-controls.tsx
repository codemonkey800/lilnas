'use client'

import { Button, Input, Note, Tabs } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type {
  DownloadGalleryFacets,
  DownloadType,
} from '@lilnas/utils/download/types'
import { useRouter } from 'next/navigation'
import type { JSX, ReactNode } from 'react'
import { useId, useOptimistic, useRef, useState, useTransition } from 'react'

import {
  AppliedFilterChip,
  FilterFoot,
  FilterGrid,
  FilterGroup,
  FilterPanel,
  FiltersButton,
  FilterScrim,
} from 'src/components/ui/filters'
import { PersonAvatar } from 'src/components/ui/person-avatar'
import { ToggleChip } from 'src/components/ui/toggle-chip'
import { initials } from 'src/lib/format'
import type { GalleryFilters } from 'src/lib/gallery-filters'
import {
  countGalleryFilters,
  EMPTY_GALLERY_FILTERS,
  GALLERY_ALL_TYPES_TAB,
  GALLERY_MIXED_TYPES_TAB,
  GALLERY_TYPE_LABELS,
  GALLERY_TYPE_ORDER,
  galleryFilterChips,
  galleryHref,
  hasGalleryFilters,
  INVALID_RANGE_MESSAGE,
  isInvertedGalleryRange,
} from 'src/lib/gallery-filters'

/**
 * The controls row. `relative` and `z-20` because the filter panel is
 * positioned against it and has to sit above the `z-10` scrim — the two must
 * share a stacking context, which is why neither is nested inside anything
 * transformed.
 *
 * `gallery.pug` draws the tab strip and the Filters button on one line at 1280
 * and on two at 390. That is `flex-wrap` plus a full-width strip below the
 * breakpoint: the strip's `border-b` then spans the whole column the way the
 * mobile frame draws it, and packs to its own content width beside the button
 * the way the desktop frame does.
 */
const CONTROLS_ROW = cns(
  'relative z-20 mb-5 flex flex-col gap-3',
  'sm:flex-row sm:items-end sm:justify-between sm:border-b sm:border-line',
)

const FILTER_PANEL_POSITION = cns(
  'absolute inset-x-0 top-full mt-2',
  'sm:inset-x-auto sm:right-0 sm:mt-0 sm:w-[480px] sm:top-[calc(100%+8px)]',
)

const FACET_COUNT = 'order-last font-mono text-mono-sm text-ink-3'

const TABS: Array<{ label: string; type: DownloadType | null; value: string }> =
  [
    { label: 'All', type: null, value: GALLERY_ALL_TYPES_TAB },
    ...GALLERY_TYPE_ORDER.map(type => ({
      label: GALLERY_TYPE_LABELS[type],
      type,
      value: type as string,
    })),
  ]

/** The count on a tab: the whole library for All, else that type's rows. */
function tabCount(
  facets: DownloadGalleryFacets,
  type: DownloadType | null,
): number {
  return type === null
    ? facets.types.reduce((sum, facet) => sum + facet.count, 0)
    : (facets.types.find(facet => facet.type === type)?.count ?? 0)
}

export type GalleryControlsProps = {
  /**
   * The gallery's filter vocabulary for the current **date window only**.
   *
   * Rendered exactly as it arrives: the counts are the server's, and the
   * uploader list already has the attribution-oracle guard applied to it
   * (`JobQueryService`), so an uploader whose only match is a hidden video is
   * already absent for a non-admin. Recomputing, re-sorting by count or
   * filtering either list on this side would either invent a number or leak
   * one.
   */
  facets: DownloadGalleryFacets
  /** The filters the URL currently describes. */
  filters: GalleryFilters
  /**
   * The backend's complaint about the date range, or `null`. Drives the
   * validation message under the date fields and marks both of them invalid.
   */
  rangeError: string | null
  /**
   * How many rows the current filter matches, or `null` when the range was
   * rejected and there is no answer to count.
   */
  total: number | null
}

/**
 * Everything above the grid: the type tab strip, the Filters popover, and the
 * chips for what is currently applied.
 *
 * All of it is a projection of the URL. Every control pushes a new query string
 * at the router and then re-renders from whatever comes back, so a filtered
 * gallery is a link, the back button steps through filter changes, and there is
 * no second copy of the filter state to drift.
 *
 * ⚠️ The bridge between "the URL is the state" and "a control must respond the
 * instant it is pressed" is `useOptimistic`, not an effect. A checkbox whose
 * `checked` came straight from `props.filters` would visibly stay unchecked
 * until the server answered; syncing a local copy in a `useEffect` is a
 * `react-hooks/set-state-in-effect` error in this package, and the render-phase
 * equivalent is a `react-hooks/set-state-in-render` error. `useOptimistic` is
 * built for exactly this shape: it shows `next` for as long as the navigation
 * transition is pending and then hands back to the prop, with nothing to unwind
 * when the navigation is interrupted or the user presses Back.
 *
 * ⚠️ Deliberately no "Search the library…" field, which both of `gallery.pug`'s
 * frames draw beside the tab strip. `GET /download/gallery` has no text
 * parameter — `GalleryQuerySchema` is cursor/from/limit/requester/to/type — so
 * the field could not filter this grid, and the nav bar's own field (live on
 * this route) is the app's single entry point for both searching a title and
 * pasting a link. Two fields, one of them inert, is worse than one.
 */
export function GalleryControls({
  facets,
  filters,
  rangeError,
  total,
}: GalleryControlsProps): JSX.Element {
  const router = useRouter()
  const rangeErrorId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [applied, setApplied] = useOptimistic(filters)
  const [, startTransition] = useTransition()

  function apply(next: GalleryFilters): void {
    startTransition(() => {
      setApplied(next)
      // `scroll: false` — a filter change replaces the grid in place, and
      // yanking the viewport to the top of a page the user is already at the
      // top of is only ever felt as a jolt when they are not.
      router.push(galleryHref(next), { scroll: false })
    })
  }

  function selectTab(value: string): void {
    const tab = TABS.find(entry => entry.value === value)

    apply({ ...applied, types: tab?.type ? [tab.type] : [] })
  }

  function toggleType(type: DownloadType, checked: boolean): void {
    apply({
      ...applied,
      // Rebuilt from the canonical order rather than appended to, so
      // `?type=show,video` and `?type=video,show` can never both exist.
      types: checked
        ? GALLERY_TYPE_ORDER.filter(
            other => other === type || applied.types.includes(other),
          )
        : applied.types.filter(other => other !== type),
    })
  }

  const chips = galleryFilterChips(applied)
  const anyApplied = hasGalleryFilters(applied)
  // The API's complaint is authoritative, but it only arrives after a round
  // trip. The local check marks the fields invalid the moment the second date
  // is picked, so the message and `aria-invalid` appear together and say the
  // same thing either way.
  const invalidRange = rangeError !== null || isInvertedGalleryRange(applied)

  const tabValue =
    applied.types.length === 1
      ? (applied.types[0] ?? GALLERY_ALL_TYPES_TAB)
      : applied.types.length === 0
        ? GALLERY_ALL_TYPES_TAB
        : GALLERY_MIXED_TYPES_TAB

  return (
    <>
      <div className={CONTROLS_ROW}>
        <Tabs.Root
          className="min-w-0 sm:w-auto"
          onValueChange={selectTab}
          value={tabValue}
        >
          <Tabs.List
            activationMode="manual"
            aria-label="Media type"
            className="sm:border-b-0"
            scroll
            // A two-type selection is reachable from the panel and from a
            // shared link, and no single tab can report it — so none of them
            // is selected, and the roving `tabIndex` would leave the whole
            // strip out of the tab order. The strip itself takes the stop
            // instead: an arrow key from there lands on a tab exactly as it
            // does from a selected one.
            tabIndex={tabValue === GALLERY_MIXED_TYPES_TAB ? 0 : undefined}
          >
            {TABS.map(tab => (
              <Tabs.Tab
                count={tabCount(facets, tab.type)}
                key={tab.value}
                value={tab.value}
              >
                {tab.label}
              </Tabs.Tab>
            ))}
            <Tabs.Indicator />
          </Tabs.List>
        </Tabs.Root>
        <div className="self-end sm:mb-2">
          <FiltersButton
            count={countGalleryFilters(applied)}
            onClick={() => setOpen(!open)}
            open={open}
            ref={triggerRef}
          />
        </div>
        <FilterPanel
          className={FILTER_PANEL_POSITION}
          onOpenChange={setOpen}
          open={open}
          triggerRef={triggerRef}
        >
          <FilterGrid>
            <FilterGroup label="Date added" wide>
              <div className="flex items-center gap-2">
                <Input
                  aria-describedby={invalidRange ? rangeErrorId : undefined}
                  aria-invalid={invalidRange || undefined}
                  aria-label="Start date"
                  className="min-w-0 flex-1"
                  mono
                  onChange={event =>
                    apply({ ...applied, from: event.target.value || null })
                  }
                  type="date"
                  value={applied.from ?? ''}
                />
                <span aria-hidden="true" className="text-ink-3">
                  –
                </span>
                <Input
                  aria-describedby={invalidRange ? rangeErrorId : undefined}
                  aria-invalid={invalidRange || undefined}
                  aria-label="End date"
                  className="min-w-0 flex-1"
                  mono
                  onChange={event =>
                    apply({ ...applied, to: event.target.value || null })
                  }
                  type="date"
                  value={applied.to ?? ''}
                />
              </div>
              {invalidRange ? (
                <Note
                  id={rangeErrorId}
                  lead={rangeError ?? INVALID_RANGE_MESSAGE}
                  tone="bad"
                >
                  Swap them and the results will come back.
                </Note>
              ) : null}
            </FilterGroup>
            <FilterGroup label="Media type" wide>
              <div className="flex flex-wrap gap-2">
                {GALLERY_TYPE_ORDER.map(type => {
                  const facet = facets.types.find(entry => entry.type === type)

                  return facet ? (
                    <ToggleChip
                      checked={applied.types.includes(type)}
                      key={type}
                      label={
                        <FacetLabel
                          count={facet.count}
                          name={GALLERY_TYPE_LABELS[type]}
                        />
                      }
                      onCheckedChange={checked => toggleType(type, checked)}
                    />
                  ) : null
                })}
              </div>
            </FilterGroup>
            <FilterGroup label="Uploaded by" wide>
              <div className="flex flex-wrap gap-2">
                {facets.uploaders.map(uploader => (
                  <ToggleChip
                    checked={applied.requester === uploader.email}
                    key={uploader.email}
                    label={
                      <FacetLabel
                        count={uploader.count}
                        name={uploader.email}
                      />
                    }
                    onCheckedChange={checked =>
                      apply({
                        ...applied,
                        requester: checked ? uploader.email : null,
                      })
                    }
                  >
                    <PersonAvatar
                      aria-hidden="true"
                      initials={initials(uploader.email)}
                      size="xs"
                    />
                  </ToggleChip>
                ))}
              </div>
            </FilterGroup>
          </FilterGrid>
          <FilterFoot>
            {/*
              `aria-disabled`, not `disabled`: pressing this is what empties the
              filters, which is what turns it off — under the pointer, or under
              the keyboard focus that just pressed it. A real `disabled` would
              drop it out of the focus order at that exact moment and strand a
              keyboard user on `<body>` with the panel still open. `Button`
              swallows `onClick` while it is set, so it cannot fire twice.
            */}
            <Button
              aria-disabled={!anyApplied}
              onClick={() => apply(EMPTY_GALLERY_FILTERS)}
              size="sm"
              variant="ghost"
            >
              Clear all
            </Button>
            <Button onClick={() => setOpen(false)} size="sm" variant="accent">
              {resultsLabel(total)}
            </Button>
          </FilterFoot>
        </FilterPanel>
      </div>
      {chips.length > 0 ? (
        <div
          aria-label="Active filters"
          className="mb-5 flex flex-wrap items-center gap-2"
          role="group"
        >
          {chips.map(chip => (
            <AppliedFilterChip
              key={chip.key}
              label={chip.label}
              onRemove={() => apply(chip.next)}
              removeLabel={chip.removeLabel}
            />
          ))}
          <Button
            onClick={() => apply(EMPTY_GALLERY_FILTERS)}
            size="sm"
            variant="ghost"
          >
            Clear all
          </Button>
        </div>
      ) : null}
      {open ? <FilterScrim /> : null}
    </>
  )
}

/** `Show 128 results`, or no count to show when the range was rejected. */
function resultsLabel(total: number | null): string {
  if (total === null) {
    return 'Close'
  }

  return `Show ${total} ${total === 1 ? 'result' : 'results'}`
}

type FacetLabelProps = {
  count: number
  name: ReactNode
}

/**
 * A facet's name and the server's count for it, deliberately part of the
 * checkbox's accessible name — "Movies 12" is the whole fact, and a count
 * rendered as decoration beside it would be invisible to anyone not looking at
 * the screen.
 */
function FacetLabel({ count, name }: FacetLabelProps): JSX.Element {
  return (
    <>
      {name} <span className={FACET_COUNT}>{count}</span>
    </>
  )
}
