import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import MovieError from 'src/app/movies/[tmdbId]/error'

function boundaryError(digest?: string): Error & { digest?: string } {
  return Object.assign(new Error('getaddrinfo ENOTFOUND download'), { digest })
}

describe('MovieError', () => {
  it('says what failed without blaming the movie', () => {
    render(<MovieError error={boundaryError()} reset={jest.fn()} />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'This movie could not be loaded',
      }),
    ).toBeInTheDocument()
  })

  it('never renders the thrown message', () => {
    const { container } = render(
      <MovieError error={boundaryError()} reset={jest.fn()} />,
    )

    // Production replaces it with a generic string and development makes it
    // a stack trace's first line — an internal detail either way.
    expect(container.textContent).not.toContain('ENOTFOUND')
  })

  it('renders the digest, which is what correlates this with the server log', () => {
    render(<MovieError error={boundaryError('a1b2c3')} reset={jest.fn()} />)

    expect(screen.getByText(/a1b2c3/)).toBeInTheDocument()
  })

  it('renders no reference line when there is no digest', () => {
    render(<MovieError error={boundaryError()} reset={jest.fn()} />)

    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument()
  })

  it('re-runs the segment on "Try again"', async () => {
    const user = userEvent.setup()
    const reset = jest.fn()

    render(<MovieError error={boundaryError()} reset={reset} />)
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('keeps a way back to the library', () => {
    render(<MovieError error={boundaryError()} reset={jest.fn()} />)

    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute(
      'href',
      '/gallery',
    )
  })
})
