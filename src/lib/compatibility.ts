export {
  evaluateAssignmentCompatibility,
  evaluateProjectCompatibility,
  isHostCompatibilityEnabled,
  normalizeCompatibilityPolicy,
  normalizeCompatibilityProject,
  normalizeComponentRequirements,
  normalizeHostCapabilities,
  normalizeProjectCompatibilityPolicy,
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
