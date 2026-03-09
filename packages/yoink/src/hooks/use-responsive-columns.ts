import { useEffect, useState } from 'react'

const BREAKPOINTS: [minWidth: number, columns: number][] = [
  [1280, 6],
  [1024, 5],
  [768, 4],
  [640, 3],
  [0, 2],
]

function columnsForWidth(width: number): number {
  for (const [minWidth, cols] of BREAKPOINTS) {
    if (width >= minWidth) return cols
  }
  return 2
}

export function useResponsiveColumns(): number {
  const [columns, setColumns] = useState(2)

  useEffect(() => {
    const onResize = () => setColumns(columnsForWidth(window.innerWidth))
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return columns
}
