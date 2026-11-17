import { Button } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'
import { useId } from 'react'

/**
 * The reference cards the movie, show and video pages draw under their
 * headers - a heading over label/value rows - and the helpers every one of
 * them builds its rows with.
 */

export const FACT_SEPARATOR = ' · '

/** The present parts joined by {@link FACT_SEPARATOR}, or `null` for none. */
export function joinFacts(
  parts: readonly (string | null | undefined)[],
): string | null {
  const present = parts.filter((part): part is string => Boolean(part))
  return present.length > 0 ? present.join(FACT_SEPARATOR) : null
}

/**
 * Upstream dates are midnight UTC (`2012-09-20T00:00:00Z`) or a bare day
 * (`2012-09-20`, which `Date` also reads as UTC midnight), so they are read in
 * UTC - in a timezone behind it, local time would print the day before. The
 * locale is pinned for the same reason the zone is: this renders on the server
 * and again in the browser, and the two have to agree.
 */
const DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
})

/** `2012-09-20T00:00:00Z` -> `Sep 20, 2012`, or `null` for anything unparseable. */
export function formatDay(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : DAY_FORMAT.format(date)
}

/** One `<dt>`/`<dd>` pair. A row with nothing to say is not drawn. */
export type Fact = { label: string; mono?: boolean; value: ReactNode }

export function facts(rows: readonly (Fact | null)[]): Fact[] {
  return rows.filter((row): row is Fact => row !== null)
}

export function fact(
  label: string,
  value: ReactNode | null | undefined,
  mono = false,
): Fact | null {
  return value === null || value === undefined || value === ''
    ? null
    : mono
      ? { label, mono, value }
      : { label, value }
}

/**
 * Short facts as a wrapping run in which no single one splits across lines -
 * `Trakt` at the end of one line and `7.6` at the start of the next reads as
 * two facts.
 */
export function FactRun({ parts }: { parts: readonly string[] }): JSX.Element {
  return (
    <>
      {parts.map((part, index) => (
        <span key={part}>
          {index > 0 ? FACT_SEPARATOR : null}
          <span className={cns('whitespace-nowrap')}>{part}</span>
        </span>
      ))}
    </>
  )
}

type FactSectionProps = Omit<
  ComponentPropsWithoutRef<'section'>,
  'children'
> & {
  facts: readonly Fact[]
  heading: string
}

/**
 * A heading over a `dl` grid - two columns on a phone, four from `sm`, as
 * `facts` in `download.pug`. Labels are the uppercase `label` caption, values
 * are Geist; a `mono` fact is an identifier someone would copy (a path, a
 * release name) and is set in Geist Mono. Long values wrap rather than
 * truncate, since these are real upstream strings.
 */
export function FactSection({
  className,
  facts: rows,
  heading,
  ...props
}: FactSectionProps): JSX.Element {
  const headingId = useId()

  return (
    <section
      {...props}
      aria-labelledby={headingId}
      className={cns('min-w-0', className)}
    >
      <h2 className={cns('mb-3 text-h2')} id={headingId}>
        {heading}
      </h2>
      <dl className={cns('grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4')}>
        {rows.map(row => (
          <div className={cns('min-w-0')} key={row.label}>
            <dt className={cns('text-label text-ink-3 uppercase')}>
              {row.label}
            </dt>
            <dd
              className={cns(
                'text-sm break-words text-ink',
                row.mono && 'font-mono text-mono',
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export type FactCardsProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  sections: readonly { facts: readonly Fact[]; heading: string }[]
}

/**
 * Every section that has rows, stacked, each its own heading over a `dl`.
 * `null` when none has anything to say, so the page adds no gap.
 */
export function FactCards({
  className,
  sections,
  ...props
}: FactCardsProps): JSX.Element | null {
  const drawn = sections.filter(section => section.facts.length > 0)

  if (drawn.length === 0) {
    return null
  }

  return (
    <div {...props} className={cns('flex flex-col gap-8', className)}>
      {drawn.map(section => (
        <FactSection
          facts={section.facts}
          heading={section.heading}
          key={section.heading}
        />
      ))}
    </div>
  )
}

/** A page elsewhere. Build one only from a checked id or URL. */
export type ExternalLink = { href: string; label: string }

/**
 * An upstream URL as something safe to put in an `href`, or `null`. The
 * protocol check is the security half rather than a tidiness one: a
 * `javascript:` or `data:` value in an `href` is script the user runs by
 * clicking what looks like an ordinary link.
 */
export function httpHref(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  let url: URL

  try {
    url = new URL(value)
  } catch {
    return null
  }

  return url.protocol === 'http:' || url.protocol === 'https:'
    ? url.toString()
    : null
}

export const IMDB_LABEL = 'IMDb'

/** `tt` and digits - anything else is not an IMDb title id. */
const IMDB_ID = /^tt\d+$/

/**
 * The title's IMDb page, or `null` for an id that is not one. Checked because
 * it lands in an `href` and came from an upstream this app does not own.
 */
export function imdbLink(imdbId: string | undefined): ExternalLink | null {
  return imdbId && IMDB_ID.test(imdbId)
    ? { href: `https://www.imdb.com/title/${imdbId}/`, label: IMDB_LABEL }
    : null
}

export type ExternalLinksProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  links: readonly ExternalLink[]
}

/**
 * A row of quiet external links for a header's `links` slot - the video
 * page's "View original post" treatment, several abreast. The negative margin
 * cancels the first link's padding so its label lines up with the synopsis
 * above it. `null` for no links.
 */
export function ExternalLinks({
  className,
  links,
  ...props
}: ExternalLinksProps): JSX.Element | null {
  if (links.length === 0) {
    return null
  }

  return (
    <div
      {...props}
      className={cns('-ml-[11px] flex flex-wrap items-center gap-1', className)}
    >
      {links.map(link => (
        <Button
          icon="external"
          key={link.label}
          size="sm"
          variant="ghost"
          render={<a href={link.href} rel="noreferrer" target="_blank" />}
        >
          {link.label}
        </Button>
      ))}
    </div>
  )
}
