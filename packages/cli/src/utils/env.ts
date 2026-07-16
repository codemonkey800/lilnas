import * as dotenv from 'dotenv'
import * as fs from 'fs'

/**
 * Loads a .env file into process.env using dotenv.
 * Uses override: true so values here take precedence over anything already
 * set in the environment.
 * No-ops silently if the file does not exist.
 */
export function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  dotenv.config({ path: filePath, override: true })
}
