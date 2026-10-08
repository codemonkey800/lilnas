import { CronTime } from 'cron'

import {
  CRON_PRESETS,
  CUSTOM_PRESET,
  presetFor,
} from 'src/app/reminders/cron-presets'

describe('CRON_PRESETS', () => {
  it.each(CRON_PRESETS)('$label is a valid five-field cron', ({ cron }) => {
    expect(cron.split(' ')).toHaveLength(5)
    expect(() => new CronTime(cron)).not.toThrow()
  })

  it('has unique labels', () => {
    const labels = CRON_PRESETS.map(p => p.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('presetFor', () => {
  it.each(CRON_PRESETS)('round-trips $label', ({ label, cron }) => {
    expect(presetFor(cron)).toBe(label)
  })

  it('ignores surrounding and repeated whitespace', () => {
    expect(presetFor('  0  9 * * *  ')).toBe(CRON_PRESETS[0].label)
  })

  it('returns custom for an unknown cron', () => {
    expect(presetFor('*/7 * * * *')).toBe(CUSTOM_PRESET)
    expect(presetFor('')).toBe('custom')
  })
})
