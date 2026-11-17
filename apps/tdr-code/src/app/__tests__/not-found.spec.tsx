import { render, screen } from '@testing-library/react'

import NotFound from 'src/app/not-found'

describe('NotFound (not-found.tsx)', () => {
  it('says the page is missing and offers one way back', () => {
    render(<NotFound />)

    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument()
    const back = screen.getByRole('link', { name: 'Back to Live' })
    expect(back).toHaveAttribute('href', '/')
  })
})
