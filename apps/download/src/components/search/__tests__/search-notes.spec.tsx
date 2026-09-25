import { render, screen } from '@testing-library/react'

import {
  DegradedSourcesNote,
  NoMatchesNote,
  ShortQueryNote,
} from 'src/components/search/search-notes'

/**
 * The note element itself. Asserted on the rendered `class` attribute rather
 * than on the string handed to `cns` — twMerge reshapes the list afterwards.
 */
function noteClasses(): string[] {
  const node = screen.getByRole('status')

  return (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
}

/** The loud `bad` override `search.pug:320` puts on a call site. */
const LOUD = ['border-bad/35!', 'bg-bad-ghost!', '[&>svg]:text-bad!']

describe('DegradedSourcesNote', () => {
  // ⚠️ An empty array is the explicit "both sources answered" signal, not an
  // absence of information — so it must render nothing, loudly or otherwise.
  it('renders nothing when both upstreams answered', () => {
    const { container } = render(<DegradedSourcesNote degradedSources={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('names the service that failed and what survived, when Sonarr is down', () => {
    render(<DegradedSourcesNote degradedSources={['shows']} />)

    const note = screen.getByRole('status')

    expect(note).toHaveTextContent('Showing movies only.')
    expect(note).toHaveTextContent(/Sonarr didn't answer/)
    expect(note).toHaveTextContent(/from Radarr alone/)
  })

  it('names the service that failed, when Radarr is down', () => {
    render(<DegradedSourcesNote degradedSources={['movies']} />)

    const note = screen.getByRole('status')

    expect(note).toHaveTextContent('Showing shows only.')
    expect(note).toHaveTextContent(/Radarr didn't answer/)
    expect(note).toHaveTextContent(/from Sonarr alone/)
  })

  it('says so plainly when neither answered', () => {
    render(<DegradedSourcesNote degradedSources={['movies', 'shows']} />)

    expect(screen.getByRole('status')).toHaveTextContent(
      /Neither Radarr and Sonarr answered/,
    )
  })

  // A missing upstream makes the count above it wrong in a way the user
  // cannot see. That is what `bad` is for.
  it('is the loud note', () => {
    render(<DegradedSourcesNote degradedSources={['shows']} />)

    expect(noteClasses()).toEqual(expect.arrayContaining(LOUD))
  })
})

describe('NoMatchesNote', () => {
  it('quotes the query that found nothing', () => {
    render(<NoMatchesNote query="xyzzyqqq" />)

    expect(screen.getByRole('status')).toHaveTextContent(
      'No matches for “xyzzyqqq.”',
    )
  })

  it('offers the gallery as the other way in', () => {
    render(<NoMatchesNote query="xyzzyqqq" />)

    expect(screen.getByRole('link', { name: 'gallery' })).toHaveAttribute(
      'href',
      '/gallery',
    )
  })

  // ⚠️ The deliberate split from the mockup, and the reason both notes are
  // tested together: `search.pug` draws this one in `bad` too. A zero-result
  // search is a true, complete answer — painting it red says the user did
  // something wrong and spends the colour reserved for things that broke.
  it('is NOT the loud note, unlike the degraded-source one', () => {
    render(<NoMatchesNote query="xyzzyqqq" />)

    const classes = noteClasses()

    for (const loud of LOUD) {
      expect(classes).not.toContain(loud)
    }
  })
})

describe('ShortQueryNote', () => {
  it('states the two-character floor the API enforces', () => {
    render(<ShortQueryNote />)

    expect(screen.getByRole('status')).toHaveTextContent(
      /at least two characters/,
    )
  })
})
