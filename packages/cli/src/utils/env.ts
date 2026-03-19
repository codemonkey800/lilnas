import * as dotenv from 'dotenv'
import * as fs from 'fs'

/**
 * Loads a .env file into process.env using dotenv.
 * Uses override: true so later calls take precedence over earlier ones,
 * enabling layered loading (infra env → local .env.dev overrides).
 * No-ops silently if the file does not exist.
 */
export function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  dotenv.config({ path: filePath, override: true })
}
