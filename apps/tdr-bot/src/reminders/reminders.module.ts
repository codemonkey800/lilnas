import { DallEAPIWrapper } from '@langchain/openai'
import { TavilySearch } from '@langchain/tavily'
import { Module, type Provider } from '@nestjs/common'

import { DrizzleModule } from 'src/db/drizzle.module'
import { ModelFactoryModule } from 'src/messages/llm/model-factory.module'
import { ServicesModule } from 'src/services/services.module'

import { DALLE_WRAPPER_TOKEN, TAVILY_SEARCH_TOKEN } from './reminder.constants'
import { ReminderService } from './reminder.service'
import { ReminderDeliveryService } from './reminder-delivery.service'

const tavilySearchProvider: Provider = {
  provide: TAVILY_SEARCH_TOKEN,
  useFactory: () => new TavilySearch({ maxResults: 3 }),
}

const dalleWrapperProvider: Provider = {
  provide: DALLE_WRAPPER_TOKEN,
  useFactory: () => new DallEAPIWrapper(),
}

/**
 * Bundles reminder persistence, scheduling, and delivery.
 *
 * Provides {@link ReminderService} (exported for use by the LLM graph)
 * and {@link ReminderDeliveryService} (handles Discord message sending).
 * Also registers Tavily search and DALL-E wrapper providers for
 * action-type deliveries.
 */
@Module({
  imports: [DrizzleModule, ModelFactoryModule, ServicesModule],
  providers: [
    ReminderService,
    ReminderDeliveryService,
    tavilySearchProvider,
    dalleWrapperProvider,
  ],
  exports: [ReminderService],
})
export class RemindersModule {}
