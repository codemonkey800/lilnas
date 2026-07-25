import { Inject, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import {
  getOptionsToken,
  getStorageToken,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler'

// pnpm resolves @nestjs/core to two separate physical copies for this repo:
// one for apps/theater directly, another for @nestjs/throttler's own
// dependency (its optional @nestjs/websockets peer isn't visible from
// throttler's resolution path). ThrottlerGuard injects Reflector implicitly
// by type, so it ends up asking for the *other* copy's Reflector class,
// which Nest can't find in this app's DI container. Re-declaring the
// constructor here pins Reflector to the copy this app actually uses.
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector)
  }
}
