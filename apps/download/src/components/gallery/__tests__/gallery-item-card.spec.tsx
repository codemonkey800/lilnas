import '@testing-library/jest-dom'

import type { GalleryItem, Media } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import { GalleryItemCard } from 'src/components/gallery/gallery-item-card'
import { ACCOUNT_HREF } from 'src/components/shell/account-link'
import { MASKED_INITIALS } from 'src/components/ui/avatar'
import { profileHrefForEmail } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

/** The one instant the whole grid is measured against, pinned by the page. */
const NOW = Date.parse('2026-09-15T12:00:00.000Z')

const VIDEO: Media = {
  id: 'video:abc123',
  runtime: 842,
  sourceUrl: 'https://youtube.com/watch?v=abc',
  title: 'Sourdough starter, day one to seven',
  type: DownloadType.Video,
}

const MOVIE: Media = {
  id: 'tmdb:11660',
  posterUrl: 'https://art.example/poster.jpg',
  title: 'Following',
  tmdbId: 11660,
  type: DownloadType.Movie,
  year: 1999,
}

const VIEWER: Viewer = {
  email: 'jeremy.asuncion@lilnas.io',
  isAdmin: false,
  userId: 'u_1',
}
const ADMIN: Viewer = { email: 'ops@lilnas.io', isAdmin: true, userId: 'u_9' }

function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    downloadCount: 1,
    lastDownloadedAt: '2026-09-15T11:48:00.000Z',
    lastRequester: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_1' },
    media: VIDEO,
    ...overrides,
  }
}

describe('GalleryItemCard', () => {
  it('links the top half of the card at the media detail route', () => {
    render(
      <GalleryItemCard item={item({ media: MOVIE })} now={NOW} viewer={null} />,
    )

    expect(screen.getByRole('link')).toHaveAttribute('href', '/movies/11660')
  })

  it('renders a video with its clock runtime', () => {
    render(<GalleryItemCard item={item()} now={NOW} viewer={null} />)

    expect(screen.getByText('video · 14:02')).toBeInTheDocument()
  })

  it('renders a movie with its year', () => {
    render(
      <GalleryItemCard item={item({ media: MOVIE })} now={NOW} viewer={null} />,
    )

    expect(screen.getByText('movie · 1999')).toBeInTheDocument()
  })

  it('renders the kind alone rather than trailing an em dash when nothing is known', () => {
    render(
      <GalleryItemCard
        item={item({ media: { ...VIDEO, runtime: undefined } })}
        now={NOW}
        viewer={null}
      />,
    )

    expect(screen.getByText('video')).toBeInTheDocument()
    expect(screen.queryByText(/—/)).not.toBeInTheDocument()
  })

  it('measures the stamp against the instant it is given, never the clock', () => {
    render(<GalleryItemCard item={item()} now={NOW} viewer={null} />)

    // 11:48 against a pinned noon. Reading `Date.now()` per card is what makes
    // a grid of these a hydration mismatch.
    expect(screen.getByText('12m ago')).toBeInTheDocument()
  })

  it('renders the uploader initials', () => {
    render(<GalleryItemCard item={item()} now={NOW} viewer={null} />)

    expect(screen.getByText('JA')).toBeInTheDocument()
  })

  it('renders a masked upload as the dashed avatar and says so', () => {
    render(
      <GalleryItemCard
        item={item({ lastRequester: null })}
        now={NOW}
        viewer={null}
      />,
    )

    expect(screen.getByText(MASKED_INITIALS)).toBeInTheDocument()
    expect(screen.getByText('hidden · 12m ago')).toBeInTheDocument()
  })

  it('never links a masked identity to a profile, admin or not', () => {
    render(
      <GalleryItemCard
        item={item({ lastRequester: null })}
        now={NOW}
        viewer={ADMIN}
      />,
    )

    // The only link on the card is the one wrapping the poster.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('links the uploader mark to the viewer’s own profile', () => {
    render(<GalleryItemCard item={item()} now={NOW} viewer={VIEWER} />)

    expect(screen.getByRole('link', { name: 'JA' })).toHaveAttribute(
      'href',
      ACCOUNT_HREF,
    )
  })

  it('links somebody else’s uploader mark for an admin, at their ?user=', () => {
    render(<GalleryItemCard item={item()} now={NOW} viewer={ADMIN} />)

    expect(screen.getByRole('link', { name: 'JA' })).toHaveAttribute(
      'href',
      profileHrefForEmail('jeremy.asuncion@lilnas.io'),
    )
  })

  it('never links somebody else’s uploader mark for a regular viewer', () => {
    render(
      <GalleryItemCard
        item={item({
          lastRequester: { email: 'sam@lilnas.io', userId: 'u_2' },
        })}
        now={NOW}
        viewer={VIEWER}
      />,
    )

    expect(screen.queryByRole('link', { name: 'SA' })).not.toBeInTheDocument()
  })

  it('offers Watch as a real link once Emby has indexed the title', () => {
    render(
      <GalleryItemCard
        item={item({
          media: {
            ...MOVIE,
            embyStatus: {
              itemId: '33226',
              state: 'indexed',
              watchUrl: 'https://emby.lilnas.io/web/#!/item?id=33226',
            },
          },
        })}
        now={NOW}
        viewer={null}
      />,
    )

    const watch = screen.getByRole('link', { name: 'Watch' })

    expect(watch).toHaveAttribute(
      'href',
      'https://emby.lilnas.io/web/#!/item?id=33226',
    )
    expect(watch).toHaveAttribute('target', '_blank')
  })

  it('offers no Watch for a title Emby has nothing for', () => {
    render(
      <GalleryItemCard item={item({ media: MOVIE })} now={NOW} viewer={null} />,
    )

    expect(
      screen.queryByRole('link', { name: 'Watch' }),
    ).not.toBeInTheDocument()
  })

  it('says a title is still being indexed', () => {
    render(
      <GalleryItemCard
        item={item({
          media: { ...MOVIE, embyStatus: { state: 'indexing' } },
        })}
        now={NOW}
        viewer={null}
      />,
    )

    expect(screen.getByText('indexing…')).toBeInTheDocument()
  })

  it('labels a poster that has no art so the tile is not blank', () => {
    render(
      <GalleryItemCard item={item({ media: MOVIE })} now={NOW} viewer={null} />,
    )

    // Two copies of the title on purpose: the card's own title, plus the
    // poster's fallback label, which CSS hides the moment the art loads.
    expect(screen.getAllByText('Following')).toHaveLength(2)
  })

  it('leaves a video poster unlabelled, because the play mark is centred there', () => {
    render(<GalleryItemCard item={item()} now={NOW} viewer={null} />)

    expect(
      screen.getAllByText('Sourdough starter, day one to seven'),
    ).toHaveLength(1)
  })

  it('gives every card the same width at each breakpoint', () => {
    const { container } = render(
      <GalleryItemCard item={item()} now={NOW} viewer={null} />,
    )

    expect(container.firstElementChild?.getAttribute('class')).toContain(
      'w-[calc(50%-8px)] sm:w-[158px]',
    )
  })
})
