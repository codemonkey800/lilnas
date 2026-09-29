import '@testing-library/jest-dom'

import { QualityTier } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  MOVIE_REQUEST_LABEL,
  MovieRequestButton,
} from 'src/components/detail/movie-request-button'

const MOVIE_ID = 'tmdb:438631'

/** The Download press — the picker's trigger is a button too. */
function downloadButton(): HTMLElement {
  return screen.getByRole('button', { name: MOVIE_REQUEST_LABEL })
}

/** The tier picker's trigger, whatever tier it reads. */
function tierTrigger(): HTMLElement {
  return screen.getByRole('button', { name: /^Quality:/ })
}

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

  it('⚠️ passes the unchanged media key, with the default tier beside it', async () => {
    const { onRequest, user } = renderButton()

    await user.click(downloadButton())

    expect(onRequest).toHaveBeenCalledWith(MOVIE_ID, QualityTier.Hd)
  })

  it('puts the tier picker in front of the button', () => {
    renderButton()

    expect(tierTrigger().compareDocumentPosition(downloadButton())).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('preselects HD for a movie with no tier the app manages', () => {
    render(<MovieRequestButton defaultQualityTier={null} mediaId={MOVIE_ID} />)

    expect(tierTrigger()).toHaveAccessibleName('Quality: HD (up to 1080p)')
  })

  it('preselects the movie’s own tier', () => {
    render(
      <MovieRequestButton
        defaultQualityTier={QualityTier.UpTo4k}
        mediaId={MOVIE_ID}
      />,
    )

    expect(tierTrigger()).toHaveAccessibleName('Quality: Up to 4K')
  })

  it('sends the tier picked beside it', async () => {
    const { onRequest, user } = renderButton()

    await user.click(tierTrigger())
    await user.click(screen.getByRole('option', { name: 'Up to 4K' }))
    await user.click(downloadButton())

    expect(onRequest).toHaveBeenCalledWith(MOVIE_ID, QualityTier.UpTo4k)
  })

  it('does not request anything when only the tier changes', async () => {
    const { onRequest, user } = renderButton()

    await user.click(tierTrigger())
    await user.click(screen.getByRole('option', { name: 'Up to 720p' }))

    expect(onRequest).not.toHaveBeenCalled()
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

    await user.click(downloadButton())

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not start that download',
    )
  })

  it('stays quiet on success', async () => {
    const { user } = renderButton(
      jest.fn().mockResolvedValue({ job: { id: 'job_1' } }),
    )

    await user.click(downloadButton())

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is inert without a handler rather than throwing', async () => {
    render(<MovieRequestButton mediaId={MOVIE_ID} />)

    const user = userEvent.setup()
    await user.click(downloadButton())

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stretches both the root and the trigger under `full`', () => {
    const { container } = render(<MovieRequestButton full mediaId={MOVIE_ID} />)

    // The rendered class attribute, never the string handed to `cns` -
    // twMerge reshapes the list afterwards.
    expect(container.firstElementChild?.getAttribute('class')).toContain(
      'w-full',
    )
    expect(downloadButton().getAttribute('class')).toContain('w-full')
  })
})
