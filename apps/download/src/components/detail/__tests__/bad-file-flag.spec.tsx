import '@testing-library/jest-dom'

import type { BadFile } from '@lilnas/utils/download/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  BadFileFlag,
  REPORT_LABEL,
  REPORT_PROMPT,
  REPORT_PROMPT_EPISODE,
  REPORT_REASONS,
  REPORT_REASONS_EPISODE,
  REPORT_SCOPE_CAVEAT,
  REPORTED_LABEL,
  SUBMIT_REPORT_LABEL,
  UNDO_REPORT_LABEL,
} from 'src/components/detail/bad-file-flag'

const MEDIA_ID = 'tmdb:438631'

const RELEASE = {
  guid: 'guid-bad',
  indexerId: 5,
  title: 'Dune.2021.720p.HDTV.x264',
}

/**
 * What the idempotent endpoint hands back: the *original* row, whether this is
 * the first report or the fifth. `createdAt` is deliberately old — a re-flag
 * does not refresh it, which is exactly why the component must not try to
 * detect "already reported" from a timestamp.
 */
const ORIGINAL_ROW: BadFile = {
  createdAt: '2026-09-01T09:30:00.000Z',
  flaggedBy: { email: 'jeremy@lilnas.io', userId: 'u_1' },
  id: 7,
  indexerId: 5,
  mediaId: MEDIA_ID,
  reason: "Video won't play",
  releaseGuid: 'guid-bad',
  releaseTitle: RELEASE.title,
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: REPORT_LABEL })
}

function submit(): HTMLElement {
  return screen.getByRole('button', { name: SUBMIT_REPORT_LABEL })
}

describe('BadFileFlag — the dialog', () => {
  it('opens only on a press, never on render', async () => {
    const user = userEvent.setup()

    render(
      <BadFileFlag mediaId={MEDIA_ID} release={RELEASE} onFlag={jest.fn()} />,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(trigger())

    expect(screen.getByRole('dialog')).toHaveAccessibleName(REPORT_PROMPT)
  })

  it('offers the movie reason list, with the first one already chosen', async () => {
    const user = userEvent.setup()

    render(
      <BadFileFlag mediaId={MEDIA_ID} release={RELEASE} onFlag={jest.fn()} />,
    )
    await user.click(trigger())

    const reasons = screen.getAllByRole('radio')

    expect(reasons.map(entry => entry.textContent)).toEqual([...REPORT_REASONS])
    expect(reasons[0]).toHaveAttribute('aria-checked', 'true')
  })

  it('takes the show heading and reason list when a show passes them', async () => {
    const user = userEvent.setup()

    render(
      <BadFileFlag
        mediaId="tvdb:121361"
        prompt={REPORT_PROMPT_EPISODE}
        reasons={REPORT_REASONS_EPISODE}
        release={RELEASE}
        onFlag={jest.fn()}
      />,
    )
    await user.click(trigger())

    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      REPORT_PROMPT_EPISODE,
    )
    expect(
      screen.getByRole('radio', { name: 'Wrong episode' }),
    ).toBeInTheDocument()
  })

  it('names the radiogroup, which ReasonGroup cannot do for itself', async () => {
    const user = userEvent.setup()

    render(
      <BadFileFlag mediaId={MEDIA_ID} release={RELEASE} onFlag={jest.fn()} />,
    )
    await user.click(trigger())

    expect(screen.getByRole('radiogroup')).toHaveAccessibleName(REPORT_PROMPT)
  })

  it('⚠️ states the in-app-only scope BEFORE the user submits', async () => {
    // The mockup's storyboard caption ("This release won't be auto-picked
    // again") overstates the guarantee. The flag lives in this app's
    // `bad_files` table; Radarr and Sonarr can still grab the release from
    // their own UIs. Said up front, where it can still change the answer.
    const user = userEvent.setup()

    render(
      <BadFileFlag mediaId={MEDIA_ID} release={RELEASE} onFlag={jest.fn()} />,
    )
    await user.click(trigger())

    const caveat = screen.getByText(REPORT_SCOPE_CAVEAT)

    expect(caveat).toBeInTheDocument()
    expect(REPORT_SCOPE_CAVEAT).toMatch(/Radarr and Sonarr can still grab it/)
    expect(REPORT_SCOPE_CAVEAT).not.toMatch(/never|blocked everywhere/i)
  })

  it('cancels without reporting anything', async () => {
    const user = userEvent.setup()
    const onFlag = jest.fn()

    render(<BadFileFlag mediaId={MEDIA_ID} release={RELEASE} onFlag={onFlag} />)
    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onFlag).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('BadFileFlag — submitting', () => {
  it('sends the chosen reason and the denormalized release copies', async () => {
    const user = userEvent.setup()
    const onFlag = jest.fn().mockResolvedValue({ badFile: ORIGINAL_ROW })

    render(<BadFileFlag mediaId={MEDIA_ID} release={RELEASE} onFlag={onFlag} />)
    await user.click(trigger())
    await user.click(screen.getByRole('radio', { name: "Video won't play" }))
    await user.click(submit())

    expect(onFlag).toHaveBeenCalledWith(MEDIA_ID, {
      guid: 'guid-bad',
      indexerId: 5,
      reason: "Video won't play",
      title: RELEASE.title,
    })
  })

  it('settles in place as a `reported` chip with the caveat', async () => {
    const user = userEvent.setup()

    render(
      <BadFileFlag
        mediaId={MEDIA_ID}
        release={RELEASE}
        onFlag={jest.fn().mockResolvedValue({ badFile: ORIGINAL_ROW })}
      />,
    )
    await user.click(trigger())
    await user.click(submit())

    expect(await screen.findByText(REPORTED_LABEL)).toBeInTheDocument()
    expect(screen.getByText(REPORT_SCOPE_CAVEAT)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders a real failure as copy and keeps the dialog open', async () => {
    const user = userEvent.setup()

    render(
      <BadFileFlag
        mediaId={MEDIA_ID}
        release={RELEASE}
        onFlag={jest
          .fn()
          .mockResolvedValue({ error: 'Could not send that report' })}
      />,
    )
    await user.click(trigger())
    await user.click(submit())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not send that report',
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('BadFileFlag — a repeat report is a SUCCESS', () => {
  it('reports twice through one component and never calls it an error', async () => {
    // ⚠️ `POST …/bad-files` is idempotent on `(mediaId, releaseGuid)`: a second
    // report answers with the ORIGINAL row rather than a 409. The round trip
    // here is report → undo → report, which is the only way one mounted
    // component can genuinely flag the same guid twice, and the spy answers
    // with the identical row both times, exactly as the backend does.
    const user = userEvent.setup()
    const onFlag = jest.fn().mockResolvedValue({ badFile: ORIGINAL_ROW })
    const onUnflag = jest.fn().mockResolvedValue({ badFile: ORIGINAL_ROW })

    render(
      <BadFileFlag
        mediaId={MEDIA_ID}
        release={RELEASE}
        onFlag={onFlag}
        onUnflag={onUnflag}
      />,
    )

    await user.click(trigger())
    await user.click(submit())
    expect(await screen.findByText(REPORTED_LABEL)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: UNDO_REPORT_LABEL }))

    await user.click(await screen.findByRole('button', { name: REPORT_LABEL }))
    await user.click(submit())

    expect(onFlag).toHaveBeenCalledTimes(2)
    expect(onFlag.mock.calls[0]).toEqual(onFlag.mock.calls[1])
    expect(await screen.findByText(REPORTED_LABEL)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('treats an already-flagged release as reported, with no second trigger at all', async () => {
    // The structural half of the same guarantee: when the page already knows
    // about the flag, there is nothing to double-click.
    render(
      <BadFileFlag
        flag={ORIGINAL_ROW}
        mediaId={MEDIA_ID}
        release={RELEASE}
        onFlag={jest.fn()}
      />,
    )

    expect(screen.getByText(REPORTED_LABEL)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: REPORT_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('accepts an action that resolves with nothing as a success too', async () => {
    const user = userEvent.setup()

    render(
      <BadFileFlag
        mediaId={MEDIA_ID}
        release={RELEASE}
        onFlag={jest.fn().mockResolvedValue(undefined)}
      />,
    )
    await user.click(trigger())
    await user.click(submit())

    expect(await screen.findByText(REPORTED_LABEL)).toBeInTheDocument()
  })
})

describe('BadFileFlag — undo', () => {
  it('offers no undo when the page supplied no unflag action', () => {
    render(
      <BadFileFlag
        flag={ORIGINAL_ROW}
        mediaId={MEDIA_ID}
        release={RELEASE}
        onFlag={jest.fn()}
      />,
    )

    expect(
      screen.queryByRole('button', { name: UNDO_REPORT_LABEL }),
    ).not.toBeInTheDocument()
  })

  it('addresses the flag by its row id', async () => {
    const user = userEvent.setup()
    const onUnflag = jest.fn().mockResolvedValue({ badFile: ORIGINAL_ROW })

    render(
      <BadFileFlag
        flag={ORIGINAL_ROW}
        mediaId={MEDIA_ID}
        release={RELEASE}
        onFlag={jest.fn()}
        onUnflag={onUnflag}
      />,
    )

    await user.click(screen.getByRole('button', { name: UNDO_REPORT_LABEL }))

    expect(onUnflag).toHaveBeenCalledWith(MEDIA_ID, ORIGINAL_ROW.id)
  })
})

/**
 * As in `delete-confirm.spec.tsx`, the trap itself belongs to `Modal` and is
 * proved there. This covers the wiring, plus the one thing this dialog has
 * that the delete one does not: a roving `ReasonGroup` inside the trap. A
 * roving group is deliberately a *single* tab stop, so Tab has to step over
 * the unchecked reasons rather than through them — the two focus models have
 * to compose, and nothing else in the app puts them together.
 */
describe('BadFileFlag — focus containment', () => {
  async function raise() {
    const user = userEvent.setup()

    render(
      <BadFileFlag mediaId={MEDIA_ID} release={RELEASE} onFlag={jest.fn()} />,
    )

    const opener = trigger()

    await user.click(opener)

    return { opener, user }
  }

  function cancel(): HTMLElement {
    return screen.getByRole('button', { name: 'Cancel' })
  }

  it('moves focus into the panel, onto the reason already chosen', async () => {
    await raise()

    expect(screen.getAllByRole('radio')[0]).toHaveFocus()
  })

  it('shuts the page behind out of the accessibility tree', async () => {
    const { opener } = await raise()

    const shut = opener.closest('[inert]')

    expect(shut).not.toBeNull()
    expect(shut).toHaveAttribute('aria-hidden', 'true')
  })

  it('steps Tab over the roving group, not through it', async () => {
    const { user } = await raise()

    const reasons = screen.getAllByRole('radio')

    expect(reasons.length).toBeGreaterThan(1)
    expect(reasons[0]).toHaveFocus()

    // One Tab leaves the whole group behind. If the unchecked reasons were
    // ordinary tab stops this would land on the second radio instead.
    await user.tab()
    expect(cancel()).toHaveFocus()

    await user.tab()
    expect(submit()).toHaveFocus()

    // ...and off the last control, back to the first, never onto the page.
    await user.tab()
    expect(reasons[0]).toHaveFocus()
  })

  it('cycles Shift+Tab backwards through the same three stops', async () => {
    const { user } = await raise()

    const reasons = screen.getAllByRole('radio')

    await user.tab({ shift: true })
    expect(submit()).toHaveFocus()

    await user.tab({ shift: true })
    expect(cancel()).toHaveFocus()

    await user.tab({ shift: true })
    expect(reasons[0]).toHaveFocus()
  })

  it('closes on Escape and hands focus back to the trigger', async () => {
    const { opener, user } = await raise()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('hands focus back on Cancel too', async () => {
    const { opener, user } = await raise()

    await user.click(cancel())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
