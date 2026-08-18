import { Global, Module } from '@nestjs/common'

import { DbService } from './db.service'

// @Global() so any future feature module can inject DbService without an
// explicit `imports: [DbModule]` — mirrors apps/auth's own @Global()
// DatabaseModule. Still must be imported ONCE, in app.module.ts.
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule {}
