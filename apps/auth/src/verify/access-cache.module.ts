import { Module } from '@nestjs/common'

import { AccessCacheService } from './access-cache.service'

// AccessCacheService needs its own module, rather than being a bare
// AppModule provider, because src/sse/sse.module.ts — a SEPARATE module —
// also depends on it (SseController resolves connection identity via the
// same resolveSession() /verify itself uses). A provider declared directly
// in AppModule's own `providers` array is only visible to OTHER bare
// AppModule providers (same-module resolution), never to a different
// module's own controllers/providers unless it is exported from a module
// that one explicitly imports — this is what SseModule was missing before
// this module existed, surfaced only by actually booting the app (Nest's
// DI container has no equivalent check at the unit-test level, where every
// existing *.spec.ts constructs its classes directly rather than through
// Nest's own module graph).
//
// AuthService (injected inside AccessCacheService) needs no explicit
// AuthModule import here: @thallesp/nestjs-better-auth's forRootAsync()
// registers itself with `isGlobal: true` by default (confirmed in
// installed @thallesp/nestjs-better-auth@2.6.1's dist/index.mjs), and
// src/auth/auth.module.ts does not override that default. The DB token
// needs no explicit DatabaseModule import either, for the same reason —
// database.module.ts's DatabaseModule is itself `@Global()`.
@Module({
  providers: [AccessCacheService],
  exports: [AccessCacheService],
})
export class AccessCacheModule {}
