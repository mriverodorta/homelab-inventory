import { apiRequest } from '@/lib/db'

export type BackupSectionName =
  | 'inventory'
  | 'project'
  | 'routingCache'
  | 'registryConfiguration'
  | 'registryEnrollment'
  | 'authentication'
  | 'catalogState'
  | 'agents'
  | 'agentTelemetry'
  | 'applicationMetadata'

export type BackupSectionDefinition = {
  label: string
  description: string
  sensitive: boolean
}

export type BackupRecord = {
  id: number
  label: string
  fileName: string
  kind: 'manual' | 'scheduled' | 'pre-restore'
  status: 'verified' | 'failed'
  sections: BackupSectionName[]
  encrypted: boolean
  sizeBytes: number
  appVersion: string
  schemaVersion: number
  createdAt: string
  verifiedAt: string | null
  error: string | null
}

export type RestoreRecord = {
  id: number
  status: 'success' | 'failed' | 'rolled-back'
  sections: BackupSectionName[]
  startedAt: string
  completedAt: string | null
  preRestoreBackupId: number | null
  error: string | null
}

export type BackupSchedule = {
  enabled: boolean
  frequency: 'daily' | 'weekly'
  time: string
  weekday: number
  timezone: string | null
  retention: number
  nextRunAt: string | null
  lastRunAt: string | null
  lastResult: 'success' | 'failed' | null
  updatedAt: string | null
}

export type BackupStatus = {
  mode: 'production' | 'demo'
  policy?: 'export-only'
  sections?: Record<BackupSectionName, BackupSectionDefinition>
  schedule?: BackupSchedule
  backups: BackupRecord[]
  restores: RestoreRecord[]
  operation: { kind: string; startedAt: string } | null
  maintenance: boolean
  storageBytes?: number
  environment?: {
    timezone: string | null
    timezoneLocked: boolean
    encryptionConfigured: boolean
  }
}

export type BackupInspection = {
  token: string
  expiresAt: string
  encrypted: boolean
  manifest: {
    appVersion: string
    schemaVersion: number
    createdAt: string
    sections: BackupSectionName[]
  }
  blockers: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
}

export type RestorePreflight = {
  ok: boolean
  sections: BackupSectionName[]
  blockers: Array<{ code: string; message: string }>
  warnings: Array<{ code: string; message: string }>
  changes: Array<{ section: BackupSectionName; action: string }>
}

async function binaryRequest(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null
    throw new Error(payload?.message ?? `Request failed with status ${response.status}.`)
  }
  return response
}

export function loadBackupStatus(): Promise<BackupStatus> {
  return apiRequest('/api/backups')
}

export function createBackup(input: {
  label: string
  sections: BackupSectionName[]
  encryptStoredCopy?: boolean
  passphrase?: string
}): Promise<{ record: BackupRecord }> {
  return apiRequest('/api/backups', { method: 'POST', body: JSON.stringify(input) })
}

export function updateBackupSchedule(input: Partial<BackupSchedule>): Promise<BackupStatus> {
  return apiRequest('/api/backups/schedule', { method: 'PATCH', body: JSON.stringify(input) })
}

export function verifyBackup(id: number, passphrase?: string): Promise<{ ok: boolean }> {
  return apiRequest(`/api/backups/${id}/verify`, { method: 'POST', body: JSON.stringify({ passphrase }) })
}

export function deleteBackup(id: number): Promise<BackupStatus> {
  return apiRequest(`/api/backups/${id}`, { method: 'DELETE' })
}

export async function downloadBackup(id: number, passphrase?: string): Promise<void> {
  const response = await binaryRequest(`/api/backups/${id}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  })
  await downloadResponse(response)
}

export async function downloadDemoBackup(): Promise<void> {
  await downloadResponse(await binaryRequest('/api/backups/demo-export', { method: 'POST' }))
}

async function downloadResponse(response: Response) {
  const disposition = response.headers.get('content-disposition') ?? ''
  const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'homelab-inventory.hlibackup'
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function inspectBackup(file: File, passphrase?: string): Promise<BackupInspection> {
  const response = await binaryRequest('/api/backups/inspect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-homelab-inventory-backup',
      ...(passphrase ? { 'X-Backup-Passphrase': passphrase } : {}),
    },
    body: file,
  })
  return response.json()
}

export function preflightRestore(token: string, sections: BackupSectionName[]): Promise<RestorePreflight> {
  return apiRequest('/api/backups/restore/preflight', {
    method: 'POST',
    body: JSON.stringify({ token, sections }),
  })
}

export function restoreBackup(token: string, sections: BackupSectionName[]): Promise<{ ok: boolean; reloadRequired: boolean }> {
  return apiRequest('/api/backups/restore', {
    method: 'POST',
    body: JSON.stringify({ token, sections, confirmed: true }),
  })
}
