import '@testing-library/jest-dom'

import type {
  DiscordRequester,
  GalleryItem,
  Movie,
  Show,
  Video,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DISCORD_UNLINKED_NOTE } from 'src/components/activity/discord-identity-mark'
import { RecentCard, recentCardMeta } from 'src/components/home/recent-card'
import { MASKED_INITIALS } from 'src/components/ui/avatar'
import { UNKNOWN_VALUE } from 'src/lib/format'
import { PROFILE_HREF, profileHrefForEmail } from 'src/lib/profile-filters'
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

/**
 * A real 18-digit snowflake, kept as a **string literal**: it is past
 * `Number.MAX_SAFE_INTEGER`, so writing it as a number would silently round.
 */
const SNOWFLAKE = '273145016936267776'

/** The Discord account that submitted the last download and has no link yet. */
const DISCORD_SAM: DiscordRequester = {
  discordUserId: SNOWFLAKE,
  discordUsername: 'sam.pham',
}

/** E5's disclosure trigger, by the accessible name it announces. */
function discordTrigger(): HTMLElement {
  return screen.getByRole('button', { name: /Discord account details/ })
}

/**
 * `lastDownloadedAt` sits three hours before `addedAt` on purpose: a stamp
 * this spec reads can only have come from `addedAt`.
 */
function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    addedAt: '2026-09-15T19:48:00.000Z',
    downloadCount: 1,
    lastDiscordRequester: null,
    lastDownloadedAt: '2026-09-15T17:00:00.000Z',
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
    render(<RecentCard item={item()} now={NOW} viewer={null} />)

    expect(screen.getByRole('link', { name: /Scary Movie/ })).toHaveAttribute(
      'href',
      '/movies/438631',
    )
  })

  it('gives a video the tall poster crop the rest of the grid uses', () => {
    const { container } = render(
      <RecentCard item={item({ media: VIDEO })} now={NOW} viewer={null} />,
    )
    const poster = container.querySelector('a > div')

    expect(poster?.getAttribute('class')).toContain('aspect-[2/3]')
    expect(poster?.getAttribute('class')).not.toContain('aspect-video')
  })

  it('measures the timestamp against the instant it is handed', () => {
    render(
      <RecentCard
        item={item({ addedAt: '2026-09-15T18:00:00.000Z' })}
        now={NOW}
        viewer={null}
      />,
    )

    expect(screen.getByText('2h ago')).toBeInTheDocument()
  })

  it('dates the card by when the title was added, not when it was downloaded', () => {
    const { container } = render(
      <RecentCard item={item()} now={NOW} viewer={null} />,
    )
    const stamp = container.querySelector('time')

    expect(stamp).toHaveAttribute('dateTime', '2026-09-15T19:48:00.000Z')
    expect(stamp).toHaveTextContent('added 12m ago')
    expect(screen.queryByText('3h ago')).not.toBeInTheDocument()
  })

  describe('attribution', () => {
    it('renders a title nobody downloaded here with no avatar at all', () => {
      const { container } = render(
        <RecentCard
          item={item({
            downloadCount: 0,
            lastDiscordRequester: null,
            lastDownloadedAt: null,
            lastRequester: null,
          })}
          now={NOW}
          viewer={ADMIN}
        />,
      )

      // Not even the dashed circle — nobody asked to be hidden, there is
      // simply nobody. The stamp stays.
      expect(container.querySelector('.rounded-full')).toBeNull()
      expect(screen.queryByText(MASKED_INITIALS)).not.toBeInTheDocument()
      expect(screen.getByText('12m ago')).toBeInTheDocument()
      expect(screen.getAllByRole('link')).toHaveLength(1)
    })

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
      expect(container.querySelector(`a[href="${PROFILE_HREF}"]`)).toBeNull()
    })

    it('links the avatar only when the requester is the viewer', () => {
      const { container } = render(
        <RecentCard item={item()} now={NOW} viewer={VIEWER} />,
      )
      const avatar = container.querySelector('.rounded-full')

      expect(avatar?.tagName).toBe('A')
      expect(avatar).toHaveAttribute('href', PROFILE_HREF)
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
      const { container } = render(
        <RecentCard item={item()} now={NOW} viewer={null} />,
      )

      expect(container.querySelector('.rounded-full')?.tagName).toBe('SPAN')
    })
  })

  /**
   * The three states `lastRequester`/`lastDiscordRequester` can arrive in. No
   * `linkedDiscord` case: `GalleryItemSchema` has no such field, so a linked
   * uploader's card shows the resolved email alone — see `GalleryItemCard`'s
   * note, which this card follows exactly.
   */
  describe('Discord attribution', () => {
    it('renders an unlinked Discord uploader as the handle’s initials plus the mark', () => {
      const { container } = render(
        <RecentCard
          item={item({
            lastDiscordRequester: DISCORD_SAM,
            lastRequester: null,
          })}
          now={NOW}
          viewer={null}
        />,
      )
      const avatar = container.querySelector('.rounded-full')

      expect(avatar).toHaveTextContent('SP')
      // Keeps the 18px circle the email branch has always drawn here.
      expect(avatar?.getAttribute('class')).toContain('h-[18px]')
      expect(avatar).toHaveAttribute('title', 'sam.pham · Discord')
      expect(discordTrigger()).toBeInTheDocument()
    })

    it('carries exactly one mark for one account', () => {
      render(
        <RecentCard
          item={item({
            lastDiscordRequester: DISCORD_SAM,
            lastRequester: null,
          })}
          now={NOW}
          viewer={null}
        />,
      )

      expect(
        screen.getAllByRole('button', { name: /Discord account details/ }),
      ).toHaveLength(1)
    })

    it('discloses the raw snowflake from the mark, which is what an admin pastes', async () => {
      const user = userEvent.setup()
      render(
        <RecentCard
          item={item({
            lastDiscordRequester: DISCORD_SAM,
            lastRequester: null,
          })}
          now={NOW}
          viewer={null}
        />,
      )

      await user.click(discordTrigger())

      expect(screen.getByText(SNOWFLAKE)).toBeInTheDocument()
      expect(screen.getByText(DISCORD_UNLINKED_NOTE)).toBeInTheDocument()
    })

    it('never links an unlinked Discord uploader to a profile, admin or not', () => {
      const { container } = render(
        <RecentCard
          item={item({
            lastDiscordRequester: DISCORD_SAM,
            lastRequester: null,
          })}
          now={NOW}
          viewer={ADMIN}
        />,
      )

      // No lilnas account claims this snowflake, so there is no profile to
      // open — not even for the admin who could link it.
      expect(container.querySelector('.rounded-full')?.tagName).toBe('SPAN')
      expect(container.querySelector(`a[href="${PROFILE_HREF}"]`)).toBeNull()
    })

    it('renders a masked upload with no mark at all — not even the trigger', () => {
      render(
        <RecentCard
          item={item({ lastDiscordRequester: null, lastRequester: null })}
          now={NOW}
          viewer={null}
        />,
      )

      // Masking outranks disclosure: no handle, no snowflake, and no button to
      // reveal either of them anywhere in the DOM.
      expect(screen.getByText(MASKED_INITIALS)).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Discord account details/ }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText(SNOWFLAKE)).not.toBeInTheDocument()
      expect(screen.queryByText('sam.pham')).not.toBeInTheDocument()
    })

    it('renders a linked Discord upload as the resolved email, with no mark', () => {
      const { container } = render(
        <RecentCard
          item={item({ lastDiscordRequester: DISCORD_SAM })}
          now={NOW}
          viewer={VIEWER}
        />,
      )
      const avatar = container.querySelector('.rounded-full')

      // Both fields arrive set for a linked uploader — the server resolved the
      // link before serializing. The email wins, and the mark has nothing left
      // to disclose.
      expect(avatar).toHaveAttribute('href', PROFILE_HREF)
      expect(avatar).toHaveTextContent('JA')
      expect(
        screen.queryByRole('button', { name: /Discord account details/ }),
      ).not.toBeInTheDocument()
    })
  })

  /**
   * Plan 022 follow-up. A title whose latest download was adopted from
   * Radarr's or Sonarr's own UI arrives with both identity slots `null`, like a
   * masked one — `lastStartedUpstream` is what says nobody hid anything.
   */
  describe('upstream attribution', () => {
    const adopted = (media: Movie | Show): GalleryItem =>
      item({
        lastDiscordRequester: null,
        lastRequester: null,
        lastStartedUpstream: true,
        media,
      })

    it.each([
      ['movie', MOVIE, 'Radarr'],
      ['show', SHOW, 'Sonarr'],
    ] as const)(
      'credits an adopted %s to %s, with no avatar and no profile link',
      (_kind, media, source) => {
        const { container } = render(
          <RecentCard item={adopted(media)} now={NOW} viewer={ADMIN} />,
        )

        expect(screen.getByText(source)).toBeInTheDocument()
        expect(container.querySelector('.rounded-full')).toBeNull()
        expect(screen.queryByText(MASKED_INITIALS)).not.toBeInTheDocument()
        expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
        // One link only — the card's own. A service has no profile to open.
        expect(screen.getAllByRole('link')).toHaveLength(1)
      },
    )

    it('still lets a requester win over the flag', () => {
      render(
        <RecentCard
          item={item({ lastStartedUpstream: true })}
          now={NOW}
          viewer={VIEWER}
        />,
      )

      expect(screen.getByText('JA')).toBeInTheDocument()
      expect(screen.queryByText('Radarr')).not.toBeInTheDocument()
    })

    it('still masks a row without the flag', () => {
      render(
        <RecentCard
          item={item({ lastRequester: null })}
          now={NOW}
          viewer={null}
        />,
      )

      expect(screen.getByText(MASKED_INITIALS)).toBeInTheDocument()
      expect(screen.queryByText('Radarr')).not.toBeInTheDocument()
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
          viewer={null}
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
          viewer={null}
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
      render(<RecentCard item={item()} now={NOW} viewer={null} />)

      expect(
        screen.queryByRole('link', { name: 'Watch' }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText('indexing…')).not.toBeInTheDocument()
      expect(screen.getByText('2026')).toBeInTheDocument()
    })

    it('offers nothing to watch for a video, which Emby never indexes', () => {
      render(
        <RecentCard item={item({ media: VIDEO })} now={NOW} viewer={null} />,
      )

      expect(
        screen.queryByRole('link', { name: 'Watch' }),
      ).not.toBeInTheDocument()
      expect(screen.getByText('2:58')).toBeInTheDocument()
    })
  })
})
