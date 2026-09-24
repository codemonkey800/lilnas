/**
 * Shapes of Grafana's unified-alerting webhook contact point payload
 * (`version: "1"`). Every field is optional: the payload comes from an
 * external system and is parsed defensively, so nothing here is trusted
 * to be present or well-typed at runtime.
 */

export type GrafanaAlertStatus = 'firing' | 'resolved'

export interface GrafanaWebhookAlert {
  status?: GrafanaAlertStatus
  labels?: Record<string, string>
  annotations?: Record<string, string>
  startsAt?: string
  endsAt?: string
  silenceURL?: string
  dashboardURL?: string
  panelURL?: string
  generatorURL?: string
  fingerprint?: string
  values?: Record<string, number>
}

export interface GrafanaWebhookPayload {
  receiver?: string
  status?: GrafanaAlertStatus
  alerts?: GrafanaWebhookAlert[]
  groupLabels?: Record<string, string>
  commonLabels?: Record<string, string>
  commonAnnotations?: Record<string, string>
  externalURL?: string
  groupKey?: string
  truncatedAlerts?: number
  orgId?: number
  title?: string
  state?: string
  message?: string
}
