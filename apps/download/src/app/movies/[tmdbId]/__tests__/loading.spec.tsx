import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import MovieLoading from 'src/app/movies/[tmdbId]/loading'

describe('MovieLoading', () => {
  it('announces itself as busy', () => {
    render(<MovieLoading />)

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
  })

  it('reserves the poster column the header will land in', () => {
    const { container } = render(<MovieLoading />)

    const poster = container.querySelector('.skeleton.aspect-\\[2\\/3\\]')

    // `DetailHeader`'s own geometry: centred and capped at 220px on a phone,
    // a fixed 200px column from `sm`. Anything else and the art jumps when
    // Radarr answers.
    expect(poster?.getAttribute('class')).toContain('max-w-[220px]')
    expect(poster?.getAttribute('class')).toContain('sm:w-[200px]')
  })

  it('does not centre the title bar, because the real title is not centred', () => {
    const { container } = render(<MovieLoading />)

    const title = container.querySelector('.skeleton.h-\\[23px\\]')

    // The mockup's own loading mixin centres it (`mx-auto`); its mobile
    // header does not, and `DetailHeader` left-aligns at every width.
    expect(title?.getAttribute('class')).not.toContain('mx-auto')
  })

  it('reserves no trailer slot, because nothing on the wire carries one', () => {
    const { container } = render(<MovieLoading />)

    expect(container.querySelector('.aspect-video')).toBeNull()
  })

  it('is decorative throughout — every placeholder is aria-hidden', () => {
    const { container } = render(<MovieLoading />)

    const placeholders = [...container.querySelectorAll('.skeleton')]

    expect(placeholders.length).toBeGreaterThan(0)
    for (const placeholder of placeholders) {
      expect(placeholder).toHaveAttribute('aria-hidden', 'true')
    }
  })
})
