import { useEffect, useRef, useState } from 'react'

export const SYSTEMS_UTILIZATION_TRANSITION_MS = 600

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function normalizeUtilization(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  return reducedMotion
}

function easeOutCubic(progress: number): number {
  return 1 - (1 - progress) ** 3
}

export function useAnimatedUtilization(value: number): {
  displayed: number
  target: number
  reducedMotion: boolean
} {
  const target = normalizeUtilization(value)
  const reducedMotion = usePrefersReducedMotion()
  const [displayed, setDisplayed] = useState(target)
  const displayedRef = useRef(target)
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }

    const from = displayedRef.current
    if (reducedMotion || from === target) {
      displayedRef.current = target
      setDisplayed(target)
      return
    }

    const startedAt = performance.now()
    const distance = target - from
    const tick = (timestamp: number) => {
      const progress = Math.min(Math.max((timestamp - startedAt) / SYSTEMS_UTILIZATION_TRANSITION_MS, 0), 1)
      const next = progress === 1 ? target : from + distance * easeOutCubic(progress)
      displayedRef.current = next
      setDisplayed(next)
      frameRef.current = progress < 1 ? window.requestAnimationFrame(tick) : null
    }
    frameRef.current = window.requestAnimationFrame(tick)

    return () => {
      if (frameRef.current === null) return
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [reducedMotion, target])

  return { displayed, target, reducedMotion }
}
