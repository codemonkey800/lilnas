// Shared by home-client.tsx's account card and pending/page.tsx's identity
// prop — both need the same "first letter of each word, max two letters"
// initials shown inside a bare `.avatar` circle.
export function getInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return initials || '?'
}
