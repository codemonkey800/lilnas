export function toggleInSet<T>(
  set: Set<T>,
  value: T,
  present: boolean,
): Set<T> {
  const next = new Set(set)
  if (present) {
    next.add(value)
  } else {
    next.delete(value)
  }
  return next
}
