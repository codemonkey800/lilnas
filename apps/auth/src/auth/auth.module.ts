import { Module } from '@nestjs/common'
import { AuthModule as BetterAuthNestModule } from '@thallesp/nestjs-better-auth'

import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'

import { buildAuth } from './auth'

// Mounts the Better Auth handler via @thallesp/nestjs-better-auth.
//
// disableGlobalAuthGuard: true — see
// apps/tdr-code/src/auth/auth.module.ts's identical option for the full
// "why" (short version: forRoot/forRootAsync registers its own
// deny-by-default AuthGuard as an APP_GUARD unless this is set, and that
// guard would 401 `GET /health` since it only honors its OWN @Public()
// metadata, not a future hand-rolled one). No global guard exists yet at
// all at this unit's stage — that is expected; nothing outside Better
// Auth's own mounted routes needs authorization yet.
//
// UNLIKE apps/tdr-code/src/auth/auth.module.ts, there is no `middleware`
// option here and no req.url-rewriting hook. That hook
// (`rewriteAuthRequestUrl`) exists there to reconcile a STRIPPED internal
// path ('/auth/...', what tdr-code's app-wide rewrite leaves NestJS with)
// against a PUBLIC path baseURL needs ('/api/auth/...'). This app's
// next.config.js rewrite for '/api/auth/:path*' does not strip anything —
// NestJS already receives requests at the exact path both @thallesp's own
// mount gate and Better Auth's internal router expect (see
// src/auth/auth.ts's AUTH_PATH_SEGMENT comment). There is nothing to
// reconcile. If a future change here seems to need a `middleware`
// req.url rewrite, that is a sign the next.config.js rewrite has stopped
// preserving the prefix — fix the rewrite, not this module.
//
// forRootAsync (not the sync forRoot) is required so buildAuth() can share
// the app's one better-sqlite3 connection via DI (the DB token) — no
// second handle. disableGlobalAuthGuard sits at the top level of the
// forRootAsync(...) argument (a sibling of useFactory/inject), matching the
// installed package's ASYNC_OPTIONS_TYPE shape (confirmed against
// @thallesp/nestjs-better-auth@2.6.1's dist/index.d.mts — guard
// registration happens at module-compile time and can't wait on an async
// factory's result — same citation apps/tdr-code/src/auth/auth.module.ts
// makes for the identical option).
@Module({
  imports: [
    BetterAuthNestModule.forRootAsync({
      disableGlobalAuthGuard: true,
      inject: [DB],
      useFactory: (db: Db) => ({
        auth: buildAuth(db),
      }),
    }),
  ],
})
export class AuthModule {}
