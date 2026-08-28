import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import type { DemoSessionStatus } from '@/lib/demo-api'
import type { OnboardingStatus } from '@/lib/onboarding-api'
import type { ReleaseNotesStatus } from '@/lib/release-notes-api'
import type { UpdateStatus } from '@/lib/update-api'
import type { AgentStatusSummary } from '@/types/agent'
import type { ProjectState } from '@/types/inventory'
import type { NotificationSnapshot } from '@/types/notifications'
import type { RegistryState } from '@/types/registry'
import type { ProjectWorkbook } from '@/lib/workbook-api'

export type ApplicationBootstrap = {
  project: ProjectState | null
  projects: ProjectWorkbook[]
  activeProjectPreference: { projectId: number; workspaceId: number } | null
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
let scope: { projectId: number; workspaceId: number } | null = null
const consumed = new Set<BootstrapKey>()

async function requestApplicationBootstrap(): Promise<ApplicationBootstrap> {
  const query = scope ? `?${new URLSearchParams({
    projectId: String(scope.projectId),
    workspaceId: String(scope.workspaceId),
  }).toString()}` : ''
  const response = await fetchWithTimeout(`/api/bootstrap${query}`)
  const payload = await response.json().catch(() => null) as { message?: string } | null
  if (!response.ok) {
    throw new Error(payload?.message ?? `Bootstrap request failed with status ${response.status}.`)
  }
  return payload as ApplicationBootstrap
}

export function activateInitialBootstrap(nextScope: typeof scope = null): void {
  active = true
  if (!request) scope = nextScope
}

export function resetInitialBootstrap(): void {
  active = false
  request = null
  scope = null
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
