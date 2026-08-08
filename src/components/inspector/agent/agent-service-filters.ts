import type { AgentService } from '@/types/agent'

export type ServiceScope = 'user-installed' | 'system' | 'all'
export type ServiceRuntimeState = 'active' | 'inactive' | 'failed' | 'all'

export function serviceRuntimeState(service: AgentService): Exclude<ServiceRuntimeState, 'all'> {
  const state = typeof service.activeState === 'string'
    ? service.activeState.toLowerCase()
    : typeof service.state === 'string'
      ? service.state.toLowerCase()
      : 'active'
  if (state === 'active') return 'active'
  if (state === 'failed') return 'failed'
  return 'inactive'
}

export function filterServices(
  services: AgentService[],
  scope: ServiceScope,
  runtimeState: ServiceRuntimeState,
): AgentService[] {
  return services.filter((service) => {
    const scopeMatches = scope === 'all' || service.classification === scope
    const stateMatches = runtimeState === 'all' || serviceRuntimeState(service) === runtimeState
    return scopeMatches && stateMatches
  })
}
