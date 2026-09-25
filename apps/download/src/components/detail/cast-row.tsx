import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { Avatar, CastPerson } from 'src/components/ui/avatar'

/**
 * One credited name.
 *
 * ⚠️ **Nothing on the wire populates this yet.** `MediaBase` carries
 * `certification`, `genres`, `overview`, `posterUrl`, `ratingValue`,
 * `releaseDate`, `runtime`, `title` and `year` - and no cast at all, on any of
 * the three media types. The mockups draw a cast row on the movie and show
 * pages, so the component exists and is the one place that row is spelled; a
 * page passes `[]` until a cast field lands, and `CastRow` renders nothing.
 *
 * `initials` is optional because the only thing a page will ever have is a
 * name - see {@link castInitials}. It stays overridable for a name whose
 * initials are not the first letters of its first two words.
 */
export type CastMember = {
  initials?: string
  name: string
}

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

export type CastRowProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  /** How many names to draw before the count. Defaults to {@link CAST_VISIBLE_LIMIT}. */
  limit?: number
  /** In credited order. An empty list renders nothing at all. */
  people: readonly CastMember[]
}

/**
 * The credited-cast row on a movie or show header - a bounded number of
 * portraits, then a count for the rest.
 *
 * Ported from the `castPerson` run in `movie-detail.pug` / `show-detail.pug`
 * plus their shared cast-overflow appendix. Two deliberate deviations:
 *
 * - The overflow marker reads `+6 more` rather than the mockups' bare `+6`
 *   circle. The circle carries the remaining names in a `title`, which is
 *   invisible on a touch device and to anyone who does not hover; the word
 *   makes the affordance legible and the `title` stays as the detail.
 * - It wraps at every width rather than turning into a masked sideways
 *   scroller below `sm`. The scroller is the appendix's own demonstration of
 *   an *unbounded* list; `limit` already bounds this one to five items, which
 *   wraps to three rows at 390px without a gesture nobody was told about.
 *
 * Returns `null` for an empty cast rather than an empty flex row, so a page
 * can render it unconditionally without leaving a gap where a title has no
 * cast (which, today, is every title - see {@link CastMember}).
 */
export function CastRow({
  className,
  limit = CAST_VISIBLE_LIMIT,
  people,
  ...props
}: CastRowProps): JSX.Element | null {
  if (people.length === 0) {
    return null
  }

  const shown = people.slice(0, Math.max(0, limit))
  const overflow = people.slice(shown.length)

  return (
    <div
      {...props}
      className={cns('flex flex-wrap items-center gap-4', className)}
    >
      {shown.map(person => (
        <CastPerson
          initials={person.initials ?? castInitials(person.name)}
          key={person.name}
          name={person.name}
        />
      ))}
      {overflow.length > 0 ? (
        <div className={cns('flex shrink-0 items-center gap-2')}>
          <Avatar
            className={cns('text-[10px]')}
            initials={`+${overflow.length}`}
            size="md"
            title={overflow.map(person => person.name).join(', ')}
          />
          <span className={cns('text-sm text-ink-3')}>more</span>
        </div>
      ) : null}
    </div>
  )
}
