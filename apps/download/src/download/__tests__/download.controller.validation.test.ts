// nanoid v5 ships ESM-only and this file transitively imports code that uses
// it - see download.service.test.ts for the same guard.
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum'
import { ZodValidationPipe } from 'nestjs-zod'

import { AdminController } from 'src/admin/admin.controller'
import { DownloadController } from 'src/download/download.controller'

/**
 * One `@Body()`/`@Query()` parameter, flattened out of Nest's own route-args
 * metadata.
 */
interface RouteParam {
  handler: string
  kind: 'body' | 'query'
  pipes: unknown[]
}

/**
 * Every `@Body()` and `@Query()` parameter on a controller.
 *
 * Read from `ROUTE_ARGS_METADATA` - the same metadata Nest itself resolves
 * arguments from - rather than by parsing the source, so this cannot pass on
 * a route whose decorator says one thing and whose runtime behaviour says
 * another. The metadata is keyed `${paramtype}:${index}`.
 */
function inputParams(controller: object): RouteParam[] {
  const prototype = (controller as { prototype: object }).prototype
  const params: RouteParam[] = []

  for (const handler of Object.getOwnPropertyNames(prototype)) {
    if (handler === 'constructor') continue

    const metadata: Record<string, { pipes?: unknown[] }> | undefined =
      Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handler)

    if (!metadata) continue

    for (const [key, entry] of Object.entries(metadata)) {
      const paramtype = Number(key.split(':')[0])

      if (paramtype === RouteParamtypes.BODY) {
        params.push({ handler, kind: 'body', pipes: entry.pipes ?? [] })
      } else if (paramtype === RouteParamtypes.QUERY) {
        params.push({ handler, kind: 'query', pipes: entry.pipes ?? [] })
      }
    }
  }

  return params
}

/**
 * The regression this file exists for: six `@Body()` handlers declared
 * `createZodDto` DTOs and none of them was ever enforced. There is no global
 * pipe in `app.module.ts`, `main.ts` or `bootstrap.ts`, so a `@Body()`
 * without an explicit `ZodValidationPipe` is simply unvalidated - the DTO
 * class reads as a contract while the runtime accepts anything. Both
 * `/search` routes had the same gap on `@Query()`.
 *
 * Written structurally rather than as one test per route so it also covers
 * routes that don't exist yet: a new `@Body()` added without a pipe fails
 * here rather than in production.
 */
describe.each([
  ['DownloadController', DownloadController],
  ['AdminController', AdminController],
])('%s request validation', (_name, controller) => {
  const params = inputParams(controller)

  it('has body/query parameters to check at all', () => {
    expect(params.length).toBeGreaterThan(0)
  })

  it.each(params.map(param => [`${param.handler} (${param.kind})`, param]))(
    'validates %s',
    (_label, param) => {
      expect(
        (param as RouteParam).pipes.some(
          pipe => pipe instanceof ZodValidationPipe,
        ),
      ).toBe(true)
    },
  )
})
