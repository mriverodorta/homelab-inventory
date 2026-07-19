export {
  evaluateAssignmentCompatibility,
  evaluateProjectCompatibility,
  normalizeComponentRequirements,
  normalizeHostCapabilities,
  parsePcieDescriptor,
} from '../../shared/compatibility/index.mjs'

export type {
  AssignmentCompatibilityInput,
  NormalizedComponentRequirements,
  NormalizedCpuRequirements,
  NormalizedExpansionRequirements,
  NormalizedRamRequirements,
  NormalizedStorageRequirements,
  PcieDescriptor,
  ProjectCompatibilityResult,
} from '../../shared/compatibility/index.mjs'
