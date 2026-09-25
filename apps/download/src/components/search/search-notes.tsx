import { cns } from '@lilnas/utils/cns'
import type { DiscoverySource } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { Note } from 'src/components/ui/card'

/**
 * `search.pug:320`'s loud override. `Note` has no `tone` prop — `ui.pug` gives
 * it exactly one appearance — so the two mockup screens that need a louder one
 * override it from the call site with `!` utilities. The icon is a direct child
 * `<svg>`, which is what lets the `[&>svg]:` selector reach it.
 */
const LOUD_NOTE = 'border-bad/35! bg-bad-ghost! [&>svg]:text-bad!'

/** Which service stands behind each discovery source. */
const SOURCE_SERVICE: Record<DiscoverySource, string> = {
  movies: 'Radarr',
  shows: 'Sonarr',
}

/** What is left when the other source is the one that failed. */
const SOURCE_CONTENT: Record<DiscoverySource, string> = {
  movies: 'movies',
  shows: 'shows',
}

const ALL_SOURCES: readonly DiscoverySource[] = ['movies', 'shows']

export type DegradedSourcesNoteProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  /**
   * The sources that **failed**. An empty array is the explicit all-good
   * signal — not an absence of information — so this renders nothing for it.
   */
  degradedSources: DiscoverySource[]
}

/**
 * "One of the two upstreams didn't answer, and you are looking at half a
 * result set."
 *
 * This is the one genuinely loud note on the page: a missing upstream means
 * the count above it is wrong in a way the user cannot see, which is exactly
 * what `bad` is for. (No matches, by contrast, is a true and complete answer,
 * and gets the plain note below.)
 */
export function DegradedSourcesNote({
  degradedSources,
  className,
  ...props
}: DegradedSourcesNoteProps): JSX.Element | null {
  if (degradedSources.length === 0) {
    return null
  }

  const [survivor] = ALL_SOURCES.filter(
    source => !degradedSources.includes(source),
  )
  const failed = degradedSources
    .map(source => SOURCE_SERVICE[source])
    .join(' and ')

  return (
    <Note {...props} className={cns(LOUD_NOTE, className)} role="status">
      {survivor === undefined ? (
        <>
          <b className="text-ink">These results are incomplete.</b> Neither{' '}
          {failed} answered, so nothing could be searched. Try again shortly.
        </>
      ) : (
        <>
          <b className="text-ink">Showing {SOURCE_CONTENT[survivor]} only.</b>{' '}
          {failed} didn&apos;t answer, so these results come from{' '}
          {SOURCE_SERVICE[survivor]} alone. Try again shortly for the full set.
        </>
      )}
    </Note>
  )
}

export type NoMatchesNoteProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  query: string
}

/**
 * Nothing matched — a plain outcome, not a failure.
 *
 * ## Deviation from `search.pug`
 *
 * The mockup draws this with the same loud `bad` override
 * {@link DegradedSourcesNote} uses. It is kept plain here deliberately: the
 * query was valid, both upstreams answered, and the honest answer was zero.
 * Painting that red tells the user they did something wrong, and reserves no
 * colour for the case where something actually broke.
 */
export function NoMatchesNote({
  query,
  className,
  ...props
}: NoMatchesNoteProps): JSX.Element {
  return (
    <Note {...props} className={cns('reveal', className)} role="status">
      <b className="text-ink">{`No matches for “${query}.”`}</b> Double-check
      the spelling, or try browsing the{' '}
      <a className="text-ink underline" href="/gallery">
        gallery
      </a>{' '}
      instead.
    </Note>
  )
}

export type ShortQueryNoteProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
>

/**
 * One character in the field. `DiscoverQuerySchema` requires `min(2)` and
 * answers `400 too_small` below it, so the page says so rather than asking.
 */
export function ShortQueryNote({
  className,
  ...props
}: ShortQueryNoteProps): JSX.Element {
  return (
    <Note {...props} className={className} icon="search" role="status">
      Keep typing — a search needs at least two characters.
    </Note>
  )
}
