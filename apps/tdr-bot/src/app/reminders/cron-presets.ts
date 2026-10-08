export interface CronPreset {
  label: string
  cron: string
}

export const CRON_PRESETS: CronPreset[] = [
  { label: 'Every day 9 AM', cron: '0 9 * * *' },
  { label: 'Weekdays 9 AM', cron: '0 9 * * 1-5' },
  { label: 'Every Monday 9 AM', cron: '0 9 * * 1' },
  { label: 'Every hour', cron: '0 * * * *' },
]

export const CUSTOM_PRESET = 'custom'

/** Label of the preset matching `cron`, or `custom` when none does. */
export function presetFor(cron: string): string {
  const normalized = cron.trim().split(/\s+/).join(' ')
  return CRON_PRESETS.find(p => p.cron === normalized)?.label ?? CUSTOM_PRESET
}
