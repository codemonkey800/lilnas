import '@testing-library/jest-dom'

import { QUALITY_TIER_LABELS, QualityTier } from '@lilnas/utils/download/types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import {
  QUALITY_TIER_SELECT_LABEL,
  QualityTierSelect,
  qualityTierSelectName,
} from 'src/components/detail/quality-tier-select'

function renderSelect(
  props: Partial<Parameters<typeof QualityTierSelect>[0]> = {},
) {
  const onChange = jest.fn<void, [QualityTier]>()

  const result = render(
    <QualityTierSelect onChange={onChange} value={QualityTier.Hd} {...props} />,
  )

  return { ...result, onChange, user: userEvent.setup() }
}

/** The trigger, found by its accessible name's leading word. */
function trigger(): HTMLElement {
  return screen.getByRole('combobox', { name: /^Quality:/ })
}

describe('qualityTierSelectName', () => {
  it('names the caption and the chosen tier together', () => {
    expect(qualityTierSelectName(QualityTier.UpTo4k)).toBe('Quality: Up to 4K')
  })
})

describe('QualityTierSelect', () => {
  it('names the trigger "Quality" with the chosen tier', () => {
    renderSelect({ value: QualityTier.UpTo720p })

    expect(
      screen.getByRole('combobox', { name: 'Quality: Up to 720p' }),
    ).toHaveAttribute('aria-haspopup', 'listbox')
  })

  it('draws the “Quality” label above the trigger and the value inside it', () => {
    renderSelect()

    // The label is decoration: the trigger's own `aria-label` already says it.
    expect(screen.getByText(QUALITY_TIER_SELECT_LABEL)).toHaveAttribute(
      'aria-hidden',
      'true',
    )
    expect(trigger()).toHaveTextContent('HD (up to 1080p)')
    expect(trigger()).not.toHaveTextContent(QUALITY_TIER_SELECT_LABEL)
  })

  it('lists all three tiers, best first', async () => {
    const { user } = renderSelect()

    await user.click(trigger())

    const listbox = await screen.findByRole('listbox')

    expect(
      within(listbox)
        .getAllByRole('option')
        .map(option => option.textContent),
    ).toEqual(['Up to 4K', 'HD (up to 1080p)', 'Up to 720p'])
  })

  it('marks the chosen tier selected, and only it', async () => {
    const { user } = renderSelect({ value: QualityTier.UpTo4k })

    await user.click(trigger())

    expect(
      await screen.findByRole('option', {
        name: QUALITY_TIER_LABELS[QualityTier.UpTo4k],
      }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      await screen.findByRole('option', {
        name: QUALITY_TIER_LABELS[QualityTier.Hd],
      }),
    ).toHaveAttribute('aria-selected', 'false')
  })

  it('reports a pick as the enum value and closes', async () => {
    const { onChange, user } = renderSelect()

    await user.click(trigger())
    await user.click(await screen.findByRole('option', { name: 'Up to 720p' }))

    expect(onChange).toHaveBeenCalledWith(QualityTier.UpTo720p)
    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    )
  })

  it('opens from the keyboard alone and hands focus back on Escape', async () => {
    const { user } = renderSelect()

    trigger().focus()
    await user.keyboard('{ArrowDown}')

    expect(await screen.findByRole('listbox')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() =>
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
    )
    expect(trigger()).toHaveFocus()
  })

  it('is described by the caption the row owner points it at', () => {
    render(
      <>
        <p id="row-hint">A cap, not a match.</p>
        <QualityTierSelect
          describedBy="row-hint"
          value={QualityTier.Hd}
          onChange={jest.fn()}
        />
      </>,
    )

    expect(trigger()).toHaveAccessibleDescription('A cap, not a match.')
  })

  it('has no description unless pointed at one', () => {
    renderSelect()

    expect(trigger()).not.toHaveAttribute('aria-describedby')
  })

  it('takes the trigger out of play when disabled', async () => {
    const { user } = renderSelect({ disabled: true })

    await user.click(trigger())

    expect(trigger()).toBeDisabled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('puts an outside id on the trigger, for a `<label>` to point at', () => {
    renderSelect({ id: 'tier' })

    expect(trigger()).toHaveAttribute('id', 'tier')
  })
})
