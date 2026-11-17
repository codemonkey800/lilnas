// Frontend-project Jest setup (jsdom environment) — deliberately separate
// from the backend/node-environment test suite, which has no DOM concerns
// at all. Mirrors apps/tdr-code/src/app/__tests__/setup.ts's identical
// role for this app's own first component test (U6's pending page).
import '@testing-library/jest-dom'

// jsdom ships no PointerEvent, and Base UI (the Checkbox, the Sheet) builds
// one to dispatch the click behind a keyboard or pointer activation. A
// MouseEvent carries everything it reads — same stub as packages/ui's own
// setup-dom.ts.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventStub extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly isPrimary: boolean

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? ''
      this.isPrimary = init.isPrimary ?? false
    }
  }

  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    value: PointerEventStub,
  })
}
