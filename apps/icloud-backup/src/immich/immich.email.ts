/**
 * `a@b.c` + `tag` becomes `a+tag@b.c`. Without a tag, or for a value with no
 * `@`, the address comes back unchanged.
 */
export function immichEmail(lilnasEmail: string, plusTag?: string): string {
  const tag = plusTag?.trim()
  const at = lilnasEmail.lastIndexOf('@')
  if (!tag || at < 1) return lilnasEmail
  return `${lilnasEmail.slice(0, at)}+${tag}${lilnasEmail.slice(at)}`
}
