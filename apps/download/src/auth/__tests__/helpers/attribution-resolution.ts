import { AttributionResolutionService } from 'src/auth/attribution-resolution.service'

/**
 * The DI provider for every suite that is *not* about link resolution.
 *
 * `AttributionResolutionService` sits on the read path of `DownloadController`,
 * `AdminController` and `DownloadStateService`'s WS broadcast, so adding it to
 * those constructors made it a required dependency of a large number of
 * existing testing modules. Almost none of them care what it does: a route
 * test asserting on a 404, a cursor, or a broadcast payload wants the rows it
 * already built, unchanged.
 *
 * So this is an identity pass-through, which is also exactly what the real
 * service does for a row with no Discord identity and an unlinked requester -
 * the shape every one of those fixtures has. Resolution itself is covered by
 * `attribution-resolution.service.spec.ts` and, end-to-end through a route, by
 * `download.controller.attribution-resolution.test.ts`.
 *
 * `jest.fn` rather than a plain arrow so a suite that *does* want to assert
 * "the route resolved before masking" can reach for `toHaveBeenCalledWith`
 * without re-declaring the provider.
 */
export function fakeAttributionResolutionProvider() {
  return {
    provide: AttributionResolutionService,
    useValue: {
      resolveAuditEntries: jest.fn(<T>(rows: readonly T[]) =>
        Promise.resolve([...rows]),
      ),
      resolveGalleryItems: jest.fn(<T>(rows: readonly T[]) =>
        Promise.resolve([...rows]),
      ),
      resolveJobs: jest.fn(<T>(rows: readonly T[]) =>
        Promise.resolve([...rows]),
      ),
    },
  }
}
