export function isBefore(start: string, end: string): boolean {
  const [startHour, startMinute, startSecond] = start
    .split(':')
    .map(Number) as [number, number, number]

  const [endHour, endMinute, endSecond] = end.split(':').map(Number) as [
    number,
    number,
    number,
  ]

  if (startHour < endHour) return true
  if (startHour > endHour) return false
  if (startMinute < endMinute) return true
  if (startMinute > endMinute) return false
  return startSecond < endSecond
}
