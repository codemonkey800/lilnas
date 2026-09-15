import '@testing-library/jest-dom'

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import type { ButtonSize, ButtonVariant } from 'src/components/ui/button'
import { Button } from 'src/components/ui/button'

function renderButton(ui: ReactElement): HTMLElement {
  render(ui)

  return screen.getByRole('button')
}

function classes(element: Element): string[] {
  return Array.from(element.classList)
}

/** Every height utility on the element — there must only ever be one. */
function heightClasses(element: Element): string[] {
  return classes(element).filter(name => name.startsWith('h-'))
}

/** Every horizontal-padding utility — likewise exactly one. */
function paddingClasses(element: Element): string[] {
  return classes(element).filter(name => name.startsWith('px-'))
}

/** Every font-size utility — likewise exactly one. */
function fontSizeClasses(element: Element): string[] {
  return classes(element).filter(
    name => name.startsWith('text-[') || name === 'text-h3',
  )
}

/** Every border-colour utility — likewise exactly one. */
function borderColorClasses(element: Element): string[] {
  return classes(element).filter(
    name => name === 'border-transparent' || name === 'border-line',
  )
}

describe('Button', () => {
  it('defaults to type="button" so it cannot submit a surrounding form', () => {
    expect(renderButton(<Button>Go</Button>)).toHaveAttribute('type', 'button')
  })

  it('lets a caller opt into submitting', () => {
    expect(renderButton(<Button type="submit">Go</Button>)).toHaveAttribute(
      'type',
      'submit',
    )
  })

  it('renders its children as the label', () => {
    expect(renderButton(<Button>Download</Button>)).toHaveTextContent(
      'Download',
    )
  })

  describe('variants', () => {
    const cases: Array<[ButtonVariant, string, string]> = [
      ['uv', 'bg-uv', 'border-transparent'],
      ['outline', 'bg-surface', 'border-line'],
      ['ghost', 'text-ink-3', 'border-transparent'],
      ['bad', 'text-bad', 'border-transparent'],
    ]

    it.each(cases)(
      '%s owns its own fill and border colour',
      (variant, fill, border) => {
        const button = renderButton(<Button variant={variant}>Go</Button>)

        expect(button).toHaveClass(fill)
        expect(button).toHaveClass(border)
        expect(borderColorClasses(button)).toEqual([border])
      },
    )

    it('renders a bare, transparent-bordered button with no variant', () => {
      const button = renderButton(<Button>Go</Button>)

      expect(borderColorClasses(button)).toEqual(['border-transparent'])
      expect(button).not.toHaveClass('bg-uv')
      expect(button).not.toHaveClass('bg-surface')
    })

    it('does not leak one variant into another', () => {
      const uv = renderButton(<Button variant="uv">Go</Button>)

      expect(uv).not.toHaveClass('border-line')
      expect(uv).not.toHaveClass('text-ink-3')
    })
  })

  describe('sizes', () => {
    const cases: Array<[ButtonSize, string, string, string]> = [
      ['sm', 'h-[30px]', 'px-[11px]', 'text-[13px]'],
      ['lg', 'h-[46px]', 'px-[22px]', 'text-h3'],
    ]

    it.each(cases)(
      '%s emits exactly one height, padding and font size',
      (size, height, padding, fontSize) => {
        const button = renderButton(<Button size={size}>Go</Button>)

        expect(heightClasses(button)).toEqual([height])
        expect(paddingClasses(button)).toEqual([padding])
        expect(fontSizeClasses(button)).toEqual([fontSize])
      },
    )

    it('uses the 38px default with roomy padding for loud variants', () => {
      const button = renderButton(<Button variant="uv">Go</Button>)

      expect(heightClasses(button)).toEqual(['h-[38px]'])
      expect(paddingClasses(button)).toEqual(['px-[15px]'])
      expect(fontSizeClasses(button)).toEqual(['text-[14px]'])
    })

    it.each<ButtonVariant>(['ghost', 'bad'])(
      'gives the quiet %s variant tighter default padding',
      variant => {
        const button = renderButton(<Button variant={variant}>Go</Button>)

        expect(heightClasses(button)).toEqual(['h-[38px]'])
        expect(paddingClasses(button)).toEqual(['px-[11px]'])
      },
    )

    it('lets an explicit size beat the quiet default padding', () => {
      const button = renderButton(
        <Button size="lg" variant="ghost">
          Go
        </Button>,
      )

      expect(paddingClasses(button)).toEqual(['px-[22px]'])
    })
  })

  describe('icons', () => {
    it('renders a leading icon before the label', () => {
      const button = renderButton(<Button icon="film">Watch</Button>)
      const use = button.querySelector('svg use')

      expect(use).toHaveAttribute('href', '#i-film')
      expect(button.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    })

    it('renders a trailing icon after the label', () => {
      const button = renderButton(<Button iconEnd="chevron">More</Button>)

      expect(button.lastElementChild?.tagName.toLowerCase()).toBe('svg')
      expect(button.querySelector('svg use')).toHaveAttribute(
        'href',
        '#i-chevron',
      )
    })

    it('renders both icons around the label', () => {
      const button = renderButton(
        <Button icon="film" iconEnd="chevron">
          Watch
        </Button>,
      )

      expect(
        Array.from(button.querySelectorAll('use')).map(node =>
          node.getAttribute('href'),
        ),
      ).toEqual(['#i-film', '#i-chevron'])
    })

    it('sizes icons at the call site rather than intrinsically', () => {
      const button = renderButton(<Button icon="film">Watch</Button>)

      expect(button.querySelector('svg')).toHaveClass('h-[15px]', 'w-[15px]')
    })

    it('renders no icon slot when none is asked for', () => {
      expect(
        renderButton(<Button>Go</Button>).querySelectorAll('svg'),
      ).toHaveLength(0)
    })
  })

  describe('full', () => {
    it('stretches when full', () => {
      expect(renderButton(<Button full>Go</Button>)).toHaveClass('w-full')
    })

    it('does not stretch by default', () => {
      expect(renderButton(<Button>Go</Button>)).not.toHaveClass('w-full')
    })
  })

  describe('disabled', () => {
    it('blocks onClick', async () => {
      const onClick = jest.fn()
      const user = userEvent.setup()

      render(
        <Button disabled onClick={onClick}>
          Go
        </Button>,
      )

      await user.click(screen.getByRole('button'))

      expect(onClick).not.toHaveBeenCalled()
    })

    it('still fires onClick when enabled', async () => {
      const onClick = jest.fn()
      const user = userEvent.setup()

      render(<Button onClick={onClick}>Go</Button>)

      await user.click(screen.getByRole('button'))

      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  it('merges a caller className and spreads the rest onto the root', () => {
    const button = renderButton(
      <Button className="flex-1" data-testid="cancel">
        Cancel
      </Button>,
    )

    expect(button).toHaveClass('flex-1')
    expect(button).toHaveClass('inline-flex')
    expect(button).toHaveAttribute('data-testid', 'cancel')
  })
})
