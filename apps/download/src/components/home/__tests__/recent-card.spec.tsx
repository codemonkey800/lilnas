import '@testing-library/jest-dom'

import type {
  GalleryItem,
  Movie,
  Show,
  Video,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import { RecentCard, recentCardMeta } from 'src/components/home/recent-card'
import { ACCOUNT_HREF } from 'src/components/shell/account-link'
import { MASKED_INITIALS } from 'src/components/ui/avatar'
import { UNKNOWN_VALUE } from 'src/lib/format'
import { profileHrefForEmail } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

const NOW = Date.parse('2026-09-15T20:00:00.000Z')
const VIEWER_EMAIL = 'jeremy.asuncion@lilnas.io'
const VIEWER: Viewer = {
  email: VIEWER_EMAIL,
  isAdmin: false,
  userId: 'u_1',
}
const ADMIN: Viewer = { email: 'ops@lilnas.io', isAdmin: true, userId: 'u_9' }

const MOVIE: Movie = {
  id: 'tmdb:438631',
  title: 'Scary Movie',
  tmdbId: 438631,
  type: DownloadType.Movie,
  year: 2026,
}

const SHOW: Show = {
  id: 'tvdb:121361',
  title: 'The Madison',
  tvdbId: 121361,
  type: DownloadType.Show,
  year: 2025,
}

const VIDEO: Video = {
  id: 'video:abc123',
  runtime: 178,
  sourceUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  title: 'How To Kettlebell Swing (in 3 minutes)',
  type: DownloadType.Video,
}

function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    downloadCount: 1,
    lastDownloadedAt: '2026-09-15T19:48:00.000Z',
    lastRequester: { email: VIEWER_EMAIL, userId: 'u_1' },
    media: MOVIE,
    ...overrides,
  }
}

describe('recentCardMeta', () => {
  it('renders a video runtime as a player-style clock', () => {
    expect(recentCardMeta(VIDEO)).toBe('2:58')
  })

  it('renders a movie or show year', () => {
    expect(recentCardMeta(MOVIE)).toBe('2026')
    expect(recentCardMeta(SHOW)).toBe('2025')
  })

  it('falls back to the unknown glyph rather than inventing a number', () => {
    expect(recentCardMeta({ ...MOVIE, year: undefined })).toBe(UNKNOWN_VALUE)
    expect(recentCardMeta({ ...VIDEO, runtime: undefined })).toBe(UNKNOWN_VALUE)
  })
})

describe('RecentCard', () => {
  it('links the top half at the media detail page', () => {
    render(<RecentCard item={item()} now={NOW} />)

    expect(screen.getByRole('link', { name: /Scary Movie/ })).toHaveAttribute(
      'href',
      '/movies/438631',
    )
  })

  it('gives a video the tall poster crop the rest of the grid uses', () => {
    const { container } = render(
      <RecentCard item={item({ media: VIDEO })} now={NOW} />,
    )
    const poster = container.querySelector('a > div')

    expect(poster?.getAttribute('class')).toContain('aspect-[2/3]')
    expect(poster?.getAttribute('class')).not.toContain('aspect-video')
  })

  it('measures the timestamp against the instant it is handed', () => {
    render(
      <RecentCard
        item={item({ lastDownloadedAt: '2026-09-15T18:00:00.000Z' })}
        now={NOW}
      />,
    )

    expect(screen.getByText('2h ago')).toBeInTheDocument()
  })

  describe('attribution', () => {
    it('renders a masked requester as the dashed avatar, with no profile link', () => {
      const { container } = render(
        <RecentCard
          item={item({ lastRequester: null })}
          now={NOW}
          viewer={VIEWER}
        />,
      )
      const avatar = container.querySelector('.rounded-full')

      expect(avatar?.tagName).toBe('SPAN')
      expect(avatar).toHaveTextContent(MASKED_INITIALS)
      expect(avatar?.getAttribute('class')).toContain('border-dashed')
      // One link only — the card's own. Nothing points at a profile.
      expect(
        screen.queryByRole('link', { name: MASKED_INITIALS }),
      ).not.toBeInTheDocument()
      expect(container.querySelector(`a[href="${ACCOUNT_HREF}"]`)).toBeNull()
    })

    it('links the avatar only when the requester is the viewer', () => {
      const { container } = render(
        <RecentCard item={item()} now={NOW} viewer={VIEWER} />,
      )
      const avatar = container.querySelector('.rounded-full')

      expect(avatar?.tagName).toBe('A')
      expect(avatar).toHaveAttribute('href', ACCOUNT_HREF)
      expect(avatar).toHaveTextContent('JA')
    })

    it('links somebody else’s avatar for an admin, at their ?user=', () => {
      const { container } = render(
        <RecentCard item={item()} now={NOW} viewer={ADMIN} />,
      )
      const avatar = container.querySelector('.rounded-full')

      expect(avatar?.tagName).toBe('A')
      expect(avatar).toHaveAttribute('href', profileHrefForEmail(VIEWER_EMAIL))
    })

    it('leaves somebody else’s avatar unlinked for a regular viewer', () => {
      const { container } = render(
        <RecentCard
          item={item({
            lastRequester: { email: 'sam.rivera@lilnas.io', userId: 'u_2' },
          })}
          now={NOW}
          viewer={VIEWER}
        />,
      )
      const avatar = container.querySelector('.rounded-full')

      expect(avatar?.tagName).toBe('SPAN')
      expect(avatar).toHaveTextContent('SR')
    })

    it('leaves every avatar unlinked when there is no viewer', () => {
      const { container } = render(<RecentCard item={item()} now={NOW} />)

      expect(container.querySelector('.rounded-full')?.tagName).toBe('SPAN')
    })
  })

  describe('Emby state', () => {
    it('offers Watch once the title is indexed', () => {
      render(
        <RecentCard
          item={item({
            media: {
              ...MOVIE,
              embyStatus: {
                itemId: '9',
                state: 'indexed',
                watchUrl: 'https://emby.lilnas.io/web/#!/item?id=9',
              },
            },
          })}
          now={NOW}
        />,
      )
      const watch = screen.getByRole('link', { name: 'Watch' })

      expect(watch).toHaveAttribute(
        'href',
        'https://emby.lilnas.io/web/#!/item?id=9',
      )
      expect(screen.queryByText('indexing…')).not.toBeInTheDocument()
    })

    it('swaps Watch for the indexing chip while Emby is still scanning', () => {
      render(
        <RecentCard
          item={item({ media: { ...SHOW, embyStatus: { state: 'indexing' } } })}
          now={NOW}
        />,
      )

      expect(screen.getByText('indexing…')).toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'Watch' }),
      ).not.toBeInTheDocument()
      // The year it replaces is gone with it — the chip is the whole slot.
      expect(screen.queryByText('2025')).not.toBeInTheDocument()
    })

    it('offers nothing to watch for a title with no Emby state at all', () => {
      render(<RecentCard item={item()} now={NOW} />)

      expect(
        screen.queryByRole('link', { name: 'Watch' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('indexing…')).not.toBeInTheDocument()
      expect(screen.getByText('2026')).toBeInTheDocument()
    })

    it('offers nothing to watch for a video, which Emby never indexes', () => {
      render(<RecentCard item={item({ media: VIDEO })} now={NOW} />)

      expect(
        screen.queryByRole('link', { name: 'Watch' }),
      ).not.toBeInTheDocument()
      expect(screen.getByText('2:58')).toBeInTheDocument()
    })
  })
})
