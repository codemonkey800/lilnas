// Shared by pending-client.tsx's "Requested {time}" caption and the merged
// admin dashboard's request-card timing — a plain, dependency-free
// relative-time formatter (no need for a date library at this precision).
export function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}
