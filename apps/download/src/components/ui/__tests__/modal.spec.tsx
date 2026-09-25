import '@testing-library/jest-dom'

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'

import { Button } from 'src/components/ui/button'
import {
  DeleteButton,
  Modal,
  ModalScrim,
  Reason,
  ReasonGroup,
} from 'src/components/ui/modal'

const REASONS = [
  'Wrong audio or subtitles',
  "Video won't play",
  'Not this movie',
] as const

/** The scrim, which is the dialog's parent and carries the backdrop classes. */
function scrim(): HTMLElement {
  const panel = screen.getByRole('dialog')

  if (!(panel.parentElement instanceof HTMLElement)) {
    throw new Error('the dialog is not inside a scrim')
  }

  return panel.parentElement
}

/** A trigger outside the dialog, so focus has somewhere to come from and go back to. */
function Harness({
  children,
  dismissible,
  description,
  focusCancel = false,
}: {
  children?: ReactNode
  dismissible?: boolean
  description?: ReactNode
  focusCancel?: boolean
}) {
  const [open, setOpen] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Report a problem
      </button>
      <Modal
        description={description}
        dismissible={dismissible}
        initialFocusRef={focusCancel ? cancelRef : undefined}
        open={open}
        title="What's wrong with this file?"
        onClose={() => setOpen(false)}
      >
        {children ?? (
          <div>
            <button type="button">First</button>
            <button ref={cancelRef} type="button">
              Cancel
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Submit report
            </button>
          </div>
        )}
      </Modal>
    </div>
  )
}

async function openHarness(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  const trigger = screen.getByRole('button', { name: 'Report a problem' })

  await user.click(trigger)

  return trigger
}

describe('ModalScrim', () => {
  it('covers the viewport, dims and blurs', () => {
    render(<ModalScrim data-testid="scrim" />)

    expect(screen.getByTestId('scrim')).toHaveClass(
      'fixed',
      'inset-0',
      'z-50',
      'flex',
      'items-center',
      'justify-center',
      'bg-scrim/62',
      'p-6',
      'backdrop-blur-[2px]',
    )
  })

  it('is fixed rather than the mixin’s absolute', () => {
    render(<ModalScrim data-testid="scrim" />)

    expect(screen.getByTestId('scrim')).not.toHaveClass('absolute')
  })

  it('merges a caller class and spreads the rest', () => {
    render(<ModalScrim aria-label="backdrop" className="p-0" id="s" />)

    const element = screen.getByLabelText('backdrop')

    expect(element).toHaveAttribute('id', 's')
    expect(element).toHaveClass('p-0')
    expect(element).not.toHaveClass('p-6')
  })
})

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(
      <Modal open={false} title="Delete?" onClose={jest.fn()}>
        body
      </Modal>,
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('portals to the document root rather than the tree it is written in', () => {
    const { container } = render(
      <Modal open title="Delete?" onClose={jest.fn()}>
        body
      </Modal>,
    )

    const dialog = screen.getByRole('dialog')

    expect(container).not.toContainElement(dialog)
    expect(dialog.closest('body')).toBe(document.body)
  })

  it('mounts into an explicit container when given one', () => {
    const host = document.createElement('div')

    document.body.append(host)

    render(
      <Modal container={host} open title="Delete?" onClose={jest.fn()}>
        body
      </Modal>,
    )

    expect(within(host).getByRole('dialog')).toBeInTheDocument()

    host.remove()
  })

  it('is a modal dialog named by its title', () => {
    render(
      <Modal open title='Delete "Dune"?' onClose={jest.fn()}>
        body
      </Modal>,
    )

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Delete "Dune"?')
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('text-h3')
  })

  it('describes itself with the description when it has one', () => {
    render(
      <Modal
        description="This can't be undone."
        open
        title="Delete?"
        onClose={jest.fn()}
      >
        body
      </Modal>,
    )

    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      "This can't be undone.",
    )
    expect(screen.getByText("This can't be undone.")).toHaveClass(
      'mb-[18px]',
      'text-sm',
      'text-ink-3',
    )
  })

  it('leaves aria-describedby off when there is no description', () => {
    render(
      <Modal open title="Delete?" onClose={jest.fn()}>
        body
      </Modal>,
    )

    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby')
  })

  it('caps the panel at the system’s 440px, not the mixin’s 380px', () => {
    render(
      <Modal open title="Delete?" onClose={jest.fn()}>
        body
      </Modal>,
    )

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveClass(
      'w-full',
      'max-w-[440px]',
      'rounded-lg',
      'border',
      'border-line-loud',
      'bg-surface',
      'p-[22px]',
      'shadow-lift',
    )
    expect(dialog).not.toHaveClass('max-w-[380px]')
  })

  it('tightens the gap under the title when prose follows it', () => {
    const { rerender } = render(
      <Modal open title="Delete?" onClose={jest.fn()}>
        body
      </Modal>,
    )

    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('mb-2.5')

    rerender(
      <Modal
        description="Gone for good."
        open
        title="Delete?"
        onClose={jest.fn()}
      >
        body
      </Modal>,
    )

    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('mb-1.5')
  })

  it('merges classes onto the panel and the scrim separately', () => {
    render(
      <Modal
        className="p-0"
        open
        scrimClassName="items-start"
        scrimProps={{ 'aria-label': 'backdrop' }}
        title="Delete?"
        onClose={jest.fn()}
      >
        body
      </Modal>,
    )

    expect(screen.getByRole('dialog')).toHaveClass('p-0')
    expect(screen.getByRole('dialog')).not.toHaveClass('p-[22px]')
    expect(scrim()).toHaveClass('items-start', 'p-6')
    expect(scrim()).not.toHaveClass('items-center')
    expect(scrim()).toHaveAttribute('aria-label', 'backdrop')
  })

  it('spreads the remaining props onto the panel', () => {
    render(
      <Modal
        data-testid="panel"
        id="confirm"
        open
        title="Delete?"
        onClose={jest.fn()}
      >
        body
      </Modal>,
    )

    expect(screen.getByTestId('panel')).toHaveAttribute('id', 'confirm')
  })

  it('moves focus to the first focusable element on open', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await openHarness(user)

    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
  })

  it('honours initialFocusRef, so a destructive dialog can open on Cancel', async () => {
    const user = userEvent.setup()

    render(<Harness focusCancel />)
    await openHarness(user)

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('falls back to the panel when nothing inside can take focus', () => {
    render(
      <Modal open title="Working" onClose={jest.fn()}>
        <p>Hold on.</p>
      </Modal>,
    )

    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('keeps Tab inside the dialog, wrapping off the end', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await openHarness(user)

    await user.tab()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Submit report' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus()
  })

  it('keeps Shift+Tab inside the dialog, wrapping off the start', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await openHarness(user)

    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Submit report' })).toHaveFocus()

    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('holds focus on the panel when the dialog has nothing to tab to', async () => {
    const user = userEvent.setup()

    render(
      <Modal open title="Working" onClose={jest.fn()}>
        <p>Hold on.</p>
      </Modal>,
    )

    await user.tab()

    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('closes on Escape and gives focus back to whatever opened it', async () => {
    const user = userEvent.setup()

    render(<Harness />)

    const trigger = await openHarness(user)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('restores focus however it was closed, not just on Escape', async () => {
    const user = userEvent.setup()

    render(<Harness />)

    const trigger = await openHarness(user)

    await user.click(screen.getByRole('button', { name: 'Submit report' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes on a click on the scrim itself', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await openHarness(user)

    await user.click(scrim())

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignores a click that lands on the panel', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await openHarness(user)

    await user.click(screen.getByRole('dialog'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('ignores a drag that starts in the panel and ends on the scrim', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await openHarness(user)

    const backdrop = scrim()

    fireEvent.mouseDown(screen.getByRole('dialog'))
    fireEvent.click(backdrop)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('stays put on Escape and on a scrim click when not dismissible', async () => {
    const user = userEvent.setup()

    render(<Harness dismissible={false} />)
    await openHarness(user)

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(scrim())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('leaves a key the dialog’s own contents already handled alone', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()

    render(
      <Modal open title="Delete?" onClose={onClose}>
        <button type="button" onKeyDown={event => event.preventDefault()}>
          Swallows Escape
        </button>
      </Modal>,
    )

    await user.keyboard('{Escape}')

    expect(onClose).not.toHaveBeenCalled()
  })

  it('makes the page behind inert and un-scrollable, then puts it back', async () => {
    const user = userEvent.setup()

    const { container } = render(<Harness />)

    expect(container).not.toHaveAttribute('inert')

    await openHarness(user)

    expect(container).toHaveAttribute('inert')
    expect(container).toHaveAttribute('aria-hidden', 'true')
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')

    expect(container).not.toHaveAttribute('inert')
    expect(container).not.toHaveAttribute('aria-hidden')
    expect(document.body.style.overflow).toBe('')
  })

  it('leaves the scrim itself reachable', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await openHarness(user)

    expect(scrim()).not.toHaveAttribute('inert')
  })
})

/** The reason picker, controlled the way a page task would control it. */
function Picker({
  initial,
  onChange,
}: {
  initial?: string
  onChange?: (value: string) => void
}) {
  const [value, setValue] = useState<string | undefined>(initial)

  return (
    <ReasonGroup
      aria-label="What's wrong with this file?"
      value={value}
      onValueChange={next => {
        setValue(next)
        onChange?.(next)
      }}
    >
      {REASONS.map(reason => (
        <Reason key={reason} value={reason}>
          {reason}
        </Reason>
      ))}
    </ReasonGroup>
  )
}

function radios(): HTMLElement[] {
  return screen.getAllByRole('radio')
}

describe('ReasonGroup', () => {
  it('groups the rows, which the ui.pug mixin never does', () => {
    render(<Picker />)

    expect(screen.getByRole('radiogroup')).toHaveAccessibleName(
      "What's wrong with this file?",
    )
    expect(radios()).toHaveLength(3)
  })

  it('marks exactly one row aria-checked', () => {
    render(<Picker initial={REASONS[1]} />)

    expect(radios().map(radio => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ])
  })

  it('keeps only the chosen row in the tab order', () => {
    render(<Picker initial={REASONS[1]} />)

    expect(radios().map(radio => radio.tabIndex)).toEqual([-1, 0, -1])
  })

  it('parks the tab stop on the first row while nothing is chosen', () => {
    render(<Picker />)

    expect(radios().map(radio => radio.tabIndex)).toEqual([0, -1, -1])
  })

  it('moves the tab stop with the choice rather than leaving two behind', async () => {
    const user = userEvent.setup()

    render(<Picker />)

    await user.click(screen.getByRole('radio', { name: REASONS[2] }))

    expect(radios().map(radio => radio.tabIndex)).toEqual([-1, -1, 0])
  })

  it('chooses on click', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<Picker onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: REASONS[1] }))

    expect(onChange).toHaveBeenCalledWith(REASONS[1])
    expect(screen.getByRole('radio', { name: REASONS[1] })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('moves focus and the choice with ArrowDown', async () => {
    const user = userEvent.setup()

    render(<Picker initial={REASONS[0]} />)

    screen.getByRole('radio', { name: REASONS[0] }).focus()
    await user.keyboard('{ArrowDown}')

    const second = screen.getByRole('radio', { name: REASONS[1] })

    expect(second).toHaveFocus()
    expect(second).toHaveAttribute('aria-checked', 'true')
  })

  it('treats ArrowRight and ArrowLeft as ArrowDown and ArrowUp', async () => {
    const user = userEvent.setup()

    render(<Picker initial={REASONS[0]} />)

    screen.getByRole('radio', { name: REASONS[0] }).focus()
    await user.keyboard('{ArrowRight}')

    expect(screen.getByRole('radio', { name: REASONS[1] })).toHaveFocus()

    await user.keyboard('{ArrowLeft}')

    expect(screen.getByRole('radio', { name: REASONS[0] })).toHaveFocus()
  })

  it('wraps around at both ends', async () => {
    const user = userEvent.setup()

    render(<Picker initial={REASONS[0]} />)

    screen.getByRole('radio', { name: REASONS[0] }).focus()
    await user.keyboard('{ArrowUp}')

    expect(screen.getByRole('radio', { name: REASONS[2] })).toHaveFocus()

    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('radio', { name: REASONS[0] })).toHaveFocus()
  })

  it('jumps to the ends with Home and End', async () => {
    const user = userEvent.setup()

    render(<Picker initial={REASONS[1]} />)

    screen.getByRole('radio', { name: REASONS[1] }).focus()
    await user.keyboard('{End}')

    expect(screen.getByRole('radio', { name: REASONS[2] })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.keyboard('{Home}')

    expect(screen.getByRole('radio', { name: REASONS[0] })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('chooses the focused row with Space, exactly once', async () => {
    const user = userEvent.setup()
    const onChange = jest.fn()

    render(<Picker onChange={onChange} />)

    screen.getByRole('radio', { name: REASONS[2] }).focus()
    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(REASONS[2])
  })

  it('skips disabled rows', async () => {
    const user = userEvent.setup()

    render(
      <ReasonGroup aria-label="Why?" value="a" onValueChange={jest.fn()}>
        <Reason value="a">A</Reason>
        <Reason disabled value="b">
          B
        </Reason>
        <Reason value="c">C</Reason>
      </ReasonGroup>,
    )

    screen.getByRole('radio', { name: 'A' }).focus()
    await user.keyboard('{ArrowDown}')

    expect(screen.getByRole('radio', { name: 'C' })).toHaveFocus()
  })

  it('leaves other keys to the browser', async () => {
    const user = userEvent.setup()

    render(<Picker initial={REASONS[0]} />)

    const first = screen.getByRole('radio', { name: REASONS[0] })

    first.focus()
    await user.keyboard('{PageDown}')

    expect(first).toHaveFocus()
  })

  it('finds rows through a wrapper, not a registry', () => {
    render(
      <ReasonGroup aria-label="Why?" value="b" onValueChange={jest.fn()}>
        <div>
          <Reason value="a">A</Reason>
        </div>
        <div>
          <Reason value="b">B</Reason>
        </div>
      </ReasonGroup>,
    )

    expect(radios().map(radio => radio.tabIndex)).toEqual([-1, 0])
  })
})

describe('Reason', () => {
  it('ports the mixin’s row, spaced by the adjacent-sibling rule', () => {
    render(<Picker />)

    expect(radios()[0]).toHaveClass(
      'flex',
      'items-center',
      'gap-2.5',
      'rounded-md',
      'border',
      'px-3',
      'py-[11px]',
      'transition-[border-color,background-color]',
      'duration-200',
      'ease-uv',
      '[&+&]:mt-2',
    )
  })

  it('fills the row, which the mixin gets from being a div', () => {
    render(<Picker />)

    expect(radios()[0]).toHaveClass('w-full', 'text-left')
  })

  it('tints the chosen row and leaves the rest on the plain border', () => {
    render(<Picker initial={REASONS[0]} />)

    expect(radios()[0]).toHaveClass('border-uv/40', 'bg-uv-ghost')
    expect(radios()[1]).toHaveClass('border-line')
    expect(radios()[1]).not.toHaveClass('bg-uv-ghost')
  })

  /**
   * `ui.pug` defines no hover for a reason row; this is a deliberate addition,
   * because a selectable row inside a destructive confirm was giving no
   * pointer feedback at all. The pair is `Button`'s `outline` hover verbatim,
   * so it is the system's existing vocabulary rather than new design.
   *
   * Asserted on the rendered `class` attribute — a `hover:` variant is a real
   * class, and jsdom cannot hold a hover to check the computed result.
   */
  it('gives an idle row the outline hover pair, and the chosen row none', () => {
    render(<Picker initial={REASONS[0]} />)

    expect(radios()[1]).toHaveClass('hover:border-uv-dim', 'hover:bg-surface-2')
    expect(radios()[0]).not.toHaveClass('hover:bg-surface-2')
  })

  it('fills the dot only on the chosen row', () => {
    const { container } = render(<Picker initial={REASONS[0]} />)

    const dots = Array.from(container.querySelectorAll('[role="radio"] > span'))

    expect(dots[0]).toHaveClass(
      'grid',
      'h-4',
      'w-4',
      'shrink-0',
      'place-items-center',
      'rounded-full',
      'border-[1.5px]',
      'border-uv',
      "after:content-['']",
      'after:bg-uv',
    )
    expect(dots[2]).toHaveClass('border-line-loud')
    expect(dots[2]).not.toHaveClass('border-uv')
  })

  it('sets the label at the small type size', () => {
    render(<Picker />)

    expect(screen.getByText(REASONS[0])).toHaveClass('text-sm')
  })

  it('lets a caller override the checked look', () => {
    render(
      <ReasonGroup aria-label="Why?" onValueChange={jest.fn()}>
        <Reason checked value="a">
          A
        </Reason>
      </ReasonGroup>,
    )

    expect(screen.getByRole('radio')).toHaveAttribute('aria-checked', 'true')
  })

  it('is a real button, and stays out of a form submit', () => {
    render(<Picker />)

    expect(radios()[0]?.tagName).toBe('BUTTON')
    expect(radios()[0]).toHaveAttribute('type', 'button')
  })

  it('refuses to render outside a ReasonGroup', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Reason value="a">A</Reason>)).toThrow(
      '<Reason> must be rendered inside a <ReasonGroup>',
    )

    error.mockRestore()
  })
})

describe('DeleteButton', () => {
  it('is bad-tinted rather than solid', () => {
    const { container } = render(<DeleteButton />)

    const button = screen.getByRole('button', { name: 'Delete' })

    expect(button).toHaveClass('border-bad/40', 'bg-bad-ghost', 'text-bad')
    expect(button).not.toHaveClass('bg-bad', 'border-transparent')
    expect(container.querySelector('use')).toHaveAttribute('href', '#i-trash')
  })

  /**
   * Also an addition — `ui.pug` defines none, and the highest-stakes click in
   * the app was giving no pointer feedback. It deepens the tint the button
   * already sits on rather than introducing a colour: `bad-ghost` is
   * `--color-bad` at 14% alpha, hover is the same hue at 22%.
   *
   * `Button`'s own `bad`-variant hover could not be reused: that is
   * `hover:bg-bad-ghost`, which is this button's *idle* state, so it would
   * have been a no-op.
   */
  it('deepens its own tint on hover', () => {
    render(<DeleteButton />)

    const button = screen.getByRole('button', { name: 'Delete' })

    expect(button).toHaveClass('hover:border-bad/60', 'hover:bg-bad/22')
    expect(button).not.toHaveClass('hover:bg-bad-ghost')
  })

  it('takes the mixin’s small size', () => {
    render(<DeleteButton />)

    expect(screen.getByRole('button')).toHaveClass(
      'h-[30px]',
      'px-[11px]',
      'text-[13px]',
    )
  })

  it('stretches for the stacked mobile layout', () => {
    render(<DeleteButton full />)

    expect(screen.getByRole('button')).toHaveClass('w-full')
  })

  it('takes a replacement label and fires onClick', async () => {
    const user = userEvent.setup()
    const onClick = jest.fn()

    render(<DeleteButton onClick={onClick}>Delete series</DeleteButton>)

    await user.click(screen.getByRole('button', { name: 'Delete series' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('merges a caller class over the tint', () => {
    render(<DeleteButton className="bg-transparent" />)

    expect(screen.getByRole('button')).toHaveClass('bg-transparent', 'text-bad')
    expect(screen.getByRole('button')).not.toHaveClass('bg-bad-ghost')
  })
})

describe('the delete confirmation, assembled', () => {
  it('reads as one dialog with a tinted confirm and a quiet cancel', async () => {
    const user = userEvent.setup()
    const onDelete = jest.fn()

    function Confirm() {
      const [open, setOpen] = useState(true)

      return (
        <Modal
          description="The file is removed from the library. This can't be undone."
          open={open}
          title='Delete "Dune"?'
          onClose={() => setOpen(false)}
        >
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <DeleteButton onClick={onDelete} />
          </div>
        </Modal>
      )
    }

    render(<Confirm />)

    const dialog = screen.getByRole('dialog')

    expect(dialog).toHaveAccessibleName('Delete "Dune"?')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})
