import { Injectable } from '@nestjs/common'
import { Subject } from 'rxjs'

import { isTopic, type NotifySignal, type Topic } from './sse.types'

// Framework-light in-process pub/sub bridge: an RxJS Subject wrapped behind
// publish()/stream$ so both a publisher (SupervisorService, a later unit;
// the supervisor's IPC bridge fans a bot notify in here too) and a
// subscriber (SseHubService) depend on this one narrow surface rather than
// on rxjs's Subject API directly. Provided by the @Global SseModule so
// neither side needs to import the other's module (no DI cycle).
//
// publish() is deliberately silent-and-safe on a malformed/unknown topic
// (never throws, never logs above debug — see sse-hub.service.spec.ts's
// error-path test) because every producer call site is fire-and-forget: a
// bad topic must never destabilize the write it rode in on.
@Injectable()
export class NotifyBusService {
  private readonly subject = new Subject<NotifySignal>()

  readonly stream$ = this.subject.asObservable()

  publish(topic: Topic): void {
    if (!isTopic(topic)) return
    this.subject.next({ topic })
  }
}
