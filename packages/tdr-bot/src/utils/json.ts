export function isJson(value: string): boolean {
  try {
    JSON.parse(value)
  } catch {
    return false
  }

  return true
}

export function formatJsonString(value: string): string {
  return JSON.stringify(JSON.parse(value), null, 2)
}
