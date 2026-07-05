import { NotifyBusService } from 'src/sse/notify-bus.service'
import type { NotifySignal } from 'src/sse/sse.types'

describe('NotifyBusService', () => {
  it('publish() emits the topic on stream$ to a subscriber', () => {
    const bus = new NotifyBusService()
    const received: NotifySignal[] = []
    const sub = bus.stream$.subscribe(signal => received.push(signal))

    bus.publish('bot-status')

    expect(received).toEqual([{ topic: 'bot-status' }])
    sub.unsubscribe()
  })

  it('publish() fans the same signal to every subscriber', () => {
    const bus = new NotifyBusService()
    const a: NotifySignal[] = []
    const b: NotifySignal[] = []
    const subA = bus.stream$.subscribe(signal => a.push(signal))
    const subB = bus.stream$.subscribe(signal => b.push(signal))

    bus.publish('live')

    expect(a).toEqual([{ topic: 'live' }])
    expect(b).toEqual([{ topic: 'live' }])
    subA.unsubscribe()
    subB.unsubscribe()
  })

  it('publish() with a session topic round-trips the parameterized topic', () => {
    const bus = new NotifyBusService()
    const received: NotifySignal[] = []
    const sub = bus.stream$.subscribe(signal => received.push(signal))

    bus.publish('session:42')

    expect(received).toEqual([{ topic: 'session:42' }])
    sub.unsubscribe()
  })

  it('error path: a malformed/unknown topic is ignored without throwing', () => {
    const bus = new NotifyBusService()
    const received: NotifySignal[] = []
    const sub = bus.stream$.subscribe(signal => received.push(signal))

    expect(() => bus.publish('not-a-real-topic' as never)).not.toThrow()
    expect(() => bus.publish('' as never)).not.toThrow()
    expect(() => bus.publish(undefined as never)).not.toThrow()

    expect(received).toEqual([])
    sub.unsubscribe()
  })

  it('a subscriber added after publish() does not receive the earlier signal (Subject, not ReplaySubject)', () => {
    const bus = new NotifyBusService()
    bus.publish('live')

    const received: NotifySignal[] = []
    const sub = bus.stream$.subscribe(signal => received.push(signal))
    expect(received).toEqual([])
    sub.unsubscribe()
  })
})
