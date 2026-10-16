/** '<a:name:id>' for animated emojis, '<:name:id>' otherwise. */
export function emojiKey(e: {
  id: string
  name: string
  animated: boolean
}): string {
  return `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`
}
