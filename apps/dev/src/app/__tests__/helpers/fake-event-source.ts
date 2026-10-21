/** Just enough of EventSource for the components: the tests drive it by hand. */
export class FakeEventSource {
  static instances: FakeEventSource[] = []

  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = jest.fn()

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  /** The stream connects. */
  open() {
    this.onopen?.()
  }

  /** The server sends one message; `payload` is JSON-encoded like the wire. */
  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  /** The connection drops. */
  fail() {
    this.onerror?.()
  }

  static reset() {
    FakeEventSource.instances = []
  }

  /** Streams whose URL contains `part`, oldest first. */
  static matching(part: string): FakeEventSource[] {
    return FakeEventSource.instances.filter(s => s.url.includes(part))
  }

  /** The newest stream whose URL contains `part`. */
  static latest(part: string): FakeEventSource {
    const found = FakeEventSource.matching(part).at(-1)
    if (!found) throw new Error(`no event stream opened for ${part}`)
    return found
  }
}
