import '@testing-library/jest-dom'

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'

import { Button } from 'src/components/ui/button'
import {
  AppliedFilterChip,
  FilterFoot,
  FilterGrid,
  FilterGroup,
  FilterPanel,
  FiltersButton,
  FilterScrim,
} from 'src/components/ui/filters'
import { Menu, MenuItem } from 'src/components/ui/menu'
import { ToggleChip } from 'src/components/ui/toggle-chip'

describe('FiltersButton', () => {
  it('renders the outline shape, the label and the chevron', () => {
    const { container } = render(<FiltersButton />)

    const button = screen.getByRole('button', { name: 'Filters' })

    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button).toHaveClass('border-line', 'bg-surface', 'text-ink')
    expect(container.querySelector('use')).toHaveAttribute('href', '#i-chevron')
  })

  it('leaves aria-expanded off a button that reports no open state', () => {
    render(<FiltersButton />)

    expect(screen.getByRole('button')).not.toHaveAttribute('aria-expanded')
  })

  it('carries no count badge when nothing is applied', () => {
    render(<FiltersButton />)

    expect(screen.getByRole('button')).toHaveTextContent(/^Filters$/)
  })

  it('carries no count badge at zero applied filters', () => {
    render(<FiltersButton count={0} />)

    expect(screen.getByRole('button')).toHaveTextContent(/^Filters$/)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('carries a count badge once filters are applied', () => {
    render(<FiltersButton count={2} />)

    const badge = screen.getByText('2')

    expect(badge).toHaveClass('bg-uv', 'text-uv-ink', 'rounded-full')
    expect(screen.getByRole('button')).toHaveAccessibleName('Filters 2')
  })

  it('leaves the chevron unrotated while closed', () => {
    const { container } = render(<FiltersButton open={false} />)

    expect(container.querySelector('svg')).not.toHaveClass('rotate-180')
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button')).not.toHaveClass('bg-uv-ghost')
  })

  it('rotates the chevron and tints itself while open', () => {
    const { container } = render(<FiltersButton open />)

    expect(container.querySelector('svg')).toHaveClass('rotate-180')
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button')).toHaveClass(
      'border-uv/35',
      'bg-uv-ghost',
      'text-uv-hi',
    )
  })

  it('lets a caller override the tint and the size', () => {
    render(<FiltersButton open className="bg-surface-2" size="sm" />)

    const button = screen.getByRole('button')

    expect(button).toHaveClass('bg-surface-2', 'h-[30px]')
    expect(button).not.toHaveClass('bg-uv-ghost')
  })

  it('forwards a ref to the underlying button', () => {
    function Harness() {
      const ref = useRef<HTMLButtonElement>(null)

      return (
        <FiltersButton
          ref={ref}
          onClick={() => {
            ref.current?.setAttribute('data-reached', 'true')
          }}
        />
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveAttribute('data-reached', 'true')
  })
})

describe('AppliedFilterChip', () => {
  it('renders the value and the accent treatment', () => {
    render(
      <AppliedFilterChip
        data-testid="chip"
        label="2019–2024"
        removeLabel="Remove year filter"
      />,
    )

    const chip = screen.getByTestId('chip')

    expect(chip).toHaveTextContent('2019–2024')
    expect(chip).toHaveClass('border-uv/30', 'bg-uv-ghost', 'text-uv-hi')
  })

  it('names the remove button after the filter it removes', () => {
    render(
      <>
        <AppliedFilterChip label="Comedy" removeLabel="Remove genre filter" />
        <AppliedFilterChip
          label="1999–2012"
          removeLabel="Remove release year filter"
        />
      </>,
    )

    expect(
      screen.getByRole('button', { name: 'Remove genre filter' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Remove release year filter' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull()
  })

  it('calls onRemove and renders the x glyph', async () => {
    const user = userEvent.setup()
    const onRemove = jest.fn()

    const { container } = render(
      <AppliedFilterChip
        label="Jeremy"
        removeLabel="Remove uploaded by filter"
        onRemove={onRemove}
      />,
    )

    await user.click(screen.getByRole('button'))

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(container.querySelector('use')).toHaveAttribute('href', '#i-x')
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })
})

describe('FilterGrid', () => {
  it('is single-column until the panel — not the viewport — is 400px wide', () => {
    render(<FilterGrid data-testid="grid" />)

    expect(screen.getByTestId('grid')).toHaveClass(
      'grid',
      'grid-cols-1',
      '@min-[400px]:grid-cols-[repeat(auto-fill,minmax(190px,1fr))]',
    )
  })
})

describe('FilterGroup', () => {
  it('is a group named by its label', () => {
    render(
      <FilterGroup label="uploaded by">
        <ToggleChip checked={false} label="Jeremy" />
      </FilterGroup>,
    )

    const group = screen.getByRole('group', { name: 'uploaded by' })

    expect(
      within(group).getByRole('checkbox', { name: 'Jeremy' }),
    ).toBeInTheDocument()
  })

  it('draws its label in the uppercase mono micro-type', () => {
    render(<FilterGroup label="release year" />)

    expect(screen.getByText('release year')).toHaveClass(
      'font-mono',
      'text-label',
      'uppercase',
      'text-ink-4',
    )
  })

  it('spans both columns only when asked', () => {
    render(
      <>
        <FilterGroup data-testid="narrow" label="year" />
        <FilterGroup wide data-testid="wide" label="genre" />
      </>,
    )

    expect(screen.getByTestId('narrow')).not.toHaveClass(
      '@min-[400px]:col-span-2',
    )
    expect(screen.getByTestId('wide')).toHaveClass('@min-[400px]:col-span-2')
  })
})

describe('FilterFoot', () => {
  it('rules itself off from the groups above', () => {
    render(
      <FilterFoot data-testid="foot">
        <Button size="sm" variant="ghost">
          Clear all
        </Button>
      </FilterFoot>,
    )

    expect(screen.getByTestId('foot')).toHaveClass(
      'mt-5',
      'justify-between',
      'border-t',
      'border-line-soft',
      'pt-4',
    )
  })
})

describe('FilterScrim', () => {
  it('covers the viewport below the panel, and is not announced', () => {
    render(<FilterScrim data-testid="scrim" />)

    const scrim = screen.getByTestId('scrim')

    expect(scrim).toHaveClass('fixed', 'inset-0', 'z-10', 'bg-black/55')
    expect(scrim).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('FilterPanel', () => {
  it('renders as a plain container when no open state is given', () => {
    render(<FilterPanel data-testid="panel">contents</FilterPanel>)

    const panel = screen.getByTestId('panel')

    expect(panel).toHaveClass(
      '@container',
      'rounded-lg',
      'border-line',
      'bg-surface',
      'shadow-lift',
    )
    expect(panel).not.toHaveAttribute('role')
    expect(panel).not.toHaveAttribute('tabindex')
  })

  it('renders nothing while closed', () => {
    render(
      <FilterPanel data-testid="panel" open={false}>
        contents
      </FilterPanel>,
    )

    expect(screen.queryByTestId('panel')).not.toBeInTheDocument()
  })

  it('is a dialog that takes focus when open', () => {
    render(<FilterPanel open>contents</FilterPanel>)

    const panel = screen.getByRole('dialog', { name: 'Filters' })

    expect(panel).toHaveFocus()
    expect(panel).toHaveAttribute('tabindex', '-1')
  })
})

const PEOPLE = ['Jeremy', 'Alex'] as const

function FiltersPopover({
  onOpenChange,
  withControls = true,
}: {
  onOpenChange?: (open: boolean) => void
  withControls?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [sort, setSort] = useState('Recently added')
  const triggerRef = useRef<HTMLButtonElement>(null)

  function setOpenState(next: boolean): void {
    setOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div>
      <button type="button">before</button>
      <div className="relative z-20">
        <FiltersButton
          ref={triggerRef}
          count={2}
          open={open}
          onClick={() => setOpenState(!open)}
        />
        <FilterPanel
          className="absolute top-[calc(100%+10px)] right-0 w-[480px]"
          open={open}
          triggerRef={triggerRef}
          onOpenChange={setOpenState}
        >
          <FilterGrid>
            <FilterGroup wide label="uploaded by">
              {withControls
                ? PEOPLE.map(person => (
                    <ToggleChip key={person} checked={false} label={person} />
                  ))
                : null}
            </FilterGroup>
            {withControls ? (
              <FilterGroup label="sort by">
                <Menu label={sort} value={sort} onValueChange={setSort}>
                  <MenuItem value="Recently added">Recently added</MenuItem>
                  <MenuItem value="Title">Title</MenuItem>
                </Menu>
              </FilterGroup>
            ) : null}
          </FilterGrid>
        </FilterPanel>
      </div>
      <button type="button">after</button>
    </div>
  )
}

function trigger(): HTMLElement {
  return screen.getByRole('button', { name: /^Filters/ })
}

describe('FilterPanel as a popover', () => {
  it('opens from the trigger and closes on a second press', async () => {
    const user = userEvent.setup()

    render(<FiltersPopover />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(trigger())

    expect(screen.getByRole('dialog')).toHaveFocus()
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')

    await user.click(trigger())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup()
    const onOpenChange = jest.fn()

    render(<FiltersPopover onOpenChange={onOpenChange} />)

    await user.click(trigger())
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('closes on Escape even after the pointer dropped focus inside', async () => {
    const user = userEvent.setup()

    render(<FiltersPopover />)

    await user.click(trigger())
    await user.click(screen.getByText('uploaded by'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves the panel open when Escape closes a menu inside it', async () => {
    const user = userEvent.setup()

    render(<FiltersPopover />)

    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'Recently added' }))

    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes on a press outside, leaving focus where it went', async () => {
    const user = userEvent.setup()

    render(<FiltersPopover />)

    await user.click(trigger())
    await user.click(screen.getByRole('button', { name: 'after' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'after' })).toHaveFocus()
  })

  it('stays open while the pointer works inside it', async () => {
    const user = userEvent.setup()

    render(<FiltersPopover />)

    await user.click(trigger())
    await user.click(screen.getByRole('checkbox', { name: 'Jeremy' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes when focus tabs out of it', async () => {
    const user = userEvent.setup()

    render(<FiltersPopover withControls={false} />)

    await user.click(trigger())
    await user.tab()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
