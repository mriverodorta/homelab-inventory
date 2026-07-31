import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { DemoSessionDialogState } from '@/components/demo-session-dialog'
import {
  expireDemoSession,
  extendDemoSession,
  loadDemoSession,
  type DemoSessionStatus,
} from '@/lib/demo-api'

const DEMO_EXTENSION_GRACE_SECONDS = 30
const DEMO_SESSION_QUERY_KEY = ['demo-session'] as const

export function useDemoSessionLifecycle() {
  const queryClient = useQueryClient()
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null)
  const [dialogState, setDialogState] = useState<DemoSessionDialogState>('closed')
  const [extensionSeconds, setExtensionSeconds] = useState(DEMO_EXTENSION_GRACE_SECONDS)
  const expirationFinalizedRef = useRef(false)

  const query = useQuery({
    queryKey: DEMO_SESSION_QUERY_KEY,
    queryFn: loadDemoSession,
    refetchInterval: (currentQuery) => (
      currentQuery.state.data?.mode === 'demo' ? 60_000 : false
    ),
  })

  const extendMutation = useMutation({
    mutationFn: extendDemoSession,
    onSuccess: (status) => {
      expirationFinalizedRef.current = false
      queryClient.setQueryData<DemoSessionStatus>(DEMO_SESSION_QUERY_KEY, status)
      setDialogState('closed')
      setExtensionSeconds(DEMO_EXTENSION_GRACE_SECONDS)
    },
  })

  const expireMutation = useMutation({
    mutationFn: expireDemoSession,
    onSettled: () => {
      queryClient.clear()
      setRemainingSeconds(0)
      setExtensionSeconds(0)
      setDialogState('expired')
    },
  })

  useEffect(() => {
    const status = query.data

    if (!status || status.mode !== 'demo') {
      setRemainingSeconds(null)
      return
    }

    const expiresAt = new Date(status.expiresAt).getTime()
    const updateCountdown = () => {
      setRemainingSeconds(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)))
    }

    updateCountdown()
    const timer = window.setInterval(updateCountdown, 1000)
    return () => window.clearInterval(timer)
  }, [query.data])

  useEffect(() => {
    const status = query.data
    if (
      status?.mode !== 'demo'
      || remainingSeconds !== 0
      || dialogState !== 'closed'
      || expirationFinalizedRef.current
      || new Date(status.expiresAt).getTime() > Date.now()
    ) return

    setExtensionSeconds(DEMO_EXTENSION_GRACE_SECONDS)
    setDialogState('extend')
  }, [dialogState, query.data, remainingSeconds])

  const finalizeExpiration = useCallback(() => {
    if (expirationFinalizedRef.current) return

    expirationFinalizedRef.current = true
    expireMutation.mutate()
  }, [expireMutation])

  useEffect(() => {
    if (dialogState !== 'extend' || expirationFinalizedRef.current) return

    if (extensionSeconds <= 0) {
      finalizeExpiration()
      return
    }

    const timer = window.setTimeout(() => {
      setExtensionSeconds((current) => Math.max(0, current - 1))
    }, 1000)
    return () => window.clearTimeout(timer)
  }, [dialogState, extensionSeconds, finalizeExpiration])

  return {
    query,
    remainingSeconds,
    dialogState,
    extensionSeconds,
    extend: () => extendMutation.mutate(),
    finalizeExpiration,
  }
}
