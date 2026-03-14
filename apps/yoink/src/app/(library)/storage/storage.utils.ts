export const WARNING_THRESHOLD = 0.9

export function usageRatio(freeSpace: number, totalSpace: number): number {
  if (totalSpace <= 0) return 0
  return (totalSpace - freeSpace) / totalSpace
}
