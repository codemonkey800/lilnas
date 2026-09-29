import '@testing-library/jest-dom'

import { QualityTier } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { SHOW_ID } from 'src/components/detail/__tests__/fixtures/show'
import type { ShowRequestTarget } from 'src/components/detail/show-request-button'
import {
  REQUEST_EPISODE_LABEL,
  REQUEST_SEASON_LABEL,
  REQUEST_SERIES_LABEL,
  SHOW_QUALITY_TIER_HINT,
  ShowRequestButton,
  showRequestScope,
} from 'src/components/detail/show-request-button'

const SERIES: ShowRequestTarget = { kind: 'series' }
const SEASON: ShowRequestTarget = { kind: 'season', seasonNumber: 2 }
const SPECIALS: ShowRequestTarget = { kind: 'season', seasonNumber: 0 }
const EPISODE: ShowRequestTarget = { episodeId: 4823, kind: 'episode' }

/** The tier picker's trigger, whatever tier it reads. */
function tierTrigger(): HTMLElement {
  return screen.getByRole('button', { name: /^Quality:/ })
}

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

  describe('the quality tier picker', () => {
    it('sits in front of the series button, with the whole-show hint', () => {
      renderButton(SERIES)

      expect(tierTrigger()).toHaveAccessibleDescription(SHOW_QUALITY_TIER_HINT)
      expect(
        tierTrigger().compareDocumentPosition(
          screen.getByRole('button', { name: REQUEST_SERIES_LABEL }),
        ),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })

    it.each([
      ['season', SEASON],
      ['episode', EPISODE],
    ])('⚠️ is never drawn on a %s button', (_name, target) => {
      renderButton(target as ShowRequestTarget)

      // Sonarr keeps one profile per series — a picker per row would be a
      // choice that silently rewrites the whole show.
      expect(
        screen.queryByRole('button', { name: /^Quality:/ }),
      ).not.toBeInTheDocument()
      expect(screen.queryByText(SHOW_QUALITY_TIER_HINT)).not.toBeInTheDocument()
      expect(screen.getAllByRole('button')).toHaveLength(1)
    })

    it('preselects HD for a show with no tier the app manages', () => {
      render(
        <ShowRequestButton
          defaultQualityTier={null}
          mediaId={SHOW_ID}
          target={SERIES}
        />,
      )

      expect(tierTrigger()).toHaveAccessibleName('Quality: HD (up to 1080p)')
    })

    it('preselects the show’s own tier', () => {
      render(
        <ShowRequestButton
          defaultQualityTier={QualityTier.UpTo720p}
          mediaId={SHOW_ID}
          target={SERIES}
        />,
      )

      expect(tierTrigger()).toHaveAccessibleName('Quality: Up to 720p')
    })

    it('sends the empty scope in the default tier', async () => {
      const { onRequest, user } = renderButton(SERIES)

      await user.click(
        screen.getByRole('button', { name: REQUEST_SERIES_LABEL }),
      )

      expect(onRequest).toHaveBeenCalledWith(SHOW_ID, {}, QualityTier.Hd)
    })

    it('sends the tier picked beside it, and reports the pick', async () => {
      const onQualityTierChange = jest.fn()
      const onRequest = jest.fn().mockResolvedValue(undefined)
      render(
        <ShowRequestButton
          mediaId={SHOW_ID}
          target={SERIES}
          onQualityTierChange={onQualityTierChange}
          onRequest={onRequest}
        />,
      )
      const user = userEvent.setup()

      await user.click(tierTrigger())
      await user.click(screen.getByRole('option', { name: 'Up to 4K' }))

      expect(onQualityTierChange).toHaveBeenCalledWith(QualityTier.UpTo4k)
      expect(onRequest).not.toHaveBeenCalled()

      await user.click(
        screen.getByRole('button', { name: REQUEST_SERIES_LABEL }),
      )

      expect(onRequest).toHaveBeenCalledWith(SHOW_ID, {}, QualityTier.UpTo4k)
    })

    it('follows a controlling `qualityTier` over its own state', () => {
      render(
        <ShowRequestButton
          defaultQualityTier={QualityTier.Hd}
          mediaId={SHOW_ID}
          qualityTier={QualityTier.UpTo4k}
          target={SERIES}
        />,
      )

      expect(tierTrigger()).toHaveAccessibleName('Quality: Up to 4K')
    })

    it.each([
      ['season', SEASON, { seasonNumber: 2 }],
      ['episode', EPISODE, { episodeId: 4823 }],
    ])(
      'sends a %s request with the scope alone — the tier is the parent’s to add',
      async (_name, target, scope) => {
        const { onRequest, user } = renderButton(target as ShowRequestTarget)

        await user.click(screen.getByRole('button'))

        expect(onRequest).toHaveBeenCalledWith(SHOW_ID, scope)
        expect(onRequest.mock.calls[0]).toHaveLength(2)
      },
    )
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

    await user.click(screen.getByRole('button', { name: REQUEST_SERIES_LABEL }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not start that download',
    )
  })

  it('stays quiet on success', async () => {
    const { user } = renderButton(
      SERIES,
      jest.fn().mockResolvedValue({ job: { id: 'job_1' } }),
    )

    await user.click(screen.getByRole('button', { name: REQUEST_SERIES_LABEL }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('is inert without a handler rather than throwing', async () => {
    render(<ShowRequestButton mediaId={SHOW_ID} target={SERIES} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: REQUEST_SERIES_LABEL }))

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
    expect(
      screen
        .getByRole('button', { name: REQUEST_SERIES_LABEL })
        .getAttribute('class'),
    ).toContain('w-full')
  })
})
