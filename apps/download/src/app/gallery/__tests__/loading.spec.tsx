import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import GalleryLoading from 'src/app/gallery/loading'

describe('GalleryLoading', () => {
  it('is marked busy and draws a spinner nowhere', () => {
    const { container } = render(<GalleryLoading />)

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('draws the tab strip, the Filters button and twelve poster cards', () => {
    const { container } = render(<GalleryLoading />)

    expect(container.querySelectorAll('.aspect-\\[2\\/3\\]')).toHaveLength(12)
    expect(container.querySelector('.h-9.w-24')).not.toBeNull()
  })
})
