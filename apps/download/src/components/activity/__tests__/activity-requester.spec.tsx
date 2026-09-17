import '@testing-library/jest-dom'

import type { JobRequester } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import {
  ActivityRequester,
  canViewRequesterProfile,
  MASKED_REQUESTER_LABEL,
} from 'src/components/activity/activity-requester'
import { MASKED_INITIALS } from 'src/components/ui/avatar'
import { PROFILE_HREF, profileHrefForEmail } from 'src/lib/profile-filters'
import type { Viewer } from 'src/lib/viewer'

const JEREMY: JobRequester = { email: 'jeremy@lilnas.io', userId: 'u_jeremy' }
const SAM: JobRequester = { email: 'sam@lilnas.io', userId: 'u_sam' }

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
