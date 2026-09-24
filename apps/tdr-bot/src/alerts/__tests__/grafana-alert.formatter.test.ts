import type { APIEmbed } from 'discord.js'

import {
  ALERT_COLORS,
  batchEmbeds,
  buildGrafanaAlertEmbeds,
  DISCORD_EMBED_LIMITS,
  embedLength,
  formatGrafanaAlerts,
} from 'src/alerts/grafana-alert.formatter'
import type {
  GrafanaWebhookAlert,
  GrafanaWebhookPayload,
} from 'src/alerts/grafana-webhook.types'

const STARTS_AT = '2026-09-24T10:00:00Z'
const STARTS_AT_UNIX = Math.floor(Date.parse(STARTS_AT) / 1000)

function firingCritical(
  overrides: Partial<GrafanaWebhookAlert> = {},
): GrafanaWebhookAlert {
  return {
    status: 'firing',
    labels: {
      alertname: 'NexusDaemonDown',
      job: 'nexus-code',
      severity: 'critical',
    },
    annotations: {
      summary: 'Nexus daemon is down',
      description: 'The nexus-code scrape target has been down for 2 minutes.',
      runbook_url: 'https://docs.lilnas.io/runbooks/nexus-daemon-down',
    },
    startsAt: STARTS_AT,
    endsAt: '0001-01-01T00:00:00Z',
    silenceURL:
      'https://grafana.lilnas.io/alerting/silence/new?alertmanager=grafana',
    dashboardURL: 'https://grafana.lilnas.io/d/nexus',
    fingerprint: 'abc123',
    ...overrides,
  }
}

function onlyEmbed(payload: GrafanaWebhookPayload): APIEmbed {
  const { batches } = formatGrafanaAlerts(payload)

  expect(batches).toHaveLength(1)
  expect(batches[0]).toHaveLength(1)

  return batches[0][0]
}

function fieldNames(embed: APIEmbed): string[] {
  return (embed.fields ?? []).map(field => field.name)
}

describe('formatGrafanaAlerts', () => {
  it('formats a firing critical alert as a red embed with title, summary and fields', () => {
    const embed = onlyEmbed({ status: 'firing', alerts: [firingCritical()] })

    expect(embed.title).toBe('[FIRING] NexusDaemonDown')
    expect(embed.color).toBe(ALERT_COLORS.critical)
    expect(embed.description).toBe('Nexus daemon is down')
    expect(embed.timestamp).toBe(new Date(STARTS_AT).toISOString())

    expect(embed.fields).toEqual([
      {
        name: 'Description',
        value: 'The nexus-code scrape target has been down for 2 minutes.',
        inline: false,
      },
      {
        name: 'Started',
        value: `<t:${STARTS_AT_UNIX}:f> (<t:${STARTS_AT_UNIX}:R>)`,
        inline: true,
      },
      { name: 'Job', value: 'nexus-code', inline: true },
      { name: 'Severity', value: 'critical', inline: true },
      {
        name: 'Links',
        value:
          '[Silence](https://grafana.lilnas.io/alerting/silence/new?alertmanager=grafana) · ' +
          '[Dashboard](https://grafana.lilnas.io/d/nexus) · ' +
          '[Runbook](https://docs.lilnas.io/runbooks/nexus-daemon-down)',
        inline: false,
      },
    ])
  })

  it('colors a firing warning alert orange and an unknown severity grey', () => {
    const warning = onlyEmbed({
      alerts: [
        firingCritical({ labels: { alertname: 'A', severity: 'warning' } }),
      ],
    })
    const info = onlyEmbed({
      alerts: [
        firingCritical({ labels: { alertname: 'B', severity: 'info' } }),
      ],
    })

    expect(warning.color).toBe(ALERT_COLORS.warning)
    expect(info.color).toBe(ALERT_COLORS.other)
  })

  it('formats a resolved alert as a green embed with a resolved time', () => {
    const embed = onlyEmbed({
      status: 'resolved',
      alerts: [
        firingCritical({
          status: 'resolved',
          endsAt: '2026-09-24T10:05:00Z',
        }),
      ],
    })

    expect(embed.title).toBe('[RESOLVED] NexusDaemonDown')
    expect(embed.color).toBe(ALERT_COLORS.resolved)
    expect(fieldNames(embed)).toContain('Resolved')
    expect(embed.timestamp).toBe('2026-09-24T10:05:00.000Z')
  })

  it('falls back to the payload status when the alert has none', () => {
    const embed = onlyEmbed({
      status: 'resolved',
      alerts: [firingCritical({ status: undefined })],
    })

    expect(embed.title).toBe('[RESOLVED] NexusDaemonDown')
  })

  it('omits the description and empty fields when annotations and labels are missing', () => {
    const embed = onlyEmbed({
      alerts: [{ status: 'firing', labels: { alertname: 'Bare' } }],
    })

    expect(embed.title).toBe('[FIRING] Bare')
    expect(embed.description).toBeUndefined()
    expect(embed.fields).toBeUndefined()
    expect(embed.timestamp).toBeUndefined()
    expect(embed.color).toBe(ALERT_COLORS.other)
  })

  it('never emits a field with an empty value', () => {
    const embed = onlyEmbed({
      alerts: [
        firingCritical({
          annotations: { summary: 'x', description: '   ' },
          labels: { alertname: 'X', job: '', severity: '' },
          silenceURL: '',
          dashboardURL: 'not a url',
          startsAt: 'garbage',
        }),
      ],
    })

    expect(embed.fields).toBeUndefined()
  })

  it('drops non-http links', () => {
    const embed = onlyEmbed({
      alerts: [
        firingCritical({
          silenceURL: 'javascript:alert(1)',
          dashboardURL: undefined,
          annotations: { runbook_url: 'https://runbooks.example/x' },
        }),
      ],
    })

    const links = embed.fields?.find(field => field.name === 'Links')

    expect(links?.value).toBe('[Runbook](https://runbooks.example/x)')
  })

  it('splits 12 alerts into two batches of 10 and 2', () => {
    const alerts = Array.from({ length: 12 }, (_, i) =>
      firingCritical({ labels: { alertname: `Alert${i}` } }),
    )

    const { batches } = formatGrafanaAlerts({ status: 'firing', alerts })

    expect(batches.map(batch => batch.length)).toEqual([10, 2])
    expect(batches[1][1].title).toBe('[FIRING] Alert11')
  })

  it('truncates a long description field at 1024 characters', () => {
    const embed = onlyEmbed({
      alerts: [
        firingCritical({
          annotations: { description: 'x'.repeat(5000) },
        }),
      ],
    })

    const description = embed.fields?.find(
      field => field.name === 'Description',
    )

    expect(description?.value).toHaveLength(DISCORD_EMBED_LIMITS.fieldValue)
    expect(description?.value.endsWith('…')).toBe(true)
  })

  it('keeps a maximally long alert under the per-message size limit', () => {
    const long = 'y'.repeat(10_000)
    const url = `https://grafana.lilnas.io/${'z'.repeat(400)}`
    const [embed] = buildGrafanaAlertEmbeds({
      alerts: [
        {
          status: 'firing',
          labels: { alertname: long, job: long, severity: long },
          annotations: {
            summary: long,
            description: long,
            runbook_url: url,
          },
          startsAt: STARTS_AT,
          silenceURL: url,
          dashboardURL: url,
        },
      ],
    })

    expect(embedLength(embed)).toBeLessThanOrEqual(
      DISCORD_EMBED_LIMITS.totalPerMessage,
    )
    expect(embed.title?.length).toBeLessThanOrEqual(DISCORD_EMBED_LIMITS.title)

    for (const field of embed.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(
        DISCORD_EMBED_LIMITS.fieldValue,
      )
    }
  })

  it('returns no batches for missing or empty alerts', () => {
    expect(formatGrafanaAlerts({}).batches).toEqual([])
    expect(formatGrafanaAlerts({ alerts: [] }).batches).toEqual([])
    expect(
      formatGrafanaAlerts({ alerts: 'nope' as unknown as [] }).batches,
    ).toEqual([])
  })

  it('formats Grafana 13 test notifications (single TestAlert alert)', () => {
    const embed = onlyEmbed({
      status: 'firing',
      title: '[FIRING:1]  (TestAlert Grafana)',
      alerts: [
        {
          status: 'firing',
          labels: { alertname: 'TestAlert', instance: 'Grafana' },
          annotations: { summary: 'Notification test' },
          startsAt: STARTS_AT,
        },
      ],
    })

    expect(embed.title).toBe('[FIRING] TestAlert')
    expect(embed.description).toBe('Notification test')
  })

  it('synthesizes one alert for a bare TestAlert notification without alerts', () => {
    const embed = onlyEmbed({ title: '[FIRING:1]  (TestAlert Grafana)' })

    expect(embed.title).toBe('[FIRING] TestAlert')
    expect(embed.description).toBe('Notification test')
  })
})

describe('batchEmbeds', () => {
  it('starts a new batch before the combined size would exceed 6000 chars', () => {
    const embed: APIEmbed = { title: 't', description: 'd'.repeat(2499) }

    const batches = batchEmbeds([embed, embed, embed])

    expect(batches.map(batch => batch.length)).toEqual([2, 1])
  })

  it('returns an empty list for no embeds', () => {
    expect(batchEmbeds([])).toEqual([])
  })
})
