'use client'

import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'
import { Fragment } from 'react'

export type BreadcrumbItem = { label: string; href?: string }

export type BreadcrumbProps = Omit<
  ComponentPropsWithoutRef<'nav'>,
  'children'
> & {
  items: BreadcrumbItem[]
}

/**
 * Where you are. The last item is the current page: plain text, never a link,
 * marked `aria-current="page"`.
 */
export function Breadcrumb({
  items,
  className,
  ...props
}: BreadcrumbProps): JSX.Element {
  return (
    <nav aria-label="Breadcrumb" {...props} className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-3">
        {items.map((item, i) => {
          const current = i === items.length - 1

          return (
            <Fragment key={`${item.label}-${i}`}>
              {i > 0 ? (
                <li aria-hidden="true" className="text-ink-4">
                  /
                </li>
              ) : null}
              <li>
                {current ? (
                  <span aria-current="page" className="font-medium text-ink">
                    {item.label}
                  </span>
                ) : item.href ? (
                  <a
                    className="transition-colors duration-200 ease-standard hover:text-ink"
                    href={item.href}
                  >
                    {item.label}
                  </a>
                ) : (
                  <span>{item.label}</span>
                )}
              </li>
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

/** Page numbers to show: the ends, the current page and its neighbours. */
function pageWindow(page: number, pageCount: number): (number | 'gap')[] {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1])
  const pages = [...wanted]
    .filter(p => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b)

  const out: (number | 'gap')[] = []
  let prev = 0
  for (const p of pages) {
    if (prev && p - prev > 1) {
      out.push('gap')
    }
    out.push(p)
    prev = p
  }

  return out
}

const PAGE_BUTTON = cns(
  'flex size-8 items-center justify-center rounded-md border border-line',
  'text-sm text-ink-2 tabular-nums transition-press pointer-coarse:size-11',
  'hover:border-line-loud hover:bg-surface-2',
  'disabled:pointer-events-none disabled:opacity-40',
)

export type PaginationProps = Omit<
  ComponentPropsWithoutRef<'nav'>,
  'children'
> & {
  /** Current page, 1-based. */
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  /** Accessible name of the `nav`. */
  label?: string
}

/** Previous / next with a window of numbered pages between them. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  label = 'Pagination',
  className,
  ...props
}: PaginationProps): JSX.Element {
  const current = Math.min(Math.max(1, page), Math.max(1, pageCount))

  return (
    <nav aria-label={label} {...props} className={className}>
      <ul className="flex items-center gap-1">
        <li>
          <button
            aria-label="Previous page"
            className={PAGE_BUTTON}
            disabled={current <= 1}
            onClick={() => onPageChange(current - 1)}
            type="button"
          >
            ‹
          </button>
        </li>
        {pageWindow(current, pageCount).map((p, i) => (
          <li key={p === 'gap' ? `gap-${i}` : p}>
            {p === 'gap' ? (
              <span aria-hidden="true" className="px-1 text-ink-4">
                …
              </span>
            ) : (
              <button
                aria-current={p === current ? 'page' : undefined}
                aria-label={`Page ${p}`}
                className={cns(
                  PAGE_BUTTON,
                  p === current &&
                    'border-accent bg-accent text-accent-ink hover:border-accent-hi hover:bg-accent-hi',
                )}
                onClick={() => onPageChange(p)}
                type="button"
              >
                {p}
              </button>
            )}
          </li>
        ))}
        <li>
          <button
            aria-label="Next page"
            className={PAGE_BUTTON}
            disabled={current >= pageCount}
            onClick={() => onPageChange(current + 1)}
            type="button"
          >
            ›
          </button>
        </li>
      </ul>
    </nav>
  )
}

/** Inline key or code in running text. */
export function Kbd({
  className,
  ...props
}: ComponentPropsWithoutRef<'code'>): JSX.Element {
  return (
    <code
      {...props}
      className={cns(
        'rounded-xs bg-surface-3 px-[5px] py-px font-mono text-[0.92em] text-ink',
        className,
      )}
    />
  )
}
