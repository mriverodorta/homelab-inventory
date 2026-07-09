import { apiRequest } from '@/lib/db'

export type DemoSessionStatus =
  | {
      mode: 'production'
    }
  | {
      mode: 'demo'
      expiresAt: string
      remainingSeconds: number
    }

export async function loadDemoSession(): Promise<DemoSessionStatus> {
  return apiRequest<DemoSessionStatus>('/api/demo/session')
}

export async function extendDemoSession(): Promise<DemoSessionStatus> {
  return apiRequest<DemoSessionStatus>('/api/demo/session/extend', {
    method: 'POST',
  })
}

export async function expireDemoSession(): Promise<{ ok: true }> {
  return apiRequest<{ ok: true }>('/api/demo/session/expire', {
    method: 'POST',
  })
}

export function formatRemainingSeconds(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(clamped / 60)
  const remainingSeconds = clamped % 60

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}
