import type { HostType } from '@/types/inventory'

export type CompatibilityAuditClassification = 'actionable' | 'informational'
export type CompatibilityAuditSeverity = 'error' | 'warning' | 'info'

export type CompatibilityAuditHost = Readonly<{
  itemId: number
  type: HostType
  legacyId: number
  name: string
}>

export type CompatibilityAuditComponent = Readonly<{
  itemId: number
  type: string
  legacyId: number
  name: string
}>

export type CompatibilityAuditFinding = Readonly<{
  id: number
  findingKey: string
  ruleKey: string
  classification: CompatibilityAuditClassification
  severity: CompatibilityAuditSeverity
  message: string
  details: Readonly<{
    auditId?: number
    field?: string | null
    resourceId?: number | null
  }>
  host: CompatibilityAuditHost
  component: CompatibilityAuditComponent | null
  assignmentId: number | null
  resourceSlotId: number | null
  ignored: boolean
  firstSeenAt: string
  lastSeenAt: string
}>

export type CompatibilityAuditHostSummary = Readonly<{
  hostItemId: number
  hostType: HostType
  hostId: number
  actionable: number
  informational: number
}>

export type CompatibilityAuditSummaryResponse = Readonly<{
  projectId: number
  engineVersion: string
  hosts: readonly CompatibilityAuditHostSummary[]
}>

export type CompatibilityAuditFindingsResponse = Readonly<{
  projectId: number
  engineVersion: string
  findings: readonly CompatibilityAuditFinding[]
}>
