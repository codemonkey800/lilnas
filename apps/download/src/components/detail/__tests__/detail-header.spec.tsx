import '@testing-library/jest-dom'

import type {
  DiscordIdentity,
  DiscordRequester,
  Media,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import {
  DetailAttribution,
  DetailHeader,
} from 'src/components/detail/detail-header'
import { MASKED_INITIALS } from 'src/components/ui/avatar'

/** The one instant every stamp on the page is measured against. */
const NOW = Date.parse('2026-09-15T12:00:00.000Z')

/** A real snowflake, as a **string literal** — 18 digits do not fit a number. */
const SNOWFLAKE = '273145016936267776'

const DISCORD_SAM: DiscordRequester = {
  discordUserId: SNOWFLAKE,
  discordUsername: 'sam.pham',
}

const LINKED_JEREMY: DiscordIdentity = {
  discordUserId: '583920174659201024',
  discordUsername: 'jeremy.a',
}

/** E5's disclosure trigger, by the accessible name it announces. */
function discordMark(): HTMLElement | null {
  return screen.queryByRole('button', { name: /Discord account details/ })
}

const MOVIE: Media = {
  id: 'tmdb:11660',
  posterUrl: 'https://art.example/poster.jpg',
  title: 'Following',
  tmdbId: 11660,
  type: DownloadType.Movie,
  year: 1999,
}

const VIDEO: Media = {
  id: 'video:abc123',
  runtime: 842,
  sourceUrl: 'https://youtube.com/watch?v=abc',
  title: 'Sourdough starter, day one to seven',
  type: DownloadType.Video,
}

describe('DetailHeader', () => {
  it('renders the title as the heading', () => {
    const { container } = render(<DetailHeader media={MOVIE} />)

    expect(container.querySelector('p.text-h1')).toHaveTextContent('Following')
  })

  it('renders every optional slot in the order the mockups put them', () => {
    const { container } = render(
      <DetailHeader
        actions={<span>slot-actions</span>}
        attribution={<span>slot-attribution</span>}
        cast={<span>slot-cast</span>}
        lifecycle={<span>slot-lifecycle</span>}
        links={<span>slot-links</span>}
        media={MOVIE}
        meta="1999 · 1h 10m"
        synopsis="A young writer follows strangers."
      />,
    )

    const order = Array.from(container.querySelectorAll('span'))
      .map(element => element.textContent ?? '')
      .filter(text => text.startsWith('slot-'))

    expect(order).toEqual([
      'slot-links',
      'slot-cast',
      'slot-attribution',
      'slot-lifecycle',
      'slot-actions',
    ])
  })

  it('omits the metadata paragraph when there is no metadata', () => {
    render(<DetailHeader media={MOVIE} />)

    // An empty paragraph under the title is a gap that reads as a bug.
    expect(screen.queryByText('1999 · 1h 10m')).not.toBeInTheDocument()
  })

  it('labels a movie poster with its title', () => {
    render(<DetailHeader media={MOVIE} />)

    // Two nodes carry the title now — the heading and the poster's fallback
    // label — which is exactly what the mixin does.
    expect(screen.getAllByText('Following')).toHaveLength(2)
  })

  it('leaves a video poster unlabelled', () => {
    render(<DetailHeader media={VIDEO} posterShape="wide" />)

    // The backend never populates `posterUrl` for a video, so the fallback
    // always paints — and a centred label lands on top of the play mark.
    expect(
      screen.getAllByText('Sourdough starter, day one to seven'),
    ).toHaveLength(1)
  })

  it('gives each shape its own complete width set at both widths', () => {
    const { container: tall } = render(<DetailHeader media={MOVIE} />)
    const { container: wide } = render(
      <DetailHeader media={VIDEO} posterShape="wide" />,
    )

    const tallClasses =
      tall.firstElementChild?.firstElementChild?.getAttribute('class')
    const wideClasses =
      wide.firstElementChild?.firstElementChild?.getAttribute('class')

    expect(tallClasses).toContain('max-w-[220px]')
    expect(tallClasses).toContain('sm:w-[200px]')
    expect(wideClasses).toContain('sm:w-[340px]')
    expect(wideClasses).not.toContain('max-w-[220px]')
  })

  it('renders an overlay inside the poster', () => {
    render(
      <DetailHeader
        media={VIDEO}
        posterOverlay={<span>player-controls</span>}
        posterShape="wide"
      />,
    )

    expect(screen.getByText('player-controls')).toBeInTheDocument()
  })
})

describe('DetailAttribution', () => {
  it('reads the local part of the address and how long ago it was', () => {
    render(
      <DetailAttribution
        now={NOW}
        requester={{ email: 'jeremy.asuncion@lilnas.io', userId: 'u_1' }}
        timestamp="2026-09-15T11:48:00.000Z"
      />,
    )

    expect(screen.getByText('jeremy.asuncion · 12m ago')).toBeInTheDocument()
  })

  it('takes the prefix the page supplies', () => {
    render(
      <DetailAttribution
        now={NOW}
        prefix="downloaded by "
        requester={{ email: 'sam@lilnas.io', userId: 'u_2' }}
        timestamp="2026-09-15T11:48:00.000Z"
      />,
    )

    expect(screen.getByText('downloaded by sam · 12m ago')).toBeInTheDocument()
  })

  it('renders a masked requester as hidden, beside a dashed avatar', () => {
    render(
      <DetailAttribution
        now={NOW}
        requester={null}
        timestamp="2026-09-15T11:48:00.000Z"
      />,
    )

    expect(screen.getByText('hidden · 12m ago')).toBeInTheDocument()
    expect(screen.getByText(MASKED_INITIALS)).toBeInTheDocument()
  })

  it('never links, masked or not — /profile does not exist yet', () => {
    const { container } = render(
      <DetailAttribution
        now={NOW}
        requester={{ email: 'jeremy.asuncion@lilnas.io', userId: 'u_1' }}
        timestamp="2026-09-15T11:48:00.000Z"
      />,
    )

    expect(container.querySelector('a')).toBeNull()
  })

  it('keeps the full address in the avatar title', () => {
    render(
      <DetailAttribution
        now={NOW}
        requester={{ email: 'jeremy.asuncion@lilnas.io', userId: 'u_1' }}
        timestamp="2026-09-15T11:48:00.000Z"
      />,
    )

    expect(screen.getByText('JA')).toHaveAttribute(
      'title',
      'jeremy.asuncion@lilnas.io',
    )
  })

  it('measures the stamp against the instant it is given, never the clock', () => {
    render(
      <DetailAttribution
        now={NOW}
        requester={null}
        timestamp="2026-09-14T12:00:00.000Z"
      />,
    )

    expect(screen.getByText('hidden · 1d ago')).toBeInTheDocument()
  })

  /**
   * The same four states the activity cell renders, on the one surface that
   * writes them as a sentence rather than as a cell.
   */
  describe('Discord attribution', () => {
    it('reads an unlinked Discord submission as its handle plus the mark', () => {
      render(
        <DetailAttribution
          discordRequester={DISCORD_SAM}
          now={NOW}
          prefix="downloaded by "
          requester={null}
          timestamp="2026-09-15T11:48:00.000Z"
        />,
      )

      expect(screen.getByText('downloaded by sam.pham')).toBeInTheDocument()
      expect(discordMark()).toBeInTheDocument()
      // Never the masked line: a person asked for this download.
      expect(screen.queryByText(MASKED_INITIALS)).not.toBeInTheDocument()
    })

    it('writes a linked handle after the name, with nothing to click', () => {
      render(
        <DetailAttribution
          linkedDiscord={LINKED_JEREMY}
          now={NOW}
          prefix="downloaded by "
          requester={{ email: 'jeremy.asuncion@lilnas.io', userId: 'u_1' }}
          timestamp="2026-09-15T11:48:00.000Z"
        />,
      )

      expect(
        screen.getByText('downloaded by jeremy.asuncion'),
      ).toBeInTheDocument()
      expect(
        screen.getByText(`@${LINKED_JEREMY.discordUsername}`),
      ).toBeInTheDocument()
      expect(discordMark()).not.toBeInTheDocument()
    })

    // ⚠️ Asserted directly rather than inferred from the `hidden` wording: this
    // is the one line where a disclosure control could hand a reader an
    // identity the mask exists to withhold.
    it('renders neither identity, and no snowflake, behind the mask', () => {
      render(
        <DetailAttribution
          discordRequester={null}
          linkedDiscord={LINKED_JEREMY}
          now={NOW}
          requester={null}
          timestamp="2026-09-15T11:48:00.000Z"
        />,
      )

      expect(screen.getByText('hidden · 12m ago')).toBeInTheDocument()
      expect(discordMark()).not.toBeInTheDocument()
      expect(document.body).not.toHaveTextContent(SNOWFLAKE)
      expect(document.body).not.toHaveTextContent(LINKED_JEREMY.discordUsername)
    })
  })

  /**
   * Plan 022: a download started in Radarr's or Sonarr's own UI, adopted as a
   * job. The same nulls as a masked job, and never read as one.
   */
  describe('an adopted download', () => {
    it.each([
      ['Radarr', '12m ago', '2026-09-15T11:48:00.000Z'],
      ['Sonarr', '1h ago', '2026-09-15T11:00:00.000Z'],
    ] as const)(
      'reads %s as a plain label, with no avatar and no link',
      (source, ago, timestamp) => {
        const { container } = render(
          <DetailAttribution
            now={NOW}
            requester={null}
            timestamp={timestamp}
            upstreamSource={source}
          />,
        )

        expect(screen.getByText(`${source} · ${ago}`)).toBeInTheDocument()
        expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
        expect(screen.queryByText(MASKED_INITIALS)).not.toBeInTheDocument()
        expect(container.querySelector('[title]')).toBeNull()
        expect(container.querySelector('a')).toBeNull()
      },
    )

    // The mockups write `Sonarr · 1h ago`, not `requested by Sonarr`: nobody
    // requested it through this app.
    it('drops the page’s prefix', () => {
      render(
        <DetailAttribution
          now={NOW}
          prefix="requested by "
          requester={null}
          timestamp="2026-09-15T11:00:00.000Z"
          upstreamSource="Sonarr"
        />,
      )

      expect(screen.getByText('Sonarr · 1h ago')).toBeInTheDocument()
    })

    // A job with both can't be stored (the `origin` CHECK), but an identity
    // outranks a service if one ever arrives.
    it('lets a requester or a Discord submitter win over the source', () => {
      const { unmount } = render(
        <DetailAttribution
          now={NOW}
          requester={{ email: 'jeremy.asuncion@lilnas.io', userId: 'u_1' }}
          timestamp="2026-09-15T11:48:00.000Z"
          upstreamSource="Radarr"
        />,
      )

      expect(screen.getByText('jeremy.asuncion · 12m ago')).toBeInTheDocument()
      unmount()

      render(
        <DetailAttribution
          discordRequester={DISCORD_SAM}
          now={NOW}
          requester={null}
          timestamp="2026-09-15T11:48:00.000Z"
          upstreamSource="Radarr"
        />,
      )

      expect(screen.getByText('sam.pham')).toBeInTheDocument()
      expect(screen.queryByText(/Radarr/)).not.toBeInTheDocument()
    })
  })
})
