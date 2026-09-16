import '@testing-library/jest-dom'

import type { JobRequester } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'

import {
  ActivityRequester,
  canViewRequesterProfile,
  MASKED_REQUESTER_LABEL,
} from 'src/components/activity/activity-requester'
import { ACCOUNT_HREF } from 'src/components/shell/account-link'
import { MASKED_INITIALS } from 'src/components/ui/avatar'
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
      expect(link).toHaveAttribute('href', ACCOUNT_HREF)
    }
    expect(links()).not.toHaveLength(0)
    expect(screen.getByText(JEREMY.email)).toBeInTheDocument()
  })

  it('never links another user’s cell for a regular viewer', () => {
    render(<ActivityRequester requester={SAM} viewer={VIEWER} />)

    expect(links()).toHaveLength(0)
    expect(screen.getByText(SAM.email)).toBeInTheDocument()
  })

  // An admin is allowed through by the access rule; there is simply no route
  // to send them to yet, so no link is emitted rather than a link that 404s.
  it('shows an admin the true requester inline, unlinked for now', () => {
    render(<ActivityRequester requester={SAM} viewer={ADMIN} />)

    expect(screen.getByText(SAM.email)).toBeInTheDocument()
    expect(links()).toHaveLength(0)
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
