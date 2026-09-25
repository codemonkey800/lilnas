import '@testing-library/jest-dom'

import type {
  DiscordIdentity,
  DiscordRequester,
  DownloadJob,
  JobRequester,
  Media,
} from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import {
  ActivityRequester,
  canViewRequesterProfile,
  galleryUpstreamSource,
  jobUpstreamSource,
  MASKED_REQUESTER_LABEL,
} from 'src/components/activity/activity-requester'
import { MASKED_INITIALS } from 'src/components/ui/avatar'
import { PROFILE_HREF, profileHrefForEmail } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

const JEREMY: JobRequester = { email: 'jeremy@lilnas.io', userId: 'u_jeremy' }
const SAM: JobRequester = { email: 'sam@lilnas.io', userId: 'u_sam' }

/**
 * A real 18-digit snowflake, kept as a **string literal**: it is past
 * `Number.MAX_SAFE_INTEGER`, so writing it as a number would silently round.
 */
const SNOWFLAKE = '273145016936267776'

/** The account that submitted a job over Discord and has no lilnas link yet. */
const DISCORD_SAM: DiscordRequester = {
  discordUserId: SNOWFLAKE,
  discordUsername: 'sam.pham',
}

/** The account *linked to* `JEREMY` — a different fact, same shape. */
const LINKED_JEREMY: DiscordIdentity = {
  discordUserId: '583920174659201024',
  discordUsername: 'jeremy.a',
}

/** E5's disclosure trigger, by the accessible name it announces. */
function discordMark(): HTMLElement | null {
  return screen.queryByRole('button', { name: /Discord account details/ })
}

const VIEWER: Viewer = {
  email: 'jeremy@lilnas.io',
  isAdmin: false,
  userId: 'u_jeremy',
}
const ADMIN: Viewer = { ...VIEWER, isAdmin: true }

function links(): HTMLAnchorElement[] {
  return screen.queryAllByRole('link')
}

describe('canViewRequesterProfile', () => {
  it('lets anyone through to their own identity', () => {
    expect(canViewRequesterProfile(JEREMY, VIEWER)).toBe(true)
  })

  it('refuses a regular viewer someone else’s identity', () => {
    expect(canViewRequesterProfile(SAM, VIEWER)).toBe(false)
  })

  it('lets an admin through to anyone’s identity', () => {
    expect(canViewRequesterProfile(SAM, ADMIN)).toBe(true)
  })

  // The mask is the whole point: there is no identity behind it to send
  // either viewer to, and this feed never unmasks one.
  it('refuses a masked requester, admin or not', () => {
    expect(canViewRequesterProfile(null, VIEWER)).toBe(false)
    expect(canViewRequesterProfile(null, ADMIN)).toBe(false)
  })

  it('refuses everything when there is no forwarded identity at all', () => {
    expect(canViewRequesterProfile(JEREMY, null)).toBe(false)
  })
})

describe('ActivityRequester', () => {
  it('links the viewer’s own requester cell to their account', () => {
    render(<ActivityRequester requester={JEREMY} viewer={VIEWER} />)

    for (const link of links()) {
      expect(link).toHaveAttribute('href', PROFILE_HREF)
    }
    expect(links()).not.toHaveLength(0)
    expect(screen.getByText(JEREMY.email)).toBeInTheDocument()
  })

  it('never links another user’s cell for a regular viewer', () => {
    render(<ActivityRequester requester={SAM} viewer={VIEWER} />)

    expect(links()).toHaveLength(0)
    expect(screen.getByText(SAM.email)).toBeInTheDocument()
  })

  // Now that `/profile` exists, the link is exactly as wide as the access
  // rule: an admin is sent to that person's `?user=`, a regular viewer is not
  // sent anywhere at all.
  it('links another user’s cell to their ?user= for an admin', () => {
    render(<ActivityRequester requester={SAM} viewer={ADMIN} />)

    expect(screen.getByText(SAM.email)).toBeInTheDocument()
    expect(links()).not.toHaveLength(0)
    for (const link of links()) {
      expect(link).toHaveAttribute('href', profileHrefForEmail(SAM.email))
    }
  })

  it('never sends anyone to their own profile through ?user=', () => {
    render(<ActivityRequester requester={JEREMY} viewer={ADMIN} />)

    // An admin looking at their *own* row still gets the bare route, which the
    // backend resolves to whoever is asking — not a redundant `?user=` that
    // would make one person's profile two different URLs.
    for (const link of links()) {
      expect(link).toHaveAttribute('href', PROFILE_HREF)
    }
    expect(links()).not.toHaveLength(0)
  })

  it('never links a masked requester, and leaks no initials', () => {
    render(<ActivityRequester requester={null} viewer={ADMIN} />)

    expect(links()).toHaveLength(0)
    expect(screen.getByText(MASKED_REQUESTER_LABEL)).toBeInTheDocument()
    expect(screen.getByText(MASKED_INITIALS)).toBeInTheDocument()
    expect(screen.queryByText(SAM.email)).not.toBeInTheDocument()
  })

  it('drops the name but keeps the mark when the row has no room for one', () => {
    render(<ActivityRequester nameless requester={JEREMY} viewer={VIEWER} />)

    expect(screen.queryByText(JEREMY.email)).not.toBeInTheDocument()
    expect(screen.getByTitle(JEREMY.email)).toBeInTheDocument()
  })
})

/**
 * The four states plan 017 makes this cell render, and the one rule that
 * decides between them.
 *
 * ⚠️ The pairing that matters is **masked vs. unlinked Discord**. They are the
 * two branches that both arrive with `requester === null`, they differ only by
 * `discordRequester`, and getting the order wrong would put a person's handle
 * and their raw snowflake into a cell whose whole contract is that the viewer
 * is not entitled to the identity. Every assertion about the mark below is
 * therefore made **directly** — "is there a trigger, is the snowflake anywhere
 * in this DOM" — and never inferred from the `hidden` label being present.
 */
describe('ActivityRequester · Discord attribution', () => {
  // A web job by somebody with no link: exactly what it rendered before 017.
  it('renders a web requester with no Discord furniture at all', () => {
    render(
      <ActivityRequester
        discordRequester={null}
        linkedDiscord={null}
        requester={SAM}
        viewer={ADMIN}
      />,
    )

    expect(screen.getByText(SAM.email)).toBeInTheDocument()
    expect(discordMark()).not.toBeInTheDocument()
  })

  it('shows a linked handle beside the email, with nothing to click on it', () => {
    render(
      <ActivityRequester
        linkedDiscord={LINKED_JEREMY}
        requester={JEREMY}
        viewer={VIEWER}
      />,
    )

    expect(screen.getByText(JEREMY.email)).toBeInTheDocument()
    expect(
      screen.getByText(`@${LINKED_JEREMY.discordUsername}`),
    ).toBeInTheDocument()
    // The identity affordance is inert: no disclosure popover, and therefore
    // no way for a linked account to read as an unlinked one.
    expect(discordMark()).not.toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(document.body).not.toHaveTextContent(LINKED_JEREMY.discordUserId)
  })

  // The feature, stated as a test. A job submitted over Discord by somebody
  // whose snowflake an admin has linked arrives here with `requester` already
  // filled and `discordRequester` already `null` — `AttributionResolutionService`
  // does that before serialization — so this cell cannot tell it from a web job
  // and is not supposed to be able to.
  it('draws a resolved Discord job as an identity, never as a Discord handle', () => {
    render(
      <ActivityRequester
        discordRequester={null}
        linkedDiscord={LINKED_JEREMY}
        requester={JEREMY}
        viewer={VIEWER}
      />,
    )

    expect(screen.getByText(JEREMY.email)).toBeInTheDocument()
    expect(discordMark()).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(SNOWFLAKE)
  })

  it('renders an unlinked Discord requester as its handle plus the mark', () => {
    render(
      <ActivityRequester
        discordRequester={DISCORD_SAM}
        requester={null}
        viewer={ADMIN}
      />,
    )

    expect(screen.getByText(DISCORD_SAM.discordUsername)).toBeInTheDocument()
    expect(discordMark()).toBeInTheDocument()
    // Never the masked treatment: a person asked for this download.
    expect(screen.queryByText(MASKED_REQUESTER_LABEL)).not.toBeInTheDocument()
    expect(screen.queryByText(MASKED_INITIALS)).not.toBeInTheDocument()
  })

  // `canViewRequesterProfile`/`requesterProfileHref` stay email-keyed. There is
  // no lilnas account behind this snowflake to open a profile for.
  it('offers an unlinked Discord requester no profile link, even to an admin', () => {
    render(
      <ActivityRequester
        discordRequester={DISCORD_SAM}
        requester={null}
        viewer={ADMIN}
      />,
    )

    expect(links()).toHaveLength(0)
  })

  it('keeps the mark on the nameless mobile row, where the handle cannot fit', () => {
    render(
      <ActivityRequester
        discordRequester={DISCORD_SAM}
        nameless
        requester={null}
        viewer={ADMIN}
      />,
    )

    expect(
      screen.queryByText(DISCORD_SAM.discordUsername),
    ).not.toBeInTheDocument()
    // Without it the row is an avatar with initials and nothing on screen
    // explaining whose they are.
    expect(discordMark()).toBeInTheDocument()
  })

  // ⚠️ The gate, asserted at its own level. `projectJobForViewer` nulls all
  // three identity fields together, but this component must not *depend* on
  // that: a masked cell renders no trigger and no snowflake even if a future
  // regression upstream let one through.
  it('renders no mark and no snowflake for a masked requester', () => {
    render(
      <ActivityRequester
        discordRequester={null}
        linkedDiscord={null}
        requester={null}
        viewer={ADMIN}
      />,
    )

    expect(screen.getByText(MASKED_REQUESTER_LABEL)).toBeInTheDocument()
    expect(discordMark()).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(SNOWFLAKE)
  })

  it('suppresses a linked handle behind the mask, not only a Discord requester', () => {
    render(
      <ActivityRequester
        linkedDiscord={LINKED_JEREMY}
        requester={null}
        viewer={ADMIN}
      />,
    )

    // A hidden-attribution download by a linked person must not leak the
    // person through `linkedDiscord` while `requester` is masked — the cell
    // renders `linkedDiscord` only beside an identity it was already shown.
    expect(screen.getByText(MASKED_REQUESTER_LABEL)).toBeInTheDocument()
    expect(
      screen.queryByText(`@${LINKED_JEREMY.discordUsername}`),
    ).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(LINKED_JEREMY.discordUserId)
    expect(document.body).not.toHaveTextContent(LINKED_JEREMY.discordUsername)
  })
})

const MOVIE: Media = {
  id: 'tmdb:438631',
  title: 'Salt & Ceremony',
  tmdbId: 438631,
  type: DownloadType.Movie,
}

const SHOW: Media = {
  id: 'tvdb:277165',
  title: 'Silicon Valley',
  tvdbId: 277165,
  type: DownloadType.Show,
}

const VIDEO: Media = {
  id: 'video:abc123',
  sourceUrl: 'https://youtube.com/watch?v=abc',
  title: 'Sourdough starter, day one to seven',
  type: DownloadType.Video,
}

/** The two fields `jobUpstreamSource` reads, for a job adopted from `media`'s service. */
function adopted(
  media: Media,
  startedUpstream?: boolean,
): Pick<DownloadJob, 'media' | 'startedUpstream'> {
  return { media, startedUpstream }
}

describe('jobUpstreamSource', () => {
  it('credits an adopted movie to Radarr and an adopted show to Sonarr', () => {
    expect(jobUpstreamSource(adopted(MOVIE, true))).toBe('Radarr')
    expect(jobUpstreamSource(adopted(SHOW, true))).toBe('Sonarr')
  })

  it('has no source for a job this app started', () => {
    expect(jobUpstreamSource(adopted(MOVIE))).toBeUndefined()
    expect(jobUpstreamSource(adopted(SHOW, false))).toBeUndefined()
  })

  // Nothing adopts a video; a stray flag must not invent a service for one.
  it('has no source for a video, flag or not', () => {
    expect(jobUpstreamSource(adopted(VIDEO, true))).toBeUndefined()
  })
})

// The gallery row carries the latest job's flag as `lastStartedUpstream`.
describe('galleryUpstreamSource', () => {
  it('reads the latest job’s flag off a gallery row', () => {
    expect(
      galleryUpstreamSource({ lastStartedUpstream: true, media: MOVIE }),
    ).toBe('Radarr')
    expect(
      galleryUpstreamSource({ lastStartedUpstream: true, media: SHOW }),
    ).toBe('Sonarr')
  })

  it('has no source when the flag is absent, or on a video', () => {
    expect(galleryUpstreamSource({ media: MOVIE })).toBeUndefined()
    expect(
      galleryUpstreamSource({ lastStartedUpstream: true, media: VIDEO }),
    ).toBeUndefined()
  })
})

/**
 * Plan 022: a download started in Radarr's or Sonarr's own UI arrives with the
 * same nulls as a masked one, and must never read `hidden`.
 */
describe('ActivityRequester · an adopted download', () => {
  it.each([
    ['Radarr', VIEWER],
    ['Radarr', ADMIN],
    ['Sonarr', VIEWER],
    ['Sonarr', ADMIN],
  ] as const)(
    'reads %s as a plain label, with no avatar and no link',
    (source, viewer) => {
      const { container } = render(
        <ActivityRequester
          discordRequester={null}
          linkedDiscord={null}
          requester={null}
          upstreamSource={source}
          viewer={viewer}
        />,
      )

      expect(screen.getByText(source)).toBeInTheDocument()
      expect(screen.queryByText(MASKED_REQUESTER_LABEL)).not.toBeInTheDocument()
      expect(screen.queryByText(MASKED_INITIALS)).not.toBeInTheDocument()
      expect(container.querySelector('[title]')).toBeNull()
      expect(links()).toHaveLength(0)
    },
  )

  // With no avatar to fall back on, the name is the whole cell.
  it('keeps the label on the nameless mobile row', () => {
    render(
      <ActivityRequester
        nameless
        requester={null}
        upstreamSource="Sonarr"
        viewer={VIEWER}
      />,
    )

    expect(screen.getByText('Sonarr')).toBeInTheDocument()
  })

  it('still reads a masked requester as hidden when there is no source', () => {
    render(
      <ActivityRequester
        requester={null}
        upstreamSource={undefined}
        viewer={VIEWER}
      />,
    )

    expect(screen.getByText(MASKED_REQUESTER_LABEL)).toBeInTheDocument()
  })

  // A job with both can't be stored (the `origin` CHECK), but an identity
  // outranks a service if one ever arrives.
  it('lets a requester or a Discord submitter win over the source', () => {
    const { unmount } = render(
      <ActivityRequester
        requester={SAM}
        upstreamSource="Radarr"
        viewer={VIEWER}
      />,
    )

    expect(screen.getByText(SAM.email)).toBeInTheDocument()
    expect(screen.queryByText('Radarr')).not.toBeInTheDocument()
    unmount()

    render(
      <ActivityRequester
        discordRequester={DISCORD_SAM}
        requester={null}
        upstreamSource="Radarr"
        viewer={VIEWER}
      />,
    )

    expect(screen.getByText(DISCORD_SAM.discordUsername)).toBeInTheDocument()
    expect(screen.queryByText('Radarr')).not.toBeInTheDocument()
  })
})
