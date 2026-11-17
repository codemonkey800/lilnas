import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import GalleryError from 'src/app/gallery/error'

describe('GalleryError', () => {
  it('titles the page, and says the library is safe', () => {
    render(<GalleryError error={new Error('boom')} reset={jest.fn()} />)

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'The gallery didn’t load',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Your library is safe')
  })

  it('offers exactly one action, which re-runs the segment', async () => {
    const reset = jest.fn()
    const user = userEvent.setup()
    render(<GalleryError error={new Error('boom')} reset={reset} />)

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('keeps the digest line when Next sent one', () => {
    const error = Object.assign(new Error('boom'), { digest: '3482910274' })
    render(<GalleryError error={error} reset={jest.fn()} />)

    expect(screen.getByText('digest 3482910274')).toBeInTheDocument()
  })
})
