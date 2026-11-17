import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { DetailError } from 'src/components/detail/detail-error'

function renderError(digest?: string) {
  const onReset = jest.fn()

  render(
    <DetailError
      detail="Nothing has been changed — trying again is safe."
      digest={digest}
      lead="The download service didn’t answer."
      title="This movie couldn’t be loaded"
      onReset={onReset}
    />,
  )

  return { onReset, user: userEvent.setup() }
}

describe('DetailError', () => {
  it('heads the page with what could not be loaded', () => {
    renderError()

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'This movie couldn’t be loaded',
      }),
    ).toBeInTheDocument()
  })

  it('says what broke and what to do in a bad note', () => {
    renderError()

    const note = screen.getByRole('alert')

    expect(note).toHaveTextContent('The download service didn’t answer.')
    expect(note).toHaveTextContent('trying again is safe')
  })

  it('re-runs the segment from Try again', async () => {
    const { onReset, user } = renderError()

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('shows the digest in mono beside the button', () => {
    renderError('3482910274')

    expect(screen.getByText('digest 3482910274')).toHaveClass('font-mono')
  })

  it('draws no digest when Next gave none', () => {
    renderError()

    expect(screen.queryByText(/digest/)).not.toBeInTheDocument()
  })
})
