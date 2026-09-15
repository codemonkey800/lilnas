import '@testing-library/jest-dom'

import { THEME_FONT_SIZES } from '@lilnas/utils/cns'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'

import type { ButtonSize, ButtonVariant } from 'src/components/ui/button'
import { Button } from 'src/components/ui/button'

/**
 * Scoped to its own container rather than `screen`, so a test may render
 * several buttons in one `it` without `getByRole` finding all of them.
 */
function renderButton(ui: ReactElement): HTMLElement {
  const { container } = render(ui)
  const button = container.firstElementChild

  if (!(button instanceof HTMLElement)) {
    throw new Error('expected the button to be the only root element')
  }

  return button
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

/**
 * Every font-size utility — likewise exactly one.
 *
 * Matched off the rendered `class` attribute rather than off the size table,
 * because `cns` is `twMerge(...)` and can drop a utility on its way to the
 * DOM.
 *
 * The match is deliberately an allow-list of arbitrary values plus this
 * theme's `--text-*` token names. A loose `text-` prefix would count
 * `text-ink-3` as a font size and cheerfully report a size that isn't there —
 * which is exactly how the bug below disguises itself.
 */
function fontSizeClasses(element: Element): string[] {
  return classes(element).filter(
    name =>
      /^text-\[/.test(name) ||
      THEME_FONT_SIZES.some(token => name === `text-${token}`),
  )
}

/** The text-colour utility each variant is supposed to reach the DOM with. */
const VARIANT_INK: Record<ButtonVariant, string> = {
  uv: 'text-uv-ink',
  outline: 'text-ink',
  ghost: 'text-ink-3',
  bad: 'text-bad',
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

    /**
     * Regression: `cns` is `twMerge(clsx(...))`, and tailwind-merge only
     * recognises Tailwind's *built-in* font-size names. Left unconfigured, it
     * files every custom `--text-*` token in this theme under text-*colour*
     * instead, so `lg`'s `text-h3` shared a conflict group with each
     * variant's ink and one of the two was silently discarded on the way to
     * the DOM. In this composition order `text-h3` won and every large button
     * lost its colour — a large `uv` button rendered near-white on the purple
     * fill. `packages/utils/src/cns.ts` registers the token names as font
     * sizes, which is what keeps both alive here.
     *
     * These assertions read the rendered `class` attribute on purpose.
     * Asserting on the size/variant tables instead would have passed happily
     * while the DOM was wrong.
     */
    it.each<ButtonVariant>(['uv', 'outline', 'ghost', 'bad'])(
      'keeps both a font size and the %s ink colour on a large button',
      variant => {
        const button = renderButton(
          <Button size="lg" variant={variant}>
            Go
          </Button>,
        )

        expect(fontSizeClasses(button)).toEqual(['text-h3'])
        expect(button).toHaveClass(VARIANT_INK[variant])
      },
    )

    it('emits exactly one font size at every size, colour intact', () => {
      for (const size of [undefined, 'sm', 'lg'] as const) {
        const button = renderButton(
          <Button size={size} variant="uv">
            Go
          </Button>,
        )

        expect(fontSizeClasses(button)).toHaveLength(1)
        expect(button).toHaveClass('text-uv-ink')
      }
    })

    /**
     * `--text-h3` declares `--text-h3--line-height: 1.4`, which the plain
     * token emits for itself. The `leading-[1.4]` that once restored it
     * alongside `text-[length:var(--text-h3)]` is gone, and must stay gone —
     * a stray `leading-*` here would be a second source of truth for the
     * token's own line height.
     */
    it('takes its line height from the h3 token, not a separate utility', () => {
      const button = renderButton(<Button size="lg">Go</Button>)

      expect(button).toHaveClass('text-h3')
      expect(
        classes(button).filter(name => name.startsWith('leading-')),
      ).toEqual([])
    })

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

  /**
   * The second way to turn a button off, for a control that disables *itself*
   * under the user — `LoadMore` while a page is in flight. A real `disabled`
   * attribute would drop it out of the focus order mid-press and strand a
   * keyboard user on `<body>`.
   *
   * `Button` owns both halves of the contract: the styling *and* the
   * suppressed handler. If only the styling lived here, a future call site
   * would set `aria-disabled`, look disabled, and still fire.
   */
  describe('aria-disabled', () => {
    it('blocks onClick while staying focusable', async () => {
      const onClick = jest.fn()
      const user = userEvent.setup()

      render(
        <Button aria-disabled onClick={onClick}>
          Go
        </Button>,
      )

      const button = screen.getByRole('button')

      await user.click(button)

      expect(onClick).not.toHaveBeenCalled()
      expect(button).not.toBeDisabled()

      button.focus()

      expect(button).toHaveFocus()
    })

    it('blocks a keyboard activation too', async () => {
      const onClick = jest.fn()
      const user = userEvent.setup()

      render(
        <Button aria-disabled onClick={onClick}>
          Go
        </Button>,
      )

      screen.getByRole('button').focus()
      await user.keyboard('{Enter}')
      await user.keyboard(' ')

      expect(onClick).not.toHaveBeenCalled()
    })

    it('accepts the string form, which is how JSX often spells it', async () => {
      const onClick = jest.fn()
      const user = userEvent.setup()

      render(
        <Button aria-disabled="true" onClick={onClick}>
          Go
        </Button>,
      )

      await user.click(screen.getByRole('button'))

      expect(onClick).not.toHaveBeenCalled()
    })

    it('treats aria-disabled="false" as enabled', async () => {
      const onClick = jest.fn()
      const user = userEvent.setup()

      render(
        <Button aria-disabled="false" onClick={onClick}>
          Go
        </Button>,
      )

      await user.click(screen.getByRole('button'))

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    /**
     * Dimmed like `:disabled`, but hit-testable on purpose — the element has
     * to stay focusable, so `pointer-events-none` would take `:focus-visible`
     * and the cursor with it.
     */
    it('looks disabled but stays hit-testable', () => {
      const button = renderButton(<Button aria-disabled>Go</Button>)

      expect(button).toHaveClass(
        'aria-disabled:opacity-38',
        'aria-disabled:cursor-not-allowed',
        'aria-disabled:active:scale-100',
      )
      expect(classes(button)).not.toContain('aria-disabled:pointer-events-none')
    })

    it('leaves the real disabled treatment in place', () => {
      expect(renderButton(<Button>Go</Button>)).toHaveClass(
        'disabled:pointer-events-none',
        'disabled:opacity-38',
      )
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
