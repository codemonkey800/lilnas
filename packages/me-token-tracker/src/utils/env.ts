export type EnvKey =
  | 'API_TOKEN'
  | 'APPLICATION_ID'
  | 'CLIENT_ID'
  | 'CLIENT_SECRET'
  | 'DEV_GUILD_ID'
  | 'PUBLIC_KEY'

export function env(key: EnvKey, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue

  if (value == null) {
    const message = `${key} not defined`
    console.error(message)
    throw new Error(message)
  }

  return value
}
