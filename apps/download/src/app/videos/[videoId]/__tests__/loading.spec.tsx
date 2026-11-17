import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'

import VideoLoading from 'src/app/videos/[videoId]/loading'

describe('VideoLoading', () => {
  it('announces itself as busy', () => {
    render(<VideoLoading />)

    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
  })

  it('reserves the 16:9 player the real page lands in', () => {
    const { container } = render(<VideoLoading />)

    const player = container.querySelector('.skeleton.aspect-video')

    expect(player).not.toBeNull()
    expect(player?.getAttribute('class')).toContain('w-full')
  })

  it('draws no poster column, because a video’s picture is the player', () => {
    const { container } = render(<VideoLoading />)

    expect(container.querySelector('.skeleton.aspect-\\[2\\/3\\]')).toBeNull()
  })

  it('reserves the six facts the Details and File sections share', () => {
    const { container } = render(<VideoLoading />)

    const grid = container.querySelector('.grid')

    expect(grid?.children).toHaveLength(6)
  })

  it('stays in the video route’s own column', () => {
    render(<VideoLoading />)

    expect(
      screen.getByRole('main').firstElementChild?.getAttribute('class'),
    ).toBe('mx-auto max-w-[1080px]')
  })
})
