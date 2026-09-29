import '@testing-library/jest-dom'

import { QUALITY_TIER_LABELS, QualityTier } from '@lilnas/utils/download/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

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
  return screen.getByRole('button', { name: /^Quality:/ })
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
      screen.getByRole('button', { name: 'Quality: Up to 720p' }),
    ).toHaveAttribute('aria-haspopup', 'listbox')
  })

  it('draws the mockup’s caption and value inside the trigger', () => {
    renderSelect()

    expect(trigger()).toHaveTextContent(QUALITY_TIER_SELECT_LABEL)
    expect(trigger()).toHaveTextContent('HD (up to 1080p)')
  })

  it('lists all three tiers, best first, under the same name', async () => {
    const { user } = renderSelect()

    await user.click(trigger())

    const listbox = screen.getByRole('listbox', { name: /^Quality/ })

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
      screen.getByRole('option', {
        name: QUALITY_TIER_LABELS[QualityTier.UpTo4k],
      }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      screen.getByRole('option', { name: QUALITY_TIER_LABELS[QualityTier.Hd] }),
    ).toHaveAttribute('aria-selected', 'false')
  })

  it('reports a pick as the enum value and closes', async () => {
    const { onChange, user } = renderSelect()

    await user.click(trigger())
    await user.click(screen.getByRole('option', { name: 'Up to 720p' }))

    expect(onChange).toHaveBeenCalledWith(QualityTier.UpTo720p)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('is picked from the keyboard too', async () => {
    function Harness() {
      const [value, setValue] = useState<QualityTier>(QualityTier.Hd)

      return <QualityTierSelect onChange={setValue} value={value} />
    }

    render(<Harness />)
    const user = userEvent.setup()

    trigger().focus()
    await user.keyboard('{ArrowDown}')
    // Opening lands on the selected option — HD — so one more ArrowDown is 720p.
    await user.keyboard('{ArrowDown}{Enter}')

    expect(
      screen.getByRole('button', { name: 'Quality: Up to 720p' }),
    ).toHaveFocus()
  })

  it('draws a hint under the trigger and describes the trigger with it', () => {
    renderSelect({ hint: 'Applies to the whole show' })

    expect(trigger()).toHaveAccessibleDescription('Applies to the whole show')
  })

  it('draws no hint when given none', () => {
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
