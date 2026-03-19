import { Module } from '@nestjs/common'

import { DrizzleService } from './drizzle.service'

/** Provides and exports {@link DrizzleService} for database access. */
@Module({
  providers: [DrizzleService],
  exports: [DrizzleService],
})
export class DrizzleModule {}
