import { register } from '@prometheus-io/client'

import { TdrBotMetricsService } from 'src/tdr-bot-metrics.service'

async function value(name: string, labels: Record<string, string>) {
  const metric = await register.getSingleMetric(name)?.get()
  return metric?.values.find(v =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  )?.value
}

// prom-client creates a labelled series on its first inc, so a series that
// first appears at 1 gives increase() nothing to subtract: one failure after a
// deploy reads as 0. Known label sets must exist at 0 from startup.
describe('TdrBotMetricsService startup series', () => {
  it('exposes every handler/status pair at 0 before any message', async () => {
    new TdrBotMetricsService()

    for (const handler of ['chat', 'keywords']) {
      expect(await value('tdr_bot_messages_received_total', { handler })).toBe(
        0,
      )
      for (const status of ['success', 'error']) {
        expect(
          await value('tdr_bot_messages_handled_total', { handler, status }),
        ).toBe(0)
      }
    }
  })

  it('exposes error series for images and responses at 0', async () => {
    new TdrBotMetricsService()

    for (const status of ['success', 'error']) {
      expect(await value('tdr_bot_image_generations_total', { status })).toBe(0)
    }
    for (const status of [
      'success',
      'shortened',
      'truncated',
      'error',
      'fallback',
    ]) {
      expect(await value('tdr_bot_responses_sent_total', { status })).toBe(0)
    }
  })

  it('exposes every skill/status pair at 0 once skills are known', async () => {
    const svc = new TdrBotMetricsService()
    svc.initLlmRequests(['chat', 'math'])

    for (const skill of ['chat', 'math']) {
      for (const status of ['success', 'error']) {
        expect(
          await value('tdr_bot_llm_requests_total', { skill, status }),
        ).toBe(0)
      }
    }
  })

  it('counts the first error after startup', async () => {
    const svc = new TdrBotMetricsService()
    svc.messageHandled('chat', 'error')

    expect(
      await value('tdr_bot_messages_handled_total', {
        handler: 'chat',
        status: 'error',
      }),
    ).toBe(1)
  })
})
