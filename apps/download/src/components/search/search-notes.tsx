import { Icon, Note } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { DiscoverySource } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

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
    <Note
      {...props}
      className={className}
      icon={<Icon name="alert" />}
      lead={
        survivor === undefined
          ? 'These results are incomplete.'
          : `Showing ${SOURCE_CONTENT[survivor]} only.`
      }
      tone="warn"
    >
      {survivor === undefined ? (
        <>
          Neither {failed} answered, so nothing could be searched. Try again
          shortly.
        </>
      ) : (
        <>
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
    <Note
      {...props}
      className={cns('animate-rise', className)}
      lead={`No matches for “${query}.”`}
    >
      Double-check the spelling, or try browsing the{' '}
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
    <Note
      {...props}
      className={cns('animate-rise', className)}
      icon={<Icon name="search" />}
      lead="Keep typing."
    >
      A search needs at least two characters.
    </Note>
  )
}
