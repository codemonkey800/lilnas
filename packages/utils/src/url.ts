/* eslint-disable unused-imports/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unused-vars */

export function isValidURL(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch (_) {
    return false
  }
}
