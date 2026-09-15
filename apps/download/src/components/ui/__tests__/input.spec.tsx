import '@testing-library/jest-dom'

import { THEME_FONT_SIZES } from '@lilnas/utils/cns'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Field, Input } from 'src/components/ui/input'

function classes(element: Element): string[] {
  return Array.from(element.classList)
}

/**
 * Every font-size utility that actually survived to the DOM — there must only
 * ever be one.
 *
 * Deliberately an allow-list rather than a loose `text-` prefix match.
 * `text-ink-3` is a colour, and a helper that counted it would report a size
 * the element does not have, which is precisely the failure this file exists
 * to catch.
 */
function fontSizeClasses(element: Element): string[] {
  return classes(element).filter(
    name =>
      /^text-\[(?:length:var\(--text-[\w-]+\)|[\d.]+px)\]$/.test(name) ||
      THEME_FONT_SIZES.some(token => name === `text-${token}`),
  )
}

/** Every padding-left utility — likewise exactly one. */
function paddingLeftClasses(element: Element): string[] {
  return classes(element).filter(name => name.startsWith('pl-'))
}

describe('Input', () => {
  it('defaults to a text field', () => {
    render(<Input />)

    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'text')
  })

  it('lets a caller pick another type', () => {
    render(<Input placeholder="From" type="date" />)

    expect(screen.getByPlaceholderText('From')).toHaveAttribute('type', 'date')
  })

  it('carries exactly one font-size utility, proportional by default', () => {
    render(<Input />)

    expect(fontSizeClasses(screen.getByRole('textbox'))).toEqual([
      'text-[14px]',
    ])
  })

  /**
   * The mono treatment is the plain `text-mono` token plus `font-mono`. The
   * token carries `--text-mono--font-weight: 450` and
   * `--text-mono--letter-spacing: -0.01em` itself, so there must be no
   * standalone `font-[450]` / `tracking-[-0.01em]` beside it — those once
   * existed only to restore what `text-[length:var(--text-mono)]` dropped.
   */
  it('swaps the whole type treatment for the machine face when mono', () => {
    render(<Input mono />)

    const input = screen.getByRole('textbox')

    expect(fontSizeClasses(input)).toEqual(['text-mono'])
    expect(input).toHaveClass('font-mono')
    expect(input).not.toHaveClass('font-[450]')
    expect(input).not.toHaveClass('tracking-[-0.01em]')
  })

  /**
   * Regression: `cns` is `twMerge(clsx(...))`, and tailwind-merge only knows
   * Tailwind's *built-in* font-size names. Left unconfigured it misclassifies
   * every custom `--text-*` token in this theme as a text *colour*, putting
   * `text-mono` in the same conflict group as any colour a caller passes, and
   * the size is silently dropped:
   *
   *     cns('font-mono text-mono text-ink-3') === 'font-mono text-ink-3'
   *
   * `packages/utils/src/cns.ts` registers the token names as font sizes,
   * which is what keeps both alive here.
   *
   * These assert on the element's rendered `class` attribute rather than on
   * the string handed to `cns`, because the drop happens inside `cns` — a test
   * that checked the input would have passed throughout.
   */
  describe('mono sizing survives tailwind-merge', () => {
    it.each([
      ['a text colour', 'text-ink-3'],
      ['an error colour alongside a width', 'w-[76px]! text-bad'],
      ['a mono-sm colour pairing', 'text-uv-hi'],
    ])('keeps the font size when the caller passes %s', (_label, className) => {
      render(<Input mono className={className} />)

      const rendered = screen.getByRole('textbox').getAttribute('class') ?? ''

      expect(rendered.split(' ')).toContain('text-mono')
      expect(rendered.split(' ')).toContain(className.split(' ').at(-1))
    })

    it('leaves exactly one font-size utility on the element', () => {
      render(<Input mono className="text-ink-3" />)

      expect(fontSizeClasses(screen.getByRole('textbox'))).toEqual([
        'text-mono',
      ])
    })

    /**
     * `font-mono` is a font-*family* utility and `text-mono` a font-*size*
     * one, so a caller's `font-semibold` lands in the weight group alone. It
     * beats the token's `--text-mono--font-weight` fallback in the cascade
     * without touching the size.
     */
    it('still lets a caller override the weight without losing the size', () => {
      render(<Input mono className="font-semibold" />)

      const input = screen.getByRole('textbox')

      expect(fontSizeClasses(input)).toEqual(['text-mono'])
      expect(input).toHaveClass('font-mono', 'font-semibold')
    })
  })

  it('carries exactly one padding-left utility, widened by a leading icon', () => {
    const { rerender } = render(<Input />)

    expect(paddingLeftClasses(screen.getByRole('textbox'))).toEqual(['pl-3'])

    rerender(<Input icon="search" />)

    expect(paddingLeftClasses(screen.getByRole('textbox'))).toEqual([
      'pl-[34px]',
    ])
  })

  it('renders a decorative leading icon only when asked', () => {
    const { container, rerender } = render(<Input />)

    expect(container.querySelector('svg')).toBeNull()

    rerender(<Input icon="search" />)

    const icon = container.querySelector('svg')

    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('use')).toHaveAttribute('href', '#i-search')
  })

  it('applies className to the input and wrapperClassName to the wrapper', () => {
    const { container } = render(
      <Input className="w-[76px]!" icon="search" wrapperClassName="flex-1" />,
    )

    expect(screen.getByRole('textbox')).toHaveClass('w-[76px]!')
    expect(container.firstChild).toHaveClass('flex-1')
  })

  it('spreads the rest of its props onto the input', () => {
    render(<Input aria-invalid="true" name="year" />)

    const input = screen.getByRole('textbox')

    expect(input).toHaveAttribute('name', 'year')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Field', () => {
  it('associates its label with the input it wraps', () => {
    render(
      <Field label="Release year">
        <Input />
      </Field>,
    )

    const input = screen.getByLabelText('Release year')

    expect(input).toBe(screen.getByRole('textbox'))
    expect(input.id).toBeTruthy()
  })

  it('focuses the input when the label is clicked', async () => {
    const user = userEvent.setup()

    render(
      <Field label="Release year">
        <Input />
      </Field>,
    )

    await user.click(screen.getByText('Release year'))

    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('lets the input keep an explicit id', () => {
    render(
      <Field htmlFor="year" label="Release year">
        <Input id="year" />
      </Field>,
    )

    expect(screen.getByLabelText('Release year')).toHaveAttribute('id', 'year')
  })

  it('gives each field a distinct id', () => {
    render(
      <>
        <Field label="From">
          <Input />
        </Field>
        <Field label="To">
          <Input />
        </Field>
      </>,
    )

    expect(screen.getByLabelText('From').id).not.toBe(
      screen.getByLabelText('To').id,
    )
  })

  it('spreads the rest of its props onto the wrapper', () => {
    const { container } = render(
      <Field className="col-span-2" data-testid="field" label="Genre">
        <Input />
      </Field>,
    )

    expect(container.firstChild).toHaveAttribute('data-testid', 'field')
    expect(container.firstChild).toHaveClass('col-span-2')
  })
})
