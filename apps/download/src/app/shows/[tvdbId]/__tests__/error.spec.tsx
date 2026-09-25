import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import ShowError from 'src/app/shows/[tvdbId]/error'
import { LIBRARY_HREF } from 'src/components/detail/library-link'

function renderError(error: Error & { digest?: string }) {
  const reset = jest.fn()

  render(<ShowError error={error} reset={reset} />)

  return { reset, user: userEvent.setup() }
}

describe('ShowError', () => {
  it('says what failed without claiming anything was lost', () => {
    renderError(new Error('boom'))

    expect(
      screen.getByText('This show could not be loaded'),
    ).toBeInTheDocument()
    expect(screen.getByText(/trying again is safe/)).toBeInTheDocument()
  })

  it('⚠️ never renders the message - a digest is the only useful half', () => {
    // Production replaces `message` with a generic string anyway; in dev it is a
    // stack trace's first line. Either way it is an internal detail.
    renderError(
      Object.assign(new Error('ECONNREFUSED 127.0.0.1:8081'), {
        digest: '1234567890',
      }),
    )

    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument()
    expect(screen.getByText('Reference 1234567890')).toBeInTheDocument()
  })

  it('omits the reference line when there is no digest', () => {
    renderError(new Error('boom'))

    expect(screen.queryByText(/^Reference /)).not.toBeInTheDocument()
  })

  it('leaves a way out rather than stranding the reader', () => {
    renderError(new Error('boom'))

    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute(
      'href',
      LIBRARY_HREF,
    )
  })

  it('re-runs the segment on request', async () => {
    const { reset, user } = renderError(new Error('boom'))

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('occupies the same column the page does', () => {
    renderError(new Error('boom'))

    expect(
      screen.getByRole('main').firstElementChild?.getAttribute('class'),
    ).toBe('mx-auto max-w-[1080px]')
  })
})
