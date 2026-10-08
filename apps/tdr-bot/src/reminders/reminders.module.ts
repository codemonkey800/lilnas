import { TavilySearch } from '@langchain/tavily'
import { Module, type Provider } from '@nestjs/common'

import { DrizzleModule } from 'src/db/drizzle.module'
import { LlmCoreModule } from 'src/llm/llm-core.module'
import { ServicesModule } from 'src/services/services.module'

import { TAVILY_SEARCH_TOKEN } from './reminder.constants'
import { ReminderRepository } from './reminder.repository'
import { ReminderService } from './reminder.service'
import { ReminderDeliveryService } from './reminder-delivery.service'
import { ReminderSchedulerService } from './reminder-scheduler.service'

const tavilySearchProvider: Provider = {
  provide: TAVILY_SEARCH_TOKEN,
  useFactory: () => new TavilySearch({ maxResults: 3 }),
}

/**
 * Bundles reminder persistence, scheduling, and delivery.
 *
 * Provides {@link ReminderService} (exported for use by the LLM graph),
 * {@link ReminderDeliveryService} (Discord message sending) and
 * {@link ReminderSchedulerService} (DB-polled due-reminder loop).
 * Also registers the Tavily search provider for action-type deliveries.
 */
@Module({
  imports: [DrizzleModule, LlmCoreModule, ServicesModule],
  providers: [
    ReminderService,
    ReminderDeliveryService,
    ReminderRepository,
    ReminderSchedulerService,
    tavilySearchProvider,
  ],
  exports: [
    ReminderService,
    ReminderRepository,
    ReminderDeliveryService,
    ReminderSchedulerService,
  ],
})
export class RemindersModule {}
