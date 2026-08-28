import { useEffect, useState } from 'react'

const desktopMediaQuery = '(min-width: 1024px)'

function currentDesktopLayout() {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? true
    : window.matchMedia(desktopMediaQuery).matches
}

export function useDesktopBreakpoint() {
  const [desktopLayout, setDesktopLayout] = useState(currentDesktopLayout)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(desktopMediaQuery)
    const update = () => setDesktopLayout(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return desktopLayout
}
