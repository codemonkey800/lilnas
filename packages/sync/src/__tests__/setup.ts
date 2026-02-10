import '@testing-library/jest-dom/vitest'

// jsdom does not implement HTMLDialogElement.showModal / .close
// Provide minimal stubs so Dialog tests can assert they're called.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '')
  }

  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
}
