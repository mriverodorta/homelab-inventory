export type ShareFieldClassification = 'safe-default' | 'explicit-opt-in' | 'forbidden'

const normalizeField = (field: string) => field.replaceAll(/[^a-zA-Z0-9]/g, '').toLowerCase()

const forbiddenFields = new Set([
  'agentcredentials',
  'agentidentity',
  'auditevents',
  'authorization',
  'credentials',
  'heartbeatHistory',
  'ipaddress',
  'macaddress',
  'password',
  'privatekey',
  'privatemetadata',
  'registrycredentials',
  'registryenrollment',
  'secret',
  'serial',
  'serialnumber',
  'telemetryhistory',
  'token',
].map(normalizeField))

const explicitOptInFields = new Set([
  'customfielddefinitions',
  'customfields',
  'tags',
].map(normalizeField))

export function classifyShareField(field: string): ShareFieldClassification {
  const normalized = normalizeField(field)
  if (forbiddenFields.has(normalized)) return 'forbidden'
  if (explicitOptInFields.has(normalized)) return 'explicit-opt-in'
  return 'safe-default'
}

export function findForbiddenShareField(
  value: unknown,
  path = '$',
  active = new WeakSet<object>(),
): string | null {
  if (value === null || typeof value !== 'object') return null
  if (active.has(value)) return `${path} (cyclic value)`

  active.add(value)
  try {
    if (Array.isArray(value)) {
      for (const [index, entry] of value.entries()) {
        const forbidden = findForbiddenShareField(entry, `${path}[${index}]`, active)
        if (forbidden) return forbidden
      }
      return null
    }

    for (const [field, entry] of Object.entries(value)) {
      const fieldPath = `${path}.${field}`
      if (classifyShareField(field) === 'forbidden') return fieldPath
      const forbidden = findForbiddenShareField(entry, fieldPath, active)
      if (forbidden) return forbidden
    }
    return null
  } finally {
    active.delete(value)
  }
}
