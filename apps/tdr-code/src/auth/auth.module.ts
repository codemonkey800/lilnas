import { Module } from '@nestjs/common'
import { AuthModule as BetterAuthNestModule } from '@thallesp/nestjs-better-auth'

import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'

import {
  buildAuth,
  INTERNAL_AUTH_BASE_PATH,
  PUBLIC_AUTH_PATH_SEGMENT,
} from './auth'

// Minimal structural type for what @thallesp's AuthModuleMiddleware actually
// hands us (its own type is `(req: any, res: any, next: ...) => ...`) — only
// the field rewriteAuthRequestUrl touches.
interface MutableUrlRequest {
  url: string
  originalUrl?: string
}

// Rewrites a post-Next-strip request's URL from the INTERNAL mount path
// ('/auth/...') back to the PUBLIC path segment ('/api/auth/...') that
// Better Auth's OWN internal router expects — see auth.ts's long comment
// for the full "why" (short version: Better Auth's router derives its
// match/strip prefix AND its generated redirect_uri from baseURL's own URL
// pathname, not from the instance's `basePath` field; baseURL must carry
// '/api/auth' for the redirect_uri to be byte-identical to what's
// registered in the Discord Developer Portal, but NestJS never sees
// anything other than the post-strip '/auth/*' form given the app's fixed
// Next-rewrite architecture — so this rewrite is what reconciles the two
// without touching next.config.js).
//
// Exported (not just used inline) so the rewrite logic itself is
// unit-testable in isolation, separately from the full HTTP integration
// test's black-box assertions.
export function rewriteAuthRequestUrl(req: MutableUrlRequest): void {
  if (req.url.startsWith(INTERNAL_AUTH_BASE_PATH)) {
    req.url =
      PUBLIC_AUTH_PATH_SEGMENT + req.url.slice(INTERNAL_AUTH_BASE_PATH.length)
  }
  if (
    req.originalUrl !== undefined &&
    req.originalUrl.startsWith(INTERNAL_AUTH_BASE_PATH)
  ) {
    req.originalUrl =
      PUBLIC_AUTH_PATH_SEGMENT +
      req.originalUrl.slice(INTERNAL_AUTH_BASE_PATH.length)
  }
}

// Mounts the Better Auth handler + its body-parser split via
// @thallesp/nestjs-better-auth. disableGlobalAuthGuard: true is required —
// without it, AuthModule.forRoot registers its own deny-by-default AuthGuard
// as an APP_GUARD (confirmed in dist/index.mjs: forRoot()/forRootAsync() both
// push { provide: APP_GUARD, useClass: AuthGuard } unless
// disableGlobalAuthGuard is set). That guard would honor ITS OWN @Public()
// metadata, not ours, so GET /health (annotated with our @Public() in U4)
// would still 401 — a self-inflicted health-probe outage the moment U4
// deploys. U4 hand-rolls the real global guard; at this unit's stage no
// guard exists yet at all (neither the library's nor ours), which is
// expected and correct here — there is nothing to enforce "exactly one
// guard" against until U4 lands.
//
// forRoot's only params are { auth, ...AuthModuleOptions } — no basePath
// field (confirmed against the installed package's dist/index.d.ts
// AuthModuleOptions type). The mount GATE (i.e. whether @thallesp calls the
// Better Auth handler at all for a given request) comes from the
// betterAuth() instance's own `basePath` (see auth.ts) — but see the
// `middleware` option below and auth.ts's long comment for why the gate
// passing is not the whole story.
//
// forRootAsync (not the sync forRoot) is required here because buildAuth()
// needs the injected DB token to share the app's one better-sqlite3
// connection (no second handle — see the Two-writer WAL note in the plan);
// sync forRoot has no DI access. disableGlobalAuthGuard is placed at the
// TOP level of the forRootAsync(...) argument, a sibling of useFactory/
// inject — not nested inside what useFactory returns. Confirmed from the
// installed package's dist/index.d.ts: ASYNC_OPTIONS_TYPE =
// ConfigurableModuleAsyncOptions<AuthModuleOptions<any>, "create"> &
// Partial<{ isGlobal, disableGlobalAuthGuard, disableControllers }> — the
// factory's return type is only AuthModuleOptions<any> (auth,
// disableTrustedOriginsCors?, bodyParser?, middleware?); disableGlobalAuthGuard
// is one of the "extras" intersected onto the outer call, because guard
// registration happens at module-compile time and can't wait on an async
// factory's result.
@Module({
  imports: [
    BetterAuthNestModule.forRootAsync({
      disableGlobalAuthGuard: true,
      inject: [DB],
      useFactory: (db: Db) => ({
        auth: buildAuth(db),
        // Runs only for requests that already passed @thallesp's own
        // basePath gate (matchesBasePath in its dist/index.mjs) — i.e. only
        // for requests under the internal '/auth/*' mount — right before it
        // calls Better Auth's own handler. See rewriteAuthRequestUrl's own
        // comment and auth.ts's long comment for the full mechanism this
        // closes the loop on.
        middleware: (
          req: MutableUrlRequest,
          _res: unknown,
          next: () => void,
        ) => {
          rewriteAuthRequestUrl(req)
          next()
        },
      }),
    }),
  ],
})
export class AuthModule {}
