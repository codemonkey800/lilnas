const MAX_LENGTH = 40

/**
 * Folder name for a person: the part of their email before `@`, lower-cased,
 * anything outside `[a-z0-9._-]` replaced by `-`, edge `.`/`-` trimmed, at most
 * 40 characters, `user` when nothing is left, then `prefix` in front.
 */
export function slugFromEmail(email: string, prefix = ''): string {
  const at = email.indexOf('@')
  const local = at === -1 ? email : email.slice(0, at)
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, MAX_LENGTH)
  return `${prefix}${cleaned || 'user'}`
}
