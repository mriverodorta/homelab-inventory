import { normalizeCompatibilityPolicy } from '@/lib/compatibility'
import type { ProjectState } from '@/types/inventory'

export function setHostCompatibilityEnabled(
  project: ProjectState,
  hostId: string,
  enabled: boolean,
): ProjectState {
  const policy = normalizeCompatibilityPolicy(project.compatibilityPolicy)
  const match = hostId.match(/^([^:]+):([1-9]\d*)$/)
  if (!match) return project
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
