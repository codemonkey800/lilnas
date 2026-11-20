import { act, render, screen } from '@testing-library/react'

import { Finishing } from 'src/components/steps/finishing'
import { Indexing } from 'src/components/steps/indexing'
import { Queued } from 'src/components/steps/queued'
import { makeActions } from 'src/lib/__tests__/helpers/actions'
import { makeJob, makeView } from 'src/lib/__tests__/helpers/view'

describe('Queued', () => {
  it('says the backup is waiting for a slot', () => {
    render(<Queued />)

    expect(
      screen.getByRole('heading', { name: 'Your backup is in line' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Two backups run at a time/)).toBeInTheDocument()
    expect(screen.getByText(/You can close this tab/)).toBeInTheDocument()
  })
})

describe('Finishing', () => {
  it('says the Immich account and library are being created', () => {
    render(<Finishing />)

    expect(
      screen.getByRole('heading', { name: 'Setting up your photos' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Creating your Immich account', { selector: 'span' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Creating your library')).toBeInTheDocument()
  })
})

describe('Indexing', () => {
  const NOW = Date.parse('2026-11-19T10:00:00.000Z')

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function indexingView(retryAt: string | null) {
    return {
      ...makeView('indexing_wait'),
      job: makeJob('indexing_wait', { attempt: 2, maxAttempts: 6, retryAt }),
    }
  }

  it('shows the attempt and a bar for it', () => {
    const view = indexingView(new Date(NOW + 120_000).toISOString())
    render(<Indexing actions={makeActions(view)} view={view} />)

    expect(
      screen.getByRole('heading', {
        name: 'Apple is still preparing your library',
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('Attempt 2 of 6')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Attempts so far' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '6')
  })

  it('counts down to the retry as time passes', () => {
    const view = indexingView(new Date(NOW + 65_000).toISOString())
    render(<Indexing actions={makeActions(view)} view={view} />)
    expect(screen.getByText('Trying again in 1:05.')).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(5000)
    })
    expect(screen.getByText('Trying again in 1:00.')).toBeInTheDocument()

    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(screen.getByText('Trying again now.')).toBeInTheDocument()
  })

  it('says "soon" when there is no retry time', () => {
    const view = indexingView(null)
    render(<Indexing actions={makeActions(view)} view={view} />)

    expect(screen.getByText('Trying again soon.')).toBeInTheDocument()
  })
})
