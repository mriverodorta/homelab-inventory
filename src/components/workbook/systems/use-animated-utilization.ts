import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

export const SYSTEMS_UTILIZATION_TRANSITION_MS = 600

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const reducedMotionSubscribers = new Set<() => void>()
const animationSubscribers = new Set<(timestamp: number) => boolean>()
let reducedMotionMedia: MediaQueryList | null = null
let animationFrame: number | null = null

export function normalizeUtilization(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0
}

function mediaQuery() {
  if (reducedMotionMedia || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return reducedMotionMedia
  }
  reducedMotionMedia = window.matchMedia(REDUCED_MOTION_QUERY)
  return reducedMotionMedia
}

function notifyReducedMotionSubscribers() {
  for (const subscriber of reducedMotionSubscribers) subscriber()
}

function subscribeReducedMotion(subscriber: () => void) {
  const media = mediaQuery()
  reducedMotionSubscribers.add(subscriber)
  if (reducedMotionSubscribers.size === 1) {
    media?.addEventListener?.('change', notifyReducedMotionSubscribers)
  }
  return () => {
    reducedMotionSubscribers.delete(subscriber)
    if (reducedMotionSubscribers.size === 0) {
      media?.removeEventListener?.('change', notifyReducedMotionSubscribers)
      if (reducedMotionMedia === media) reducedMotionMedia = null
    }
  }
}

function reducedMotionSnapshot() {
  return mediaQuery()?.matches ?? false
}

function runAnimations(timestamp: number) {
  animationFrame = null
  for (const subscriber of animationSubscribers) {
    if (!subscriber(timestamp)) animationSubscribers.delete(subscriber)
  }
  if (animationSubscribers.size > 0) animationFrame = window.requestAnimationFrame(runAnimations)
}

function scheduleAnimation(subscriber: (timestamp: number) => boolean) {
  animationSubscribers.add(subscriber)
  if (animationFrame === null) animationFrame = window.requestAnimationFrame(runAnimations)
  return () => {
    animationSubscribers.delete(subscriber)
    if (animationSubscribers.size === 0 && animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
  }
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => false)
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

  useEffect(() => {
    const from = displayedRef.current
    if (reducedMotion || from === target) {
      displayedRef.current = target
      setDisplayed(target)
      return
    }

    const startedAt = performance.now()
    const distance = target - from
    return scheduleAnimation((timestamp) => {
      const progress = Math.min(Math.max((timestamp - startedAt) / SYSTEMS_UTILIZATION_TRANSITION_MS, 0), 1)
      const next = progress === 1 ? target : from + distance * easeOutCubic(progress)
      displayedRef.current = next
      setDisplayed(next)
      return progress < 1
    })
  }, [reducedMotion, target])

  return { displayed, target, reducedMotion }
}
