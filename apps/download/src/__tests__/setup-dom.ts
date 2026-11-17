// Setup module for the jsdom Jest project only (wired via that project's
// `setupFilesAfterEnv` in jest.config.js). The backend/node project has no
// DOM concerns and deliberately does not load this — see jest.config.js for
// why the two projects are split at all.
//
// Importing jest-dom for its side effect registers the DOM matchers
// (toBeInTheDocument, toHaveAttribute, toHaveClass, ...) on `expect` for
// every test in the jsdom project. Because this file is also part of the
// app's tsconfig program, its module augmentation is what makes those
// matchers type-check in the .tsx specs as well.
import '@testing-library/jest-dom'

// jsdom ships no PointerEvent, and Base UI builds one to dispatch the click
// behind a keyboard or pointer activation (the `Select` and `Dialog` the app
// takes from `@lilnas/ui`). A MouseEvent carries everything it reads.
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
