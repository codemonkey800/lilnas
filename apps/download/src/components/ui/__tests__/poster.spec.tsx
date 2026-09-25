import '@testing-library/jest-dom'

import { fireEvent, render, screen } from '@testing-library/react'

import { iconSymbolId } from 'src/components/ui/icon'
import {
  Poster,
  POSTER_DEFAULT_PLAY_SIZE,
  POSTER_DEFAULT_RADIUS,
} from 'src/components/ui/poster'
import { posterVariant } from 'src/lib/format'

function requireImage(root: HTMLElement): HTMLImageElement {
  const img = root.querySelector('img')

  if (!img) {
    throw new Error('expected the poster to render an image')
  }

  return img
}

/**
 * jsdom never fetches, so `complete` is permanently `false` and the
 * already-broken path can only be reached by staging it. This is the case
 * `runtime.js` calls out: an image that failed while the HTML was being
 * parsed never fires `error`, so hydration has to notice it on mount.
 */
function stageAlreadyBroken(): void {
  jest
    .spyOn(HTMLImageElement.prototype, 'complete', 'get')
    .mockReturnValue(true)
  jest
    .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
    .mockReturnValue(0)
}

describe('Poster', () => {
  it('renders the gradient stand-in, the shape and the default radius', () => {
    render(<Poster data-testid="poster" seed="movie-1" shape="tall" />)
    const poster = screen.getByTestId('poster')

    expect(poster.tagName).toBe('DIV')
    expect(poster).toHaveClass(
      'group',
      'relative',
      'overflow-hidden',
      POSTER_DEFAULT_RADIUS,
      'aspect-[2/3]',
    )
  })

  it('takes the 16:9 crop when the shape is wide', () => {
    render(<Poster data-testid="poster" seed="video-1" shape="wide" />)
    const poster = screen.getByTestId('poster')

    expect(poster).toHaveClass('aspect-video')
    expect(poster).not.toHaveClass('aspect-[2/3]')
  })

  it('lets a call site replace the radius', () => {
    render(
      <Poster
        data-testid="poster"
        radius="rounded-xs"
        seed="movie-1"
        shape="tall"
      />,
    )
    const poster = screen.getByTestId('poster')

    expect(poster).toHaveClass('rounded-xs')
    expect(poster).not.toHaveClass(POSTER_DEFAULT_RADIUS)
  })

  it('derives the gradient stand-in from the seed', () => {
    render(<Poster data-testid="poster" seed="tt0133093" shape="tall" />)

    expect(screen.getByTestId('poster')).toHaveClass(
      `poster-v${posterVariant('tt0133093')}`,
    )
  })

  it('gives the same seed the same stand-in in two places', () => {
    render(
      <>
        <Poster data-testid="a" seed="shared-seed" shape="tall" />
        <Poster data-testid="b" seed="shared-seed" shape="wide" />
      </>,
    )

    const variant = `poster-v${posterVariant('shared-seed')}`
    expect(screen.getByTestId('a')).toHaveClass(variant)
    expect(screen.getByTestId('b')).toHaveClass(variant)
  })

  it('keeps the stand-in stable across re-renders', () => {
    const { rerender } = render(
      <Poster
        data-testid="poster"
        label="Scary Movie"
        seed="42"
        shape="tall"
      />,
    )
    const before = screen.getByTestId('poster').getAttribute('class')

    rerender(
      <Poster
        data-testid="poster"
        label="Scary Movie"
        play
        seed="42"
        shape="tall"
      />,
    )
    const after = screen.getByTestId('poster').getAttribute('class')

    expect(after).toBe(before)
    expect(screen.getByTestId('poster')).toHaveClass(
      `poster-v${posterVariant('42')}`,
    )
  })

  it('spreads the rest of its props and merges a caller className', () => {
    render(
      <Poster
        className="w-[34px]"
        data-testid="poster"
        id="art"
        seed="movie-1"
        shape="tall"
      />,
    )
    const poster = screen.getByTestId('poster')

    expect(poster).toHaveAttribute('id', 'art')
    expect(poster).toHaveClass('w-[34px]', 'group')
  })

  it('does not leak its own props into the DOM', () => {
    render(
      <Poster
        data-testid="poster"
        label="Warrior"
        play
        playSize="h-5 w-5"
        seed="show-1"
        shape="tall"
        src="/art.jpg"
      />,
    )
    const poster = screen.getByTestId('poster')

    expect(poster).not.toHaveAttribute('shape')
    expect(poster).not.toHaveAttribute('seed')
    expect(poster).not.toHaveAttribute('play')
    expect(poster).not.toHaveAttribute('playSize')
    expect(poster).not.toHaveAttribute('src')
  })

  describe('art', () => {
    it('renders a plain img, never a next/image wrapper', () => {
      render(
        <Poster
          data-testid="poster"
          seed="movie-1"
          shape="tall"
          src="https://radarr.example/art.jpg"
        />,
      )
      const img = requireImage(screen.getByTestId('poster'))

      expect(img).toHaveAttribute('src', 'https://radarr.example/art.jpg')
      expect(img).toHaveAttribute('data-poster', '')
      expect(img).toHaveClass('absolute', 'inset-0', 'object-cover')
      // The title is already adjacent text.
      expect(img).toHaveAttribute('alt', '')
      expect(img).not.toHaveAttribute('srcset')
    })

    it('renders no img at all when there is no src', () => {
      render(
        <Poster
          data-testid="poster"
          label="Scary Movie"
          seed="movie-1"
          shape="tall"
        />,
      )

      expect(screen.getByTestId('poster').querySelector('img')).toBeNull()
    })

    it('drops the image on error so the label underneath reappears', () => {
      render(
        <Poster
          data-testid="poster"
          label="Scary Movie"
          seed="movie-1"
          shape="tall"
          src="https://radarr.example/gone.jpg"
        />,
      )
      const poster = screen.getByTestId('poster')

      // While the art is alive the label is present but hidden by the
      // group-has selector; the label element is the mechanism, not a swap.
      const label = screen.getByText('Scary Movie')
      expect(label).toHaveClass('group-has-[img]:hidden')

      fireEvent.error(requireImage(poster))

      expect(poster.querySelector('img')).toBeNull()
      expect(screen.getByText('Scary Movie')).toBeInTheDocument()
    })

    it('drops an image that had already failed before it mounted', () => {
      stageAlreadyBroken()

      render(
        <Poster
          data-testid="poster"
          label="Warrior"
          seed="show-1"
          shape="tall"
          src="https://sonarr.example/gone.jpg"
        />,
      )

      expect(screen.getByTestId('poster').querySelector('img')).toBeNull()
      expect(screen.getByText('Warrior')).toBeInTheDocument()
    })

    it('retries when the src changes after a failure', () => {
      const { rerender } = render(
        <Poster
          data-testid="poster"
          seed="movie-1"
          shape="tall"
          src="https://radarr.example/gone.jpg"
        />,
      )

      fireEvent.error(requireImage(screen.getByTestId('poster')))
      expect(screen.getByTestId('poster').querySelector('img')).toBeNull()

      rerender(
        <Poster
          data-testid="poster"
          seed="movie-1"
          shape="tall"
          src="https://radarr.example/fresh.jpg"
        />,
      )

      expect(requireImage(screen.getByTestId('poster'))).toHaveAttribute(
        'src',
        'https://radarr.example/fresh.jpg',
      )
    })
  })

  describe('label', () => {
    it('renders no label element when there is no label', () => {
      render(<Poster data-testid="poster" seed="movie-1" shape="tall" />)

      expect(screen.getByTestId('poster').querySelector('span')).toBeNull()
    })

    it('styles the label as the fallback title', () => {
      render(
        <Poster
          data-testid="poster"
          label="The Madison"
          seed="show-1"
          shape="tall"
        />,
      )

      expect(screen.getByText('The Madison')).toHaveClass(
        'text-center',
        'font-semibold',
        'text-ink-2',
        'group-has-[img]:hidden',
      )
    })
  })

  describe('play overlay', () => {
    it('is absent by default', () => {
      render(<Poster data-testid="poster" seed="movie-1" shape="tall" />)

      expect(screen.getByTestId('poster').querySelector('svg')).toBeNull()
    })

    it('overlays a play triangle at the default size', () => {
      render(<Poster data-testid="poster" play seed="video-1" shape="wide" />)
      const svg = screen.getByTestId('poster').querySelector('svg')

      expect(svg?.querySelector('use')).toHaveAttribute(
        'href',
        `#${iconSymbolId('play')}`,
      )
      expect(svg).toHaveClass(
        ...POSTER_DEFAULT_PLAY_SIZE.split(' '),
        'text-ink',
      )
    })

    it('takes the play size the call site asks for', () => {
      render(
        <Poster
          data-testid="poster"
          play
          playSize="h-[30px] w-[30px]"
          seed="video-1"
          shape="wide"
        />,
      )
      const svg = screen.getByTestId('poster').querySelector('svg')

      expect(svg).toHaveClass('h-[30px]', 'w-[30px]', 'text-ink')
      expect(svg).not.toHaveClass('h-7', 'w-7')
    })
  })

  it('renders children after the overlay, as the mixin block does', () => {
    render(
      <Poster data-testid="poster" seed="video-1" shape="tall">
        <span data-testid="badge">badge</span>
      </Poster>,
    )

    expect(screen.getByTestId('poster').lastElementChild).toBe(
      screen.getByTestId('badge'),
    )
  })
})
