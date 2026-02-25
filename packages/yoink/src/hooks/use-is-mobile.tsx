import * as React from 'react'

function getBreakpointPx(name: string): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    `--breakpoint-${name}`,
  )
  return parseInt(value, 10)
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const breakpoint = getBreakpointPx('md')
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`)

    const onChange = () => {
      setIsMobile(window.innerWidth < breakpoint)
    }

    mql.addEventListener('change', onChange)
    setIsMobile(window.innerWidth < breakpoint)

    return () => mql.removeEventListener('change', onChange)
  }, [])

  return !!isMobile
}
