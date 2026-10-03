import { Module } from '@nestjs/common'

import { RetryConfigService } from 'src/config/retry.config'
import { DrizzleModule } from 'src/db/drizzle.module'
import { LlmCallsRepository } from 'src/llm/audit/llm-calls.repository'
import { DefaultLlmClient } from 'src/llm/client/default-llm-client'
import { LlmClient } from 'src/llm/client/llm-client'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { LlmMetricsService } from 'src/llm/observability/llm-metrics.service'
import { OpenAiProvider } from 'src/llm/providers/openai.provider'
import { SettingsModule } from 'src/llm/settings/settings.module'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

@Module({
  imports: [DrizzleModule, SettingsModule],
  providers: [
    LlmCallsRepository,
    ModelRegistry,
    LlmMetricsService,
    OpenAiProvider,
    RetryService,
    ErrorClassificationService,
    RetryConfigService,
    { provide: LlmClient, useClass: DefaultLlmClient },
  ],
  exports: [
    LlmClient,
    LlmCallsRepository,
    ModelRegistry,
    SettingsModule,
    LlmMetricsService,
  ],
})
export class LlmCoreModule {}
