import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'

import { SessionManagerService } from './agent/session-manager.service'
import { BotModule } from './bot.module'
import { loadMasterKey } from './crypto/master-key'
import { BotLifecycleService } from './discord/bot-lifecycle.service'

export async function bootstrapBot() {
  // Mirror bootstrap.ts umask so tmpfs key files (U9) are not world-readable
  // before their chmod 600 (Decision #7 TOCTOU mitigation).
  process.umask(0o077)

  // Fail fast if the master key is missing — never boot into a silent
  // fleet-wide decrypt_failed state (Decision #7). Must run before any module
  // init so a crash here is clearly the key-provisioning issue.
  loadMasterKey()

  const app = await NestFactory.createApplicationContext(BotModule, {
    bufferLogs: true,
  })
  app.useLogger(app.get(Logger))
  app.enableShutdownHooks()

  // Single ordered shutdown sequence — this is the sole authority for ordering.
  // NestJS onApplicationShutdown on SessionManagerService is idempotent so
  // the concurrent lifecycle hook cannot race this explicit sequence.
  const shutdown = () => {
    const forceExit = setTimeout(() => process.exit(1), 8_000)
    forceExit.unref()

    const lifecycle = app.get(BotLifecycleService)
    const sessionManager = app.get(SessionManagerService)

    // 1. Mark shutdown so ready/heartbeat events are no-ops.
    lifecycle.markShutdownRequested()

    // 2a. Stop the live_status heartbeat BEFORE finalizeGeneration (Decision 8c).
    // If cleared in onModuleDestroy (during app.close()) instead, one more beat
    // fires after finalize and stamps a fresh last_heartbeat_at on a dead generation.
    sessionManager.stopLiveStatusHeartbeat()

    // 2b. Tear down all sessions (kills claude process trees).
    try {
      sessionManager.onApplicationShutdown()
    } catch (err) {
      app.get(Logger).error({ err }, 'Session teardown error during shutdown')
    } finally {
      // 3. Finalize the generation row — runs even if step 2 throws.
      lifecycle.finalizeGeneration(0)
    }

    void app
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1))
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
