import { fireEvent, render, screen } from '@testing-library/react'

import RootError from 'src/app/error'

let consoleError: jest.SpyInstance

beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('RootError', () => {
  it('shows the themed heading and the error message in a bad note with an icon', () => {
    render(<RootError error={new Error('backend is down')} reset={jest.fn()} />)

    expect(
      screen.getByRole('heading', { name: 'Couldn’t load your account' }),
    ).toBeInTheDocument()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('The page didn’t load.')
    expect(alert).toHaveTextContent('backend is down')
    expect(alert.querySelector('svg')).not.toBeNull()
  })

  it('falls back to a generic message when the error has none', () => {
    render(<RootError error={new Error('')} reset={jest.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'An unexpected error occurred.',
    )
  })

  it('shows the digest in mono when one is set', () => {
    const error = Object.assign(new Error('boom'), { digest: 'abc123' })
    render(<RootError error={error} reset={jest.fn()} />)

    const digest = screen.getByText('digest abc123')
    expect(digest).toHaveClass('font-mono', 'text-mono-sm', 'text-ink-3')
  })

  it('hides the digest when there is none', () => {
    render(<RootError error={new Error('boom')} reset={jest.fn()} />)

    expect(screen.queryByText(/digest/)).not.toBeInTheDocument()
  })

  it('logs the error', () => {
    const error = new Error('boom')
    render(<RootError error={error} reset={jest.fn()} />)

    expect(consoleError).toHaveBeenCalledWith(error)
  })

  it('Try again calls reset', () => {
    const reset = jest.fn()
    render(<RootError error={new Error('boom')} reset={reset} />)

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(reset).toHaveBeenCalledTimes(1)
  })
})
