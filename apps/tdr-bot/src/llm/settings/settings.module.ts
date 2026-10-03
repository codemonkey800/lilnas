import { Module } from '@nestjs/common'

import { DrizzleModule } from 'src/db/drizzle.module'
import { ModelRegistry } from 'src/llm/models/model-registry'
import { SettingsService } from 'src/llm/settings/settings.service'

@Module({
  imports: [DrizzleModule],
  providers: [ModelRegistry, SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
