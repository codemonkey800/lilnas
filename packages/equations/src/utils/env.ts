export type EnvKey =
  | 'API_TOKEN'
  | 'MINIO_ACCESS_KEY'
  | 'MINIO_HOST'
  | 'MINIO_PORT'
  | 'MINIO_PUBLIC_URL'
  | 'MINIO_SECRET_KEY'

export function env(key: EnvKey, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue

  if (value == null) {
    const message = `${key} not defined`
    console.error(message)
    throw new Error(message)
  }

  return value
}
