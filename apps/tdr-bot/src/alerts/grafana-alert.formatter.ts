import type { APIEmbed, APIEmbedField } from 'discord.js'

import type {
  GrafanaAlertStatus,
  GrafanaWebhookAlert,
  GrafanaWebhookPayload,
} from './grafana-webhook.types'

/** Discord embed limits: https://discord.com/developers/docs/resources/message#embed-object-embed-limits */
export const DISCORD_EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  /** Combined across every embed in a single message. */
  totalPerMessage: 6000,
  embedsPerMessage: 10,
} as const

/**
 * Per-alert caps chosen so a single embed stays under the 6000-char
 * per-message budget by construction: title 256 + summary 2048 +
 * description 1024 + links 1024 + two label values 256 each + two
 * timestamps + field names is well under 6000.
 */
const SUMMARY_MAX_LENGTH = 2048
const LABEL_VALUE_MAX_LENGTH = 256

export const ALERT_COLORS = {
  resolved: 0x2ecc71,
  critical: 0xe74c3c,
  warning: 0xe67e22,
  other: 0x95a5a6,
} as const

/** Grafana's zero time (`0001-01-01T00:00:00Z`) means "not set". */
const MIN_VALID_TIMESTAMP_MS = 0

const TEST_ALERT_NAME = 'TestAlert'

export interface FormattedGrafanaAlerts {
  /** Each inner array is one Discord message's worth of embeds. */
  batches: APIEmbed[][]
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text

  return `${text.slice(0, max - 1)}…`
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()

  return trimmed.length > 0 ? trimmed : undefined
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const record: Record<string, string> = {}

  for (const [key, entry] of Object.entries(value)) {
    const str = nonEmptyString(entry)

    if (str) record[key] = str
  }

  return record
}

function httpUrl(value: unknown): string | undefined {
  const candidate = nonEmptyString(value)

  if (!candidate) return undefined

  try {
    const url = new URL(candidate)

    return url.protocol === 'http:' || url.protocol === 'https:'
      ? candidate
      : undefined
  } catch {
    return undefined
  }
}

function parseStatus(value: unknown): GrafanaAlertStatus | undefined {
  return value === 'firing' || value === 'resolved' ? value : undefined
}

function parseTime(value: unknown): Date | undefined {
  const str = nonEmptyString(value)

  if (!str) return undefined

  const date = new Date(str)
  const ms = date.getTime()

  return Number.isNaN(ms) || ms <= MIN_VALID_TIMESTAMP_MS ? undefined : date
}

function discordTimestamp(date: Date): string {
  const unix = Math.floor(date.getTime() / 1000)

  return `<t:${unix}:f> (<t:${unix}:R>)`
}

/**
 * Grafana's contact-point "Test" button sends one alert labelled
 * `alertname: TestAlert`, which formats like any other alert. Older
 * versions sent only a `title` mentioning TestAlert with no alerts; treat
 * that as a single synthetic alert so the test still posts.
 */
function isBareTestNotification(payload: GrafanaWebhookPayload): boolean {
  return (
    typeof payload.title === 'string' && payload.title.includes(TEST_ALERT_NAME)
  )
}

function collectAlerts(payload: GrafanaWebhookPayload): GrafanaWebhookAlert[] {
  const alerts = Array.isArray(payload.alerts)
    ? payload.alerts.filter(
        (alert): alert is GrafanaWebhookAlert =>
          !!alert && typeof alert === 'object',
      )
    : []

  if (alerts.length > 0 || !isBareTestNotification(payload)) return alerts

  return [
    {
      status: 'firing',
      labels: { alertname: TEST_ALERT_NAME, instance: 'Grafana' },
      annotations: { summary: 'Notification test' },
    },
  ]
}

function alertColor(status: GrafanaAlertStatus, severity?: string): number {
  if (status === 'resolved') return ALERT_COLORS.resolved

  switch (severity?.toLowerCase()) {
    case 'critical':
      return ALERT_COLORS.critical

    case 'warning':
      return ALERT_COLORS.warning

    default:
      return ALERT_COLORS.other
  }
}

function linksField(
  alert: GrafanaWebhookAlert,
  annotations: Record<string, string>,
): APIEmbedField | undefined {
  const candidates: Array<[string, string | undefined]> = [
    ['Silence', httpUrl(alert.silenceURL)],
    ['Dashboard', httpUrl(alert.dashboardURL)],
    ['Runbook', httpUrl(annotations.runbook_url)],
  ]

  const links: string[] = []
  let length = 0

  for (const [label, url] of candidates) {
    if (!url) continue

    const link = `[${label}](${url})`
    const added = link.length + (links.length > 0 ? 3 : 0)

    // Drop a link rather than truncate it: a cut URL is a broken URL.
    if (length + added > DISCORD_EMBED_LIMITS.fieldValue) continue

    links.push(link)
    length += added
  }

  return links.length > 0
    ? { name: 'Links', value: links.join(' · '), inline: false }
    : undefined
}

function buildAlertEmbed(
  alert: GrafanaWebhookAlert,
  payload: GrafanaWebhookPayload,
): APIEmbed {
  const labels = stringRecord(alert.labels)
  const annotations = stringRecord(alert.annotations)
  const groupLabels = stringRecord(payload.groupLabels)
  const effectiveStatus: GrafanaAlertStatus =
    parseStatus(alert.status) ?? parseStatus(payload.status) ?? 'firing'
  const alertName = labels.alertname ?? groupLabels.alertname ?? 'Grafana alert'
  const severity = labels.severity
  const startedAt = parseTime(alert.startsAt)
  const endedAt =
    effectiveStatus === 'resolved' ? parseTime(alert.endsAt) : undefined

  const fields: APIEmbedField[] = []

  if (annotations.description) {
    fields.push({
      name: 'Description',
      value: truncate(annotations.description, DISCORD_EMBED_LIMITS.fieldValue),
      inline: false,
    })
  }

  if (startedAt) {
    fields.push({
      name: 'Started',
      value: discordTimestamp(startedAt),
      inline: true,
    })
  }

  if (endedAt) {
    fields.push({
      name: 'Resolved',
      value: discordTimestamp(endedAt),
      inline: true,
    })
  }

  if (labels.job) {
    fields.push({
      name: 'Job',
      value: truncate(labels.job, LABEL_VALUE_MAX_LENGTH),
      inline: true,
    })
  }

  if (severity) {
    fields.push({
      name: 'Severity',
      value: truncate(severity, LABEL_VALUE_MAX_LENGTH),
      inline: true,
    })
  }

  const links = linksField(alert, annotations)

  if (links) fields.push(links)

  const embed: APIEmbed = {
    title: truncate(
      `[${effectiveStatus.toUpperCase()}] ${alertName}`,
      DISCORD_EMBED_LIMITS.title,
    ),
    color: alertColor(effectiveStatus, severity),
  }

  if (annotations.summary) {
    embed.description = truncate(annotations.summary, SUMMARY_MAX_LENGTH)
  }

  if (fields.length > 0) embed.fields = fields

  const timestamp = endedAt ?? startedAt

  if (timestamp) embed.timestamp = timestamp.toISOString()

  return embed
}

/**
 * Character count Discord charges against the per-message 6000 budget:
 * title, description, field names and values, footer text, author name.
 */
export function embedLength(embed: APIEmbed): number {
  let length = (embed.title?.length ?? 0) + (embed.description?.length ?? 0)

  for (const field of embed.fields ?? []) {
    length += field.name.length + field.value.length
  }

  length += embed.footer?.text.length ?? 0
  length += embed.author?.name.length ?? 0

  return length
}

/**
 * Splits embeds into per-message batches honouring both Discord limits:
 * at most 10 embeds and at most 6000 combined characters per message.
 */
export function batchEmbeds(embeds: APIEmbed[]): APIEmbed[][] {
  const batches: APIEmbed[][] = []
  let current: APIEmbed[] = []
  let currentLength = 0

  for (const embed of embeds) {
    const length = embedLength(embed)
    const full =
      current.length >= DISCORD_EMBED_LIMITS.embedsPerMessage ||
      currentLength + length > DISCORD_EMBED_LIMITS.totalPerMessage

    if (current.length > 0 && full) {
      batches.push(current)
      current = []
      currentLength = 0
    }

    current.push(embed)
    currentLength += length
  }

  if (current.length > 0) batches.push(current)

  return batches
}

/** Builds one embed per alert in a Grafana webhook payload. */
export function buildGrafanaAlertEmbeds(
  payload: GrafanaWebhookPayload,
): APIEmbed[] {
  return collectAlerts(payload).map(alert => buildAlertEmbed(alert, payload))
}

/**
 * Formats a Grafana webhook payload into Discord embeds, pre-split into
 * message-sized batches. An empty `batches` array means nothing to post.
 */
export function formatGrafanaAlerts(
  payload: GrafanaWebhookPayload,
): FormattedGrafanaAlerts {
  return { batches: batchEmbeds(buildGrafanaAlertEmbeds(payload)) }
}
