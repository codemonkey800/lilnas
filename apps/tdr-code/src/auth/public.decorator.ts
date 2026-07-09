import { SetMetadata } from '@nestjs/common'

// Metadata key AuthGuard (auth.guard.ts) reads via Reflector to decide
// whether a route is exempt from the deny-by-default session check. This is
// OUR OWN metadata key — deliberately distinct from @thallesp/nestjs-better-
// auth's own IS_PUBLIC key, since that library's global guard is disabled
// (disableGlobalAuthGuard: true in auth.module.ts) and AuthGuard below is the
// only guard that ever consults this metadata. Mixing the two @Public()
// sources would be a footgun: the library's own guard — if it were ever
// re-enabled — honors only ITS key, not this one.
export const IS_PUBLIC_KEY = 'isPublic'

// Marks a route handler (or, if applied at the class level, every handler in
// a controller) as exempt from AuthGuard's session check. Used exactly once
// today: HealthController.health() (GET /health) — the Docker healthcheck's
// target, which must stay reachable with no cookie.
//
// Flat-admin invariant (R19): this decorator only ever removes the
// AUTHENTICATION requirement. There is no equivalent "requires role X"
// decorator anywhere in this app, and there must never be one — every
// authenticated guild member is a full admin.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
