import { normalizeCompatibilityPolicy } from '@/lib/compatibility'
import type { ProjectState } from '@/types/inventory'

function withoutPolicy(project: ProjectState) {
  const { compatibilityPolicy: _policy, revision: _revision, ...rest } = project
  return rest
}

export function compatibilityPolicyOnlyChanged(left: ProjectState, right: ProjectState) {
  return JSON.stringify(left.compatibilityPolicy) !== JSON.stringify(right.compatibilityPolicy)
    && JSON.stringify(withoutPolicy(left)) === JSON.stringify(withoutPolicy(right))
}

export function setHostCompatibilityEnabled(
  project: ProjectState,
  hostId: string,
  enabled: boolean,
): ProjectState {
  const policy = normalizeCompatibilityPolicy(project.compatibilityPolicy)
  const match = hostId.match(/^([^:]+):([1-9]\d*)$/)
  if (!match) return project
  if (!['server', 'nas', 'pcBuild'].includes(match[1])) return project
  const hostType = match[1] as 'server' | 'nas' | 'pcBuild'
  const numericHostId = Number(match[2])
  const disabledHosts = policy.disabledHosts.filter(
    (entry) => !(entry.hostType === hostType && entry.hostId === numericHostId),
  )

  if (!enabled) {
    disabledHosts.push({ hostType, hostId: numericHostId })
  }

  return {
    ...project,
    compatibilityPolicy: {
      ...policy,
      disabledHosts,
    },
  }
}

export function setAuditWarningIgnored(
  project: ProjectState,
  warningId: string,
  ignored: boolean,
): ProjectState {
  const policy = normalizeCompatibilityPolicy(project.compatibilityPolicy)
  const ignoredWarningIds = new Set(policy.ignoredWarningIds)

  if (ignored) {
    ignoredWarningIds.add(warningId)
  } else {
    ignoredWarningIds.delete(warningId)
  }

  return {
    ...project,
    compatibilityPolicy: {
      ...policy,
      ignoredWarningIds: [...ignoredWarningIds],
    },
  }
}

export function setVerifiedMemoryLimitEnabled(
  project: ProjectState,
  hostId: string,
  enabled: boolean,
): ProjectState {
  const policy = normalizeCompatibilityPolicy(project.compatibilityPolicy)
  const match = hostId.match(/^([^:]+):([1-9]\d*)$/)
  if (!match) return project
  const hostType = match[1] as 'server' | 'nas' | 'pcBuild'
  const hostIdNumber = Number(match[2])
  const verifiedMemoryHosts = (policy.verifiedMemoryHosts ?? []).filter(
    (entry) => !(entry.hostType === hostType && entry.hostId === hostIdNumber),
  )

  if (enabled) verifiedMemoryHosts.push({ hostType, hostId: hostIdNumber })

  return {
    ...project,
    compatibilityPolicy: { ...policy, verifiedMemoryHosts },
  }
}

export function clearIgnoredAuditWarnings(project: ProjectState): ProjectState {
  const policy = normalizeCompatibilityPolicy(project.compatibilityPolicy)

  return {
    ...project,
    compatibilityPolicy: {
      ...policy,
      ignoredWarningIds: [],
    },
  }
}

export function enableCompatibilityForAllHosts(
  project: ProjectState,
): ProjectState {
  const policy = normalizeCompatibilityPolicy(project.compatibilityPolicy)

  return {
    ...project,
    compatibilityPolicy: {
      ...policy,
      disabledHosts: [],
    },
  }
}
