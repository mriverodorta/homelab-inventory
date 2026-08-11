import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import type { DemoSessionStatus } from '@/lib/demo-api'
import type { OnboardingStatus } from '@/lib/onboarding-api'
import type { ReleaseNotesStatus } from '@/lib/release-notes-api'
import type { UpdateStatus } from '@/lib/update-api'
import type { AgentStatusSummary } from '@/types/agent'
import type { ProjectState } from '@/types/inventory'
import type { NotificationSnapshot } from '@/types/notifications'
import type { RegistryState } from '@/types/registry'

export type ApplicationBootstrap = {
  project: ProjectState
  agentStatus: AgentStatusSummary | null
  registry: RegistryState | null
  notifications: NotificationSnapshot | null
  onboarding: OnboardingStatus
  releaseNotes: ReleaseNotesStatus
  updateStatus: UpdateStatus | null
  demoSession: DemoSessionStatus
}

type BootstrapKey = keyof ApplicationBootstrap

let active = false
let request: Promise<ApplicationBootstrap> | null = null
const consumed = new Set<BootstrapKey>()

async function requestApplicationBootstrap(): Promise<ApplicationBootstrap> {
  const response = await fetchWithTimeout('/api/bootstrap')
  const payload = await response.json().catch(() => null) as { message?: string } | null
  if (!response.ok) {
    throw new Error(payload?.message ?? `Bootstrap request failed with status ${response.status}.`)
  }
  return payload as ApplicationBootstrap
}

export function activateInitialBootstrap(): void {
  active = true
}

export function resetInitialBootstrap(): void {
  active = false
  request = null
  consumed.clear()
}

export async function consumeInitialBootstrap<K extends BootstrapKey>(
  key: K,
  fallback: () => Promise<NonNullable<ApplicationBootstrap[K]>>,
): Promise<NonNullable<ApplicationBootstrap[K]>> {
  if (!active || consumed.has(key)) return fallback()

  consumed.add(key)
  request ??= requestApplicationBootstrap()

  try {
    const value = (await request)[key]
    return value === null || value === undefined
      ? fallback()
      : value as NonNullable<ApplicationBootstrap[K]>
  } catch {
    return fallback()
  }
}
