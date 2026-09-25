import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MouseEvent, ReactElement } from 'react'

import { Button } from 'src/components/ui/button'
import { ButtonLink } from 'src/components/ui/button-link'

/**
 * Scoped to its own container rather than `screen`, matching
 * `button.spec.tsx`'s `renderButton` — a test may render several links in one
 * `it` without `getByRole` finding all of them.
 */
function renderLink(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  const link = container.firstElementChild

  if (!(link instanceof HTMLElement)) {
    throw new Error('expected the link to be the only root element')
  }

  return link
}

/**
 * jsdom has no navigation implementation, so a real click on an `<a href>` it
 * doesn't otherwise cancel logs a noisy "Not implemented: navigation"
 * console error. The href itself is already asserted separately; these
 * click tests only care whether `onClick` fired.
 */
function stopNavigation(event: MouseEvent): void {
  event.preventDefault()
}

describe('ButtonLink', () => {
  it('renders a real anchor with the given href', () => {
    const link = renderLink(<ButtonLink href="/gallery">Go</ButtonLink>)

    expect(link.tagName.toLowerCase()).toBe('a')
    expect(link).toHaveAttribute('href', '/gallery')
  })

  it('renders its children as the label', () => {
    expect(
      renderLink(<ButtonLink href="/gallery">Watch</ButtonLink>),
    ).toHaveTextContent('Watch')
  })

  it('leaves target and rel to the call site rather than defaulting them', () => {
    const link = renderLink(<ButtonLink href="/gallery">Go</ButtonLink>)

    expect(link).not.toHaveAttribute('target')
    expect(link).not.toHaveAttribute('rel')
  })

  it('passes an explicit target and rel through untouched', () => {
    const link = renderLink(
      <ButtonLink href="https://example.com" rel="noreferrer" target="_blank">
        Go
      </ButtonLink>,
    )

    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  /**
   * The whole point of extracting `buttonRecipeClassName` — a variant/size
   * combination must reach the DOM identically whichever element renders it.
   */
  it.each([
    [undefined, undefined],
    ['ghost', 'sm'],
    ['uv', 'lg'],
    ['outline', undefined],
    ['bad', undefined],
  ] as const)(
    'renders the same classes as Button for variant=%s size=%s',
    (variant, size) => {
      const button = renderLink(
        <Button size={size} variant={variant}>
          Go
        </Button>,
      )
      const link = renderLink(
        <ButtonLink href="/gallery" size={size} variant={variant}>
          Go
        </ButtonLink>,
      )

      expect(link.getAttribute('class')).toBe(button.getAttribute('class'))
    },
  )

  describe('icons', () => {
    it('renders a leading icon before the label', () => {
      const link = renderLink(
        <ButtonLink href="/gallery" icon="film">
          Watch
        </ButtonLink>,
      )
      const use = link.querySelector('svg use')

      expect(use).toHaveAttribute('href', '#i-film')
      expect(link.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    })

    it('renders a trailing icon after the label', () => {
      const link = renderLink(
        <ButtonLink href="/gallery" iconEnd="arrow">
          Go
        </ButtonLink>,
      )

      expect(link.lastElementChild?.tagName.toLowerCase()).toBe('svg')
      expect(link.querySelector('svg use')).toHaveAttribute('href', '#i-arrow')
    })

    it('renders no icon slot when none is asked for', () => {
      expect(
        renderLink(
          <ButtonLink href="/gallery">Go</ButtonLink>,
        ).querySelectorAll('svg'),
      ).toHaveLength(0)
    })
  })

  describe('full', () => {
    it('stretches when full', () => {
      expect(
        renderLink(
          <ButtonLink full href="/gallery">
            Go
          </ButtonLink>,
        ),
      ).toHaveClass('w-full')
    })

    it('does not stretch by default', () => {
      expect(
        renderLink(<ButtonLink href="/gallery">Go</ButtonLink>),
      ).not.toHaveClass('w-full')
    })
  })

  /**
   * An `<a>` has no `disabled` attribute, so the accessible pattern is the
   * one `Button` reaches for on purpose too: drop `href` rather than leave a
   * link that looks inert but still navigates. Dropping `href` also pulls the
   * anchor out of the tab order on its own — no separate `tabIndex` needed.
   */
  describe('aria-disabled', () => {
    it('drops the href so the link cannot navigate', () => {
      const link = renderLink(
        <ButtonLink aria-disabled href="/gallery">
          Go
        </ButtonLink>,
      )

      expect(link).not.toHaveAttribute('href')
      expect(link).toHaveAttribute('aria-disabled', 'true')
    })

    it('blocks onClick', async () => {
      const onClick = jest.fn()
      const user = userEvent.setup()

      render(
        <ButtonLink aria-disabled href="/gallery" onClick={onClick}>
          Go
        </ButtonLink>,
      )

      await user.click(screen.getByText('Go'))

      expect(onClick).not.toHaveBeenCalled()
    })

    it('treats aria-disabled="false" as enabled', async () => {
      const onClick = jest.fn(stopNavigation)
      const user = userEvent.setup()

      render(
        <ButtonLink aria-disabled="false" href="/gallery" onClick={onClick}>
          Go
        </ButtonLink>,
      )

      await user.click(screen.getByRole('link'))

      expect(onClick).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('link')).toHaveAttribute('href', '/gallery')
    })

    it('looks disabled but does not lose pointer-events like a real button does', () => {
      const link = renderLink(
        <ButtonLink aria-disabled href="/gallery">
          Go
        </ButtonLink>,
      )

      expect(link).toHaveClass(
        'aria-disabled:opacity-38',
        'aria-disabled:cursor-not-allowed',
      )
    })
  })

  it('still fires onClick when enabled', async () => {
    const onClick = jest.fn(stopNavigation)
    const user = userEvent.setup()

    render(
      <ButtonLink href="/gallery" onClick={onClick}>
        Go
      </ButtonLink>,
    )

    await user.click(screen.getByRole('link'))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('merges a caller className and spreads the rest onto the root', () => {
    const link = renderLink(
      <ButtonLink className="flex-1" data-testid="watch" href="/gallery">
        Go
      </ButtonLink>,
    )

    expect(link).toHaveClass('flex-1')
    expect(link).toHaveClass('inline-flex')
    expect(link).toHaveAttribute('data-testid', 'watch')
  })
})
