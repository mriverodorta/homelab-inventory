import type {
  AgentEnrollmentResponse,
  AgentHardwareSnapshotResponse,
  AgentHostType,
  AgentStatusSummary,
  AgentTelemetryRange,
} from '@/types/agent'
import { fetchWithTimeout } from '@/lib/fetch-with-timeout'
import { consumeInitialBootstrap } from '@/lib/bootstrap-api'

export const AGENT_STATUS_REFRESH_INTERVAL_MS = 60_000

async function agentRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(payload?.message ?? `Request failed with status ${response.status}.`)
  }

  return (await response.json()) as T
}

export async function loadAgentStatus(): Promise<AgentStatusSummary> {
  return consumeInitialBootstrap('agentStatus', () => agentRequest<AgentStatusSummary>('/api/agent/status'))
}

export async function createAgentEnrollment(
  hostType: AgentHostType,
  hostId: number,
  endpoint: string,
  containers: { mode: 'disabled' | 'proxy' | 'socket'; runtime: 'docker' | 'podman'; endpoint: string },
): Promise<AgentEnrollmentResponse> {
  return agentRequest<AgentEnrollmentResponse>(`/api/agent/hosts/${hostType}/${hostId}/enrollments`, {
    method: 'POST',
    body: JSON.stringify({
      endpoint,
      containers,
    }),
  })
}

export async function revokeAgentRegistration(
  hostType: AgentHostType,
  hostId: number,
  deleteTelemetry = false,
): Promise<{ ok: true; deleteTelemetry: boolean }> {
  return agentRequest(`/api/agent/hosts/${hostType}/${hostId}/registration`, {
    method: 'DELETE',
    body: JSON.stringify({ deleteTelemetry }),
  })
}

export async function clearAgentStatus(
  hostType: AgentHostType,
  hostId: number,
): Promise<AgentStatusSummary> {
  await agentRequest(`/api/agent/hosts/${hostType}/${hostId}/status`, {
    method: 'DELETE',
  })
  return loadAgentStatus()
}

export async function loadAgentTelemetry(
  hostType: AgentHostType,
  hostId: number,
  { from, to, limit = 30 }: { from?: number; to?: number; limit?: number } = {},
): Promise<AgentTelemetryRange> {
  const query = new URLSearchParams({ limit: String(limit) })
  if (from !== undefined) query.set('from', String(from))
  if (to !== undefined) query.set('to', String(to))
  return agentRequest<AgentTelemetryRange>(`/api/agent/hosts/${hostType}/${hostId}/telemetry?${query}`)
}

export async function loadAgentHardwareSnapshot(
  hostType: AgentHostType,
  hostId: number,
): Promise<AgentHardwareSnapshotResponse> {
  return agentRequest<AgentHardwareSnapshotResponse>(`/api/agent/hosts/${hostType}/${hostId}/hardware-snapshot`)
}
