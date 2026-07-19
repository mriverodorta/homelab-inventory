import { normalizeCompatibilityPolicy } from '@/lib/compatibility'
import type { ProjectState } from '@/types/inventory'

export function setHostCompatibilityEnabled(
  project: ProjectState,
  hostId: string,
  enabled: boolean,
): ProjectState {
  const policy = normalizeCompatibilityPolicy(project.compatibilityPolicy)
  const disabledHostIds = new Set(policy.disabledHostIds)

  if (enabled) {
    disabledHostIds.delete(hostId)
  } else {
    disabledHostIds.add(hostId)
  }

  return {
    ...project,
    compatibilityPolicy: {
      ...policy,
      disabledHostIds: [...disabledHostIds],
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
