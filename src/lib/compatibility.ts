export {
  evaluateAssignmentCompatibility,
  evaluateProjectCompatibility,
  normalizeCompatibilityProject,
  normalizeComponentRequirements,
  normalizeHostCapabilities,
  parsePcieDescriptor,
  planHostAllocations,
} from '../../shared/compatibility/index.mjs'

export type {
  AssignmentCompatibilityInput,
  HostAllocationPlan,
  NormalizedComponentRequirements,
  NormalizedCpuRequirements,
  NormalizedExpansionRequirements,
  NormalizedRamRequirements,
  NormalizedStorageRequirements,
  PcieDescriptor,
  ProjectCompatibilityResult,
} from '../../shared/compatibility/index.mjs'
