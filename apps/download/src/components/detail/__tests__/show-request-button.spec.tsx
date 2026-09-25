import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SHOW_ID } from 'src/components/detail/__tests__/fixtures/show'
import type { ShowRequestTarget } from 'src/components/detail/show-request-button'
import {
  REQUEST_EPISODE_LABEL,
  REQUEST_SEASON_LABEL,
  REQUEST_SERIES_LABEL,
  ShowRequestButton,
  showRequestScope,
} from 'src/components/detail/show-request-button'

const SERIES: ShowRequestTarget = { kind: 'series' }
const SEASON: ShowRequestTarget = { kind: 'season', seasonNumber: 2 }
const SPECIALS: ShowRequestTarget = { kind: 'season', seasonNumber: 0 }
const EPISODE: ShowRequestTarget = { episodeId: 4823, kind: 'episode' }

function renderButton(
  target: ShowRequestTarget,
  onRequest = jest.fn().mockResolvedValue(undefined),
) {
  render(
    <ShowRequestButton
      mediaId={SHOW_ID}
      target={target}
      onRequest={onRequest}
    />,
  )

  return { onRequest, user: userEvent.setup() }
}

describe('showRequestScope', () => {
  it("scopes an episode by Sonarr's id, and nothing else", () => {
    expect(showRequestScope(EPISODE)).toEqual({ episodeId: 4823 })
  })

  it('scopes a season by its number, and nothing else', () => {
    expect(showRequestScope(SEASON)).toEqual({ seasonNumber: 2 })
  })

  it('⚠️ keeps season 0, which a truthiness check would have dropped', () => {
    expect(showRequestScope(SPECIALS)).toEqual({ seasonNumber: 0 })
  })

  it('⚠️ sends the EMPTY scope for a series, which the backend reads as "everything"', () => {
    // The widest request is spelled by an absence, which is exactly why this
    // function exists rather than eight call sites assembling one by hand.
    expect(showRequestScope(SERIES)).toEqual({})
  })
})

describe('ShowRequestButton', () => {
  it.each([
    ['series', SERIES, REQUEST_SERIES_LABEL],
    ['season', SEASON, REQUEST_SEASON_LABEL],
    ['episode', EPISODE, REQUEST_EPISODE_LABEL],
  ])('labels a %s request', (_name, target, label) => {
    renderButton(target as ShowRequestTarget)

    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  })

  it('takes a label override, so a season can name itself', () => {
    render(
      <ShowRequestButton
        label="Download specials"
        mediaId={SHOW_ID}
        target={SPECIALS}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Download specials' }),
    ).toBeInTheDocument()
  })

  it('⚠️ passes the unchanged media key, with the scope beside it', async () => {
    const { onRequest, user } = renderButton(EPISODE)

    await user.click(screen.getByRole('button'))

    expect(onRequest).toHaveBeenCalledWith(SHOW_ID, { episodeId: 4823 })
  })

  it('does nothing at all until it is pressed', () => {
    const { onRequest } = renderButton(SERIES)

    // ⚠️ This writes to the real Sonarr library. Nothing speculative, ever.
    expect(onRequest).not.toHaveBeenCalled()
  })

  it('renders a refusal next to the button rather than throwing it upward', async () => {
    const { user } = renderButton(
      SERIES,
      jest.fn().mockResolvedValue({ error: 'Could not start that download' }),
    )

    await user.click(screen.getByRole('button'))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not start that download',
    )
  })

  it('stays quiet on success', async () => {
    const { user } = renderButton(
      SERIES,
      jest.fn().mockResolvedValue({ job: { id: 'job_1' } }),
    )

    await user.click(screen.getByRole('button'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is inert without a handler rather than throwing', async () => {
    render(<ShowRequestButton mediaId={SHOW_ID} target={SERIES} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('stretches both the root and the trigger under `full`', () => {
    const { container } = render(
      <ShowRequestButton full mediaId={SHOW_ID} target={SERIES} />,
    )

    // The rendered class attribute, never the string handed to `cns` -
    // twMerge reshapes the list afterwards.
    expect(container.firstElementChild?.getAttribute('class')).toContain(
      'w-full',
    )
    expect(screen.getByRole('button').getAttribute('class')).toContain('w-full')
  })
})
