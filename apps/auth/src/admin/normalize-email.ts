// Shared by admin.guard.ts's isAdminEmail(), users.service.ts's
// preAuthorize(), and access-cache.service.ts's pre-authorization lookup —
// a pre-authorization written under one normalized form must be findable
// by every reader keying off the same email (R7/R15's actual requirement:
// one exact-match keyspace, one normalization rule). Kept as a standalone,
// zero-import leaf module rather than folded into admin.guard.ts: that
// would make src/verify/access-cache.service.ts import from src/admin/
// admin.guard.ts, which itself imports AccessCacheService — a real
// circular module dependency that risks NestJS's `design:paramtypes`
// decorator metadata for AdminGuard's constructor resolving to `undefined`
// depending on which file happens to load first at boot (a failure mode
// nothing in this app's test suite would catch, since no spec
// DI-instantiates AdminGuard through Nest's own container). A leaf file
// with no imports of its own can never be mid-load when required, so it
// cannot participate in a cycle.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
