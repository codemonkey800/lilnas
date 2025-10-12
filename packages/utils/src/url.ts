export function isValidURL(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}
