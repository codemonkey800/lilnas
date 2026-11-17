import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import HomeLoading from 'src/app/(home)/loading'

describe('HomeLoading', () => {
  it('is the page’s own geometry, marked busy, not a spinner', () => {
    const { container } = render(<HomeLoading />)

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('draws the hero, four tiles and six cards', () => {
    const { container } = render(<HomeLoading />)

    // The headline and the field.
    expect(container.querySelectorAll('.h-11')).toHaveLength(1)
    expect(screen.getByText('Quick access')).toBeInTheDocument()
    expect(screen.getByText('Recently added')).toBeInTheDocument()
    expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(6)
    expect(container.querySelectorAll('.grid-cols-1 > div')).toHaveLength(4)
  })
})
