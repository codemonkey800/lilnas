import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import HomeError from 'src/app/error'

describe('HomeError', () => {
  it('titles the page, then says what broke in a bad note', () => {
    render(<HomeError error={new Error('boom')} reset={jest.fn()} />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'The library didn’t load',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The download service didn’t answer.',
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/try again in a minute/)
  })

  it('offers exactly one action, which re-runs the segment', async () => {
    const reset = jest.fn()
    const user = userEvent.setup()
    render(<HomeError error={new Error('boom')} reset={reset} />)

    expect(screen.getAllByRole('button')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('keeps the digest line, in mono, beside the button', () => {
    const error = Object.assign(new Error('boom'), { digest: '3482910274' })
    render(<HomeError error={error} reset={jest.fn()} />)

    expect(screen.getByText('digest 3482910274')).toHaveClass('font-mono')
  })

  it('draws no digest line when Next sent none', () => {
    render(<HomeError error={new Error('boom')} reset={jest.fn()} />)

    expect(screen.queryByText(/digest/)).toBeNull()
  })
})
