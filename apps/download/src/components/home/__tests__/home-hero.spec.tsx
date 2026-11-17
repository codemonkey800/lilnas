import '@testing-library/jest-dom'

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { startVideoDownload } from 'src/app/actions/start-video-download'
import {
  HOME_HEADLINE,
  HOME_HINT,
  HomeHero,
} from 'src/components/home/home-hero'

const push = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

jest.mock('src/app/actions/start-video-download', () => ({
  startVideoDownload: jest.fn(),
}))

const mockStartVideoDownload = jest.mocked(startVideoDownload)

function field(): HTMLInputElement {
  return screen.getByRole('textbox', {
    name: 'Search or paste a link',
  }) as HTMLInputElement
}

beforeEach(() => {
  mockStartVideoDownload.mockReset()
  mockStartVideoDownload.mockResolvedValue(undefined)
})

describe('HomeHero', () => {
  it('is the page’s one h1, with the mockup’s headline', () => {
    render(<HomeHero />)

    expect(
      screen.getByRole('heading', { level: 1, name: HOME_HEADLINE }),
    ).toBeInTheDocument()
    expect(HOME_HEADLINE).toBe('What are we downloading?')
  })

  it('says where each kind of input goes, in one line', () => {
    render(<HomeHero />)

    expect(screen.getByText(HOME_HINT)).toBeInTheDocument()
    expect(HOME_HINT).toMatch(/Radarr and Sonarr/)
    expect(HOME_HINT).toMatch(/yt-dlp/)
  })

  it('is one search landmark holding one 44px field and one accent button', () => {
    render(<HomeHero />)

    expect(screen.getAllByRole('search')).toHaveLength(1)
    expect(field()).toHaveClass('h-11')
    expect(screen.getByRole('button', { name: 'Search' })).toHaveClass(
      'bg-accent',
    )
  })

  it('is icon-only below sm, keeping the label as its name', () => {
    render(<HomeHero />)
    const button = screen.getByRole('button', { name: 'Search' })

    expect(button).toHaveClass('max-sm:size-11')
    expect(button.querySelector('span span')).toHaveClass('max-sm:hidden')
  })

  it('sends a title to the search page', async () => {
    const user = userEvent.setup()
    render(<HomeHero />)

    await user.type(field(), 'the office')
    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(push).toHaveBeenCalledWith('/search?q=the%20office')
    expect(mockStartVideoDownload).not.toHaveBeenCalled()
  })

  it('relabels its button Download for a pasted link and starts it', async () => {
    const user = userEvent.setup()
    render(<HomeHero />)

    await user.type(field(), 'youtube.com/watch?v=x')
    await user.click(screen.getByRole('button', { name: 'Download' }))

    await waitFor(() =>
      expect(mockStartVideoDownload).toHaveBeenCalledWith(
        'https://youtube.com/watch?v=x',
      ),
    )
    expect(push).not.toHaveBeenCalled()
  })

  it('submits on Enter', async () => {
    const user = userEvent.setup()
    render(<HomeHero />)

    await user.type(field(), 'the office{Enter}')

    expect(push).toHaveBeenCalledWith('/search?q=the%20office')
  })

  it('does nothing for a single character', async () => {
    const user = userEvent.setup()
    render(<HomeHero />)

    await user.type(field(), 't{Enter}')

    expect(push).not.toHaveBeenCalled()
  })

  it('shows a failed create under the field, and clears it on the next key', async () => {
    mockStartVideoDownload.mockResolvedValue({ error: 'Not a video link.' })
    const user = userEvent.setup()
    render(<HomeHero />)

    await user.type(field(), 'youtube.com/watch?v=x{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Not a video link.',
    )

    await user.type(field(), 'y')

    expect(screen.queryByRole('alert')).toBeNull()
  })
})
