export function isEnumValue<T extends Record<string, string>>(
  value: unknown,
  Enum: T,
): value is T {
  return Object.values(Enum).includes(value as T[keyof T])
}
