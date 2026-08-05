import { HOST_TYPE_SET } from './inventory-capabilities.mjs'
import { isRelationalId } from './relational-ids.mjs'

function requireObject(value, fieldPath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an object.`)
  }
  return value
}

function typedHost(record, fieldPath, legacyId) {
  const hostType = record.hostType ?? (legacyId === undefined ? undefined : 'server')
  const hostId = record.hostId ?? legacyId
  if (!HOST_TYPE_SET.has(hostType) || !isRelationalId(hostId)) {
    throw new Error(`${fieldPath} must reference a supported host type and positive numeric host id.`)
  }
  return { hostType, hostId }
}

function migrateRecordCollection(recordsInput, fieldPath) {
  const records = requireObject(recordsInput, fieldPath)
  let migratedRecords = 0
  const migrated = Object.fromEntries(Object.entries(records).map(([key, input]) => {
    const record = requireObject(input, `${fieldPath}.${key}`)
    const { hostType, hostId } = typedHost(record, `${fieldPath}.${key}`, record.serverId)
    const next = { ...record, hostType, hostId }
    if ('serverId' in next) {
      delete next.serverId
      migratedRecords += 1
    }
    return [key, next]
  }))
  return { records: migrated, migratedRecords }
}

export function migrateSchema24To25(agentsInput, agentStatusInput) {
  const agentsSource = requireObject(agentsInput, 'agents')
  const statusSource = requireObject(agentStatusInput, 'agentStatus')
  const statusRest = Object.fromEntries(
    Object.entries(statusSource).filter(([key]) => key !== 'servers' && key !== 'hosts'),
  )
  const enrollments = migrateRecordCollection(agentsSource.enrollments ?? {}, 'agents.enrollments')
  const devices = migrateRecordCollection(agentsSource.devices ?? {}, 'agents.devices')
  const hosts = {}
  let migratedStatuses = 0

  for (const [legacyKey, input] of Object.entries(statusSource.hosts ?? statusSource.servers ?? {})) {
    const status = requireObject(input, `agentStatus.${legacyKey}`)
    const legacyId = status.serverId ?? (/^[1-9]\d*$/.test(legacyKey) ? Number(legacyKey) : undefined)
    const { hostType, hostId } = typedHost(status, `agentStatus.${legacyKey}`, legacyId)
    const key = `${hostType}:${hostId}`
    if (hosts[key]) throw new Error(`agentStatus contains duplicate host ${key}.`)
    const next = { ...status, hostType, hostId }
    if ('serverId' in next) {
      delete next.serverId
      migratedStatuses += 1
    }
    hosts[key] = next
  }

  return {
    agents: {
      ...agentsSource,
      enrollments: enrollments.records,
      devices: devices.records,
    },
    agentStatus: {
      ...statusRest,
      hosts,
    },
    summary: {
      migratedEnrollments: enrollments.migratedRecords,
      migratedDevices: devices.migratedRecords,
      migratedStatuses,
    },
  }
}
