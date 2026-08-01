import fs from 'node:fs/promises'
import path from 'node:path'

const INVENTORY_TABLES = [
  'servers',
  'pcBuilds',
  'cpus',
  'ram',
  'storage',
  'networkCards',
  'gpus',
  'motherboards',
  'cpuCoolers',
  'cases',
  'powerSupplies',
  'soundCards',
  'wirelessCards',
  'powerAdapters',
  'nas',
  'switches',
  'patchPanels',
  'monitors',
  'upsSystems',
  'powerStrips',
]

const PRIVATE_BLANK_KEYS = new Set([
  'customlabel',
  'customname',
  'devicename',
  'devicedisplayname',
  'displayname',
  'friendlyname',
  'hostname',
  'ip',
  'ipaddress',
  'ipv4',
  'ipv6',
  'lanip',
  'location',
  'mac',
  'macaddress',
  'managementip',
  'notes',
  'rack',
  'room',
  'ssid',
  'bssid',
  'tailscaleip',
])

const PRIVATE_EMPTY_ARRAY_KEYS = new Set(['addresses'])

const PRIVATE_REMOVE_KEY_PATTERNS = [
  /serial/i,
  /token/i,
  /secret/i,
  /password/i,
  /credential/i,
  /auth/i,
]

function looksSecretLike(value) {
  return typeof value === 'string'
    && /(token|secret|password|credential|bearer|api[_-]?key)\s*[:=]/i.test(value)
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`)
}

function demoNameForType(type, index) {
  if (type === 'server') return `Demo Server ${index}`
  if (type === 'pcBuild') return `Demo PC ${index}`
  if (type === 'nas') return `Demo NAS ${index}`
  if (type === 'switch') return `Demo Switch ${index}`
  if (type === 'patchPanel') return `Demo Patch Panel ${index}`
  if (type === 'monitor') return `Demo Monitor ${index}`
  if (type === 'ups') return `Demo UPS ${index}`
  if (type === 'powerStrip') return `Demo Power Strip ${index}`

  return null
}

function inventoryTypeForTable(table) {
  if (table === 'networkCards') return 'network'
  if (table === 'patchPanels') return 'patchPanel'
  if (table === 'pcBuilds') return 'pcBuild'
  if (table === 'upsSystems') return 'ups'
  if (table === 'powerStrips') return 'powerStrip'

  return table.replace(/s$/, '')
}

function isCompatibilityLabel(key, pathParts) {
  return key.toLowerCase() === 'label' && pathParts.includes('compatibility')
}

function isPrivateInstanceName(key, pathParts) {
  return key.toLowerCase() === 'name'
    && (pathParts.includes('smart') || pathParts.includes('outlets'))
}

function sanitizeValue(key, value, pathParts) {
  const normalizedKey = key.toLowerCase()

  if (
    PRIVATE_BLANK_KEYS.has(normalizedKey)
    || (normalizedKey === 'label' && !isCompatibilityLabel(key, pathParts))
    || isPrivateInstanceName(key, pathParts)
  ) {
    return ''
  }

  if (PRIVATE_EMPTY_ARRAY_KEYS.has(normalizedKey)) return []

  if (PRIVATE_REMOVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
    return undefined
  }

  if (looksSecretLike(value)) {
    return ''
  }

  if (Array.isArray(value)) {
    return value
      .map((item, index) => sanitizeObject(item, [...pathParts, key, String(index)]))
      .filter((item) => item !== undefined)
  }

  if (value && typeof value === 'object') {
    return sanitizeObject(value, [...pathParts, key])
  }

  return value
}

function sanitizeObject(input, pathParts = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}

  for (const [key, value] of Object.entries(input)) {
    const sanitized = sanitizeValue(key, value, pathParts)

    if (sanitized !== undefined) {
      output[key] = sanitized
    }
  }

  return output
}

function sanitizeSmartConfiguration(smart) {
  if (!smart || typeof smart !== 'object' || Array.isArray(smart)) return smart

  const sanitized = { ...smart }
  delete sanitized.displayName
  delete sanitized.managementIp
  delete sanitized.macAddress

  if (Array.isArray(sanitized.outlets)) {
    sanitized.outlets = sanitized.outlets.map((outlet, index) => {
      if (!outlet || typeof outlet !== 'object' || Array.isArray(outlet)) return outlet

      const normalized = { ...outlet }
      delete normalized.customName
      normalized.name = `Demo outlet ${normalized.slotNumber ?? index + 1}`

      return normalized
    })
  }

  return sanitized
}

function sanitizeInventory(inventory) {
  const counters = {}
  const output = {}

  for (const table of INVENTORY_TABLES) {
    output[table] = (Array.isArray(inventory?.[table]) ? inventory[table] : []).map((item) => {
      const sanitized = sanitizeObject(item)
      const type = sanitized.type ?? inventoryTypeForTable(table)

      counters[type] = (counters[type] ?? 0) + 1

      const demoName = demoNameForType(type, counters[type])

      if (demoName) {
        sanitized.name = demoName
        sanitized.properties = {
          ...(sanitized.properties ?? {}),
          name: demoName,
        }
      }

      if (type === 'powerStrip') {
        if (sanitized.smart !== undefined) {
          sanitized.smart = sanitizeSmartConfiguration(sanitized.smart)
        }
        if (sanitized.properties?.smart !== undefined) {
          sanitized.properties.smart = sanitizeSmartConfiguration(sanitized.properties.smart)
        }
      }

      return sanitized
    })
  }

  return output
}

function sanitizeProject(project) {
  const sanitized = sanitizeObject(project)

  return {
    ...sanitized,
    id: 'default',
    metadata: {
      ...(sanitized.metadata ?? {}),
      name: 'Homelab Inventory Demo',
      updatedAt: new Date().toISOString(),
    },
  }
}

export async function sanitizeDemoStores({ sourceDir, targetDir, appVersion }) {
  const meta = await readJson(path.join(sourceDir, 'meta.json'))
  const inventory = await readJson(path.join(sourceDir, 'stores', 'inventory.json'))
  const project = await readJson(path.join(sourceDir, 'stores', 'project.json'))
  const now = new Date().toISOString()

  await fs.rm(targetDir, { recursive: true, force: true })
  await fs.mkdir(path.join(targetDir, 'stores'), { recursive: true })

  const sanitizedMeta = sanitizeObject(meta)
  delete sanitizedMeta.skippedUpdateVersion
  delete sanitizedMeta.lastUpdateCheck

  await writeJson(path.join(targetDir, 'meta.json'), {
    ...sanitizedMeta,
    skippedUpdateVersion: null,
    lastUpdateCheck: null,
    appLastOpenedWith: appVersion,
    lastSeenReleaseNotesVersion: appVersion,
    updatedAt: now,
  })
  await writeJson(path.join(targetDir, 'stores', 'inventory.json'), sanitizeInventory(inventory))
  await writeJson(path.join(targetDir, 'stores', 'project.json'), sanitizeProject(project))
  await writeJson(path.join(targetDir, 'stores', 'agents.json'), { enrollments: {}, devices: {} })
  await writeJson(path.join(targetDir, 'stores', 'agent-status.json'), { servers: {} })
}
