import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import Error from 'src/app/error'

const mockRefresh = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

describe('Error page', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  it('Retry refreshes the server render and resets the boundary', async () => {
    const reset = jest.fn()
    render(<Error error={new globalThis.Error('docker down')} reset={reset} />)

    await userEvent.click(screen.getByRole('button', { name: /retry/i }))

    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
