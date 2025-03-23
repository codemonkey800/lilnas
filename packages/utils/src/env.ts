export function env<K extends string>(key: K, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue

  if (value == null) {
    const message = `${key} not defined`
    console.error(message)
    throw new Error(message)
  }

  return value
}
