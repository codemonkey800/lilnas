import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  MOVIE_REQUEST_LABEL,
  MovieRequestButton,
} from 'src/components/detail/movie-request-button'

const MOVIE_ID = 'tmdb:438631'

function renderButton(onRequest = jest.fn().mockResolvedValue(undefined)) {
  render(<MovieRequestButton mediaId={MOVIE_ID} onRequest={onRequest} />)

  return { onRequest, user: userEvent.setup() }
}

describe('MovieRequestButton', () => {
  it('labels the trigger', () => {
    renderButton()

    expect(
      screen.getByRole('button', { name: MOVIE_REQUEST_LABEL }),
    ).toBeInTheDocument()
  })

  it('⚠️ passes the unchanged media key, and nothing else', async () => {
    const { onRequest, user } = renderButton()

    await user.click(screen.getByRole('button'))

    expect(onRequest).toHaveBeenCalledWith(MOVIE_ID)
  })

  it('does nothing at all until it is pressed', () => {
    const { onRequest } = renderButton()

    // ⚠️ This writes to the real Radarr library. Nothing speculative, ever.
    expect(onRequest).not.toHaveBeenCalled()
  })

  it('renders a refusal next to the button rather than throwing it upward', async () => {
    const { user } = renderButton(
      jest.fn().mockResolvedValue({ error: 'Could not start that download' }),
    )

    await user.click(screen.getByRole('button'))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not start that download',
    )
  })

  it('stays quiet on success', async () => {
    const { user } = renderButton(
      jest.fn().mockResolvedValue({ job: { id: 'job_1' } }),
    )

    await user.click(screen.getByRole('button'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is inert without a handler rather than throwing', async () => {
    render(<MovieRequestButton mediaId={MOVIE_ID} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stretches both the root and the trigger under `full`', () => {
    const { container } = render(<MovieRequestButton full mediaId={MOVIE_ID} />)

    // The rendered class attribute, never the string handed to `cns` -
    // twMerge reshapes the list afterwards.
    expect(container.firstElementChild?.getAttribute('class')).toContain(
      'w-full',
    )
    expect(screen.getByRole('button').getAttribute('class')).toContain('w-full')
  })
})
