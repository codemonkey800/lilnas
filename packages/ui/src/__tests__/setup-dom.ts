// Setup module for the jsdom Jest project (wired via `setupFilesAfterEnv` in
// jest.config.js). Importing jest-dom for its side effect registers the DOM
// matchers (toBeInTheDocument, toHaveAttribute, toHaveClass, ...) on `expect`.
import '@testing-library/jest-dom'

// jsdom ships no PointerEvent, and Base UI builds one to dispatch the click
// behind a keyboard or pointer activation. A MouseEvent carries everything it
// reads.
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
