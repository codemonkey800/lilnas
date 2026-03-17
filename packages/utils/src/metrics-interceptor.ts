import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Counter, Histogram, register } from 'prom-client'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
})

const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const req = context.switchToHttp().getRequest()
    const { method } = req
    const route = req.route?.path ?? req.url
    const timer = httpRequestDuration.startTimer({ method, route })

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = String(
            context.switchToHttp().getResponse().statusCode,
          )
          timer({ status_code: statusCode })
          httpRequestsTotal.inc({ method, route, status_code: statusCode })
        },
        error: (err: unknown) => {
          const statusCode = String((err as { status?: number })?.status ?? 500)
          timer({ status_code: statusCode })
          httpRequestsTotal.inc({ method, route, status_code: statusCode })
        },
      }),
    )
  }
}
