import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'
import { useId } from 'react'

import { CastPerson } from 'src/components/ui/person-avatar'

/**
 * One credited name.
 *
 * The movie page fills this from `MediaDetailResponse.credits.cast` - Radarr's
 * credit list, detail route only. Shows still pass `[]`: nothing on the wire
 * carries a series' cast yet, and `CastRow` renders nothing for an empty list.
 *
 * `initials` is optional because a page always has a name to derive them from
 * - see {@link castInitials}. It stays overridable for a name whose initials
 * are not the first letters of its first two words.
 */
export type CastMember = {
  /** The part played, drawn under the name. */
  character?: string
  /** A headshot, drawn over the initials. */
  imageUrl?: string
  initials?: string
  name: string
}

export const CAST_HEADING = 'Cast'

/**
 * How many names are drawn before the rest collapse into a count. Four, from
 * `movie-detail.pug`'s cast-overflow appendix ("past the fourth credited
 * actor, names collapse into a count").
 */
export const CAST_VISIBLE_LIMIT = 4

/** Runs of whitespace - the separator a person's name uses. */
const NAME_SEPARATORS = /\s+/

/**
 * Two upper-case characters for a credited name: `'Jodie Foster'` -> `'JF'`,
 * `'Cher'` -> `'CH'`.
 *
 * Deliberately *not* `src/lib/format`'s `initials()`, which splits an email's
 * local part on `.`/`_`/`-`/`+` and would read `'Jodie Foster'` as one word and
 * return `'JO'`.
 */
export function castInitials(name: string): string {
  const words = name.trim().split(NAME_SEPARATORS).filter(Boolean)

  const [first, second] = words
  if (first === undefined) {
    return '?'
  }

  // `slice` rather than `[0]`: under `noUncheckedIndexedAccess` an index read
  // is `string | undefined`, and `slice` on a known-non-empty string is the
  // same character without the assertion.
  const letters =
    second === undefined
      ? first.slice(0, 2)
      : `${first.slice(0, 1)}${second.slice(0, 1)}`

  return letters.toUpperCase()
}

export type CastRowProps = Omit<
  ComponentPropsWithoutRef<'section'>,
  'children'
> & {
  /** How many names to draw before the count. Defaults to {@link CAST_VISIBLE_LIMIT}. */
  limit?: number
  /** In credited order. An empty list renders nothing at all. */
  people: readonly CastMember[]
}

/**
 * The Cast section - a heading over a sideways-scrolling row of portraits, then
 * `+6 more` for the rest. `castRow` in `download.pug`.
 *
 * The overflow marker is the word rather than a bare `+6` circle, with the
 * remaining names in a `title`: a hover-only tooltip is invisible on a touch
 * device. `limit` bounds the row, so the scroll is only ever a narrow phone's.
 *
 * Returns `null` for an empty cast rather than an empty section, so a page can
 * render it unconditionally without leaving a gap or a heading over nothing
 * (which, today, is every show - see {@link CastMember}).
 */
export function CastRow({
  className,
  limit = CAST_VISIBLE_LIMIT,
  people,
  ...props
}: CastRowProps): JSX.Element | null {
  const headingId = useId()

  if (people.length === 0) {
    return null
  }

  const shown = people.slice(0, Math.max(0, limit))
  const overflow = people.slice(shown.length)

  return (
    <section
      {...props}
      aria-labelledby={headingId}
      className={cns('min-w-0', className)}
    >
      <h2 className={cns('mb-3 text-h2')} id={headingId}>
        {CAST_HEADING}
      </h2>
      <div className={cns('flex items-center gap-5 overflow-x-auto pb-1')}>
        {shown.map(person => (
          <CastPerson
            imageUrl={person.imageUrl}
            initials={person.initials ?? castInitials(person.name)}
            key={person.name}
            name={person.name}
            role={person.character}
          />
        ))}
        {overflow.length > 0 ? (
          <span
            className={cns('shrink-0 text-sm text-ink-3')}
            title={overflow.map(person => person.name).join(', ')}
          >
            {`+${overflow.length} more`}
          </span>
        ) : null}
      </div>
    </section>
  )
}
