import crypto from 'crypto'

export function createMd5Hash(content: string) {
  return crypto.createHash('md5').update(content).digest('hex')
}
