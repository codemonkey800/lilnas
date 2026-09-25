import '@testing-library/jest-dom'

import type {
  DiscordRequester,
  GalleryItem,
  Media,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DISCORD_UNLINKED_NOTE } from 'src/components/activity/discord-identity-mark'
import { GalleryItemCard } from 'src/components/gallery/gallery-item-card'
import { MASKED_INITIALS } from 'src/components/ui/avatar'
import { PROFILE_HREF, profileHrefForEmail } from 'src/lib/profile-filters'
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
 * `lastDownloadedAt` sits three hours before `addedAt` on purpose: every stamp
 * this spec reads (`12m ago`) can only have come from `addedAt`.
 */
function item(overrides: Partial<GalleryItem> = {}): GalleryItem {
  return {
    addedAt: '2026-09-15T11:48:00.000Z',
    downloadCount: 1,
    lastDiscordRequester: null,
    lastDownloadedAt: '2026-09-15T09:00:00.000Z',
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

  it('dates the card by when the title was added, not when it was downloaded', () => {
    const { container } = render(
      <GalleryItemCard item={item()} now={NOW} viewer={null} />,
    )
    const stamp = container.querySelector('time')

    expect(stamp).toHaveAttribute('dateTime', '2026-09-15T11:48:00.000Z')
    expect(stamp).toHaveTextContent('added 12m ago')
    expect(screen.queryByText('3h ago')).not.toBeInTheDocument()
  })

  it('renders a title nobody downloaded here with no uploader at all', () => {
    const { container } = render(
      <GalleryItemCard
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

    // No avatar — not even the dashed one — and no `hidden ·`: nobody asked
    // to be hidden, there is simply nobody. The stamp stays.
    expect(container.querySelector('.rounded-full')).toBeNull()
    expect(screen.queryByText(MASKED_INITIALS)).not.toBeInTheDocument()
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
    expect(screen.getByText('12m ago')).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
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
      PROFILE_HREF,
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

  /**
   * The three states `lastRequester`/`lastDiscordRequester` can arrive in, as
   * the ~158px card renders them. There is no `linkedDiscord` case here on
   * purpose: `GalleryItemSchema` carries no such field, so a linked uploader's
   * card shows the resolved email and nothing else — see the component's own
   * note.
   */
  describe('Discord attribution', () => {
    it('renders an unlinked Discord uploader as the handle’s initials plus the mark', () => {
      render(
        <GalleryItemCard
          item={item({
            lastDiscordRequester: DISCORD_SAM,
            lastRequester: null,
          })}
          now={NOW}
          viewer={null}
        />,
      )

      expect(screen.getByText('SP')).toBeInTheDocument()
      expect(screen.getByTitle('sam.pham · Discord')).toBeInTheDocument()
      expect(discordTrigger()).toBeInTheDocument()
    })

    it('reads an unlinked Discord upload as attributed, not as hidden', () => {
      render(
        <GalleryItemCard
          item={item({
            lastDiscordRequester: DISCORD_SAM,
            lastRequester: null,
          })}
          now={NOW}
          viewer={null}
        />,
      )

      // A null `lastRequester` alone is not the mask. Saying `hidden · 12m ago`
      // here would claim an uploader asked to be hidden when they did not.
      expect(screen.getByText('12m ago')).toBeInTheDocument()
      expect(screen.queryByText('hidden · 12m ago')).not.toBeInTheDocument()
    })

    it('carries exactly one mark for one account, never the avatar’s and a card’s own', () => {
      render(
        <GalleryItemCard
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
        <GalleryItemCard
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
      render(
        <GalleryItemCard
          item={item({
            lastDiscordRequester: DISCORD_SAM,
            lastRequester: null,
          })}
          now={NOW}
          viewer={ADMIN}
        />,
      )

      // No lilnas account claims this snowflake, so there is no profile to
      // open — the only link on the card is the poster's.
      expect(screen.getAllByRole('link')).toHaveLength(1)
    })

    it('renders a masked upload with no mark at all — not even the trigger', () => {
      render(
        <GalleryItemCard
          item={item({ lastDiscordRequester: null, lastRequester: null })}
          now={NOW}
          viewer={null}
        />,
      )

      // Masking outranks disclosure: no handle, no snowflake, and no button to
      // reveal either of them anywhere in the DOM.
      expect(screen.getByText('hidden · 12m ago')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Discord account details/ }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText(SNOWFLAKE)).not.toBeInTheDocument()
      expect(screen.queryByText('sam.pham')).not.toBeInTheDocument()
    })

    it('renders a linked Discord upload as the resolved email, with no mark', () => {
      render(
        <GalleryItemCard
          item={item({ lastDiscordRequester: DISCORD_SAM })}
          now={NOW}
          viewer={VIEWER}
        />,
      )

      // `AttributionResolutionService` fills `lastRequester` from the link
      // before serialization, and both fields arrive set. The email wins, and
      // the mark — a disclosure affordance for an identity nobody can resolve
      // — has nothing left to disclose.
      expect(screen.getByRole('link', { name: 'JA' })).toHaveAttribute(
        'href',
        PROFILE_HREF,
      )
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
    const SHOW: Media = {
      id: 'tvdb:121361',
      title: 'The Madison',
      tvdbId: 121361,
      type: DownloadType.Show,
      year: 2025,
    }

    const adopted = (media: Media): GalleryItem =>
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
      'credits an adopted %s to %s, with no avatar, no profile link and no `hidden`',
      (_kind, media, source) => {
        const { container } = render(
          <GalleryItemCard item={adopted(media)} now={NOW} viewer={ADMIN} />,
        )

        expect(screen.getByText(source)).toBeInTheDocument()
        expect(container.querySelector('.rounded-full')).toBeNull()
        expect(screen.queryByText(MASKED_INITIALS)).not.toBeInTheDocument()
        expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
        expect(screen.getByText('12m ago')).toBeInTheDocument()
        // The only link on the card is the poster's — a service has no
        // profile to open.
        expect(screen.getAllByRole('link')).toHaveLength(1)
      },
    )

    it('still lets a requester win over the flag', () => {
      render(
        <GalleryItemCard
          item={item({ lastStartedUpstream: true, media: MOVIE })}
          now={NOW}
          viewer={VIEWER}
        />,
      )

      expect(screen.getByRole('link', { name: 'JA' })).toHaveAttribute(
        'href',
        PROFILE_HREF,
      )
      expect(screen.queryByText('Radarr')).not.toBeInTheDocument()
    })

    it('still reads a movie row without the flag as hidden', () => {
      render(
        <GalleryItemCard
          item={item({ lastRequester: null, media: MOVIE })}
          now={NOW}
          viewer={null}
        />,
      )

      expect(screen.getByText(MASKED_INITIALS)).toBeInTheDocument()
      expect(screen.getByText('hidden · 12m ago')).toBeInTheDocument()
      expect(screen.queryByText('Radarr')).not.toBeInTheDocument()
    })
  })
})
