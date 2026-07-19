import type { AgentEnrollmentResponse, AgentStatusSummary } from '@/types/agent'

async function agentRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
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
  return agentRequest<AgentStatusSummary>('/api/agent/status')
}

export async function createAgentEnrollment(
  serverId: string | number,
  endpoint: string,
): Promise<AgentEnrollmentResponse> {
  return agentRequest<AgentEnrollmentResponse>('/api/agent/enrollments', {
    method: 'POST',
    body: JSON.stringify({
      serverId,
      endpoint,
    }),
  })
}

export async function revokeAgentRegistration(
  serverId: string | number,
): Promise<void> {
  await agentRequest(`/api/agent/servers/${serverId}/registration`, {
    method: 'DELETE',
  })
}

export async function clearAgentStatus(
  serverId: string | number,
): Promise<AgentStatusSummary> {
  return agentRequest<AgentStatusSummary>(`/api/agent/servers/${serverId}/status`, {
    method: 'DELETE',
  })
}
