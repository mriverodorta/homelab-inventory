import fs from 'node:fs/promises'
import path from 'node:path'

const INVENTORY_TABLES = [
  'servers',
  'cpus',
  'ram',
  'storage',
  'networkCards',
  'gpus',
  'nas',
  'switches',
  'patchPanels',
]

const PRIVATE_BLANK_KEY_PATTERNS = [
  /lanIp/i,
  /tailscaleIp/i,
]

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
  if (type === 'nas') return `Demo NAS ${index}`
  if (type === 'switch') return `Demo Switch ${index}`
  if (type === 'patchPanel') return `Demo Patch Panel ${index}`

  return null
}

function inventoryTypeForTable(table) {
  if (table === 'networkCards') return 'network'
  if (table === 'patchPanels') return 'patchPanel'

  return table.replace(/s$/, '')
}

function sanitizeValue(key, value) {
  if (PRIVATE_BLANK_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
    return ''
  }

  if (PRIVATE_REMOVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
    return undefined
  }

  if (looksSecretLike(value)) {
    return ''
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObject(item)).filter((item) => item !== undefined)
  }

  if (value && typeof value === 'object') {
    return sanitizeObject(value)
  }

  return value
}

function sanitizeObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}

  for (const [key, value] of Object.entries(input)) {
    const sanitized = sanitizeValue(key, value)

    if (sanitized !== undefined) {
      output[key] = sanitized
    }
  }

  return output
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

      return sanitized
    })
  }

  return output
}

function sanitizeProject(project) {
  return {
    ...sanitizeObject(project),
    id: 'default',
    metadata: {
      ...(project.metadata ?? {}),
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

  await writeJson(path.join(targetDir, 'meta.json'), {
    ...sanitizeObject(meta),
    appLastOpenedWith: appVersion,
    lastSeenReleaseNotesVersion: appVersion,
    updatedAt: now,
  })
  await writeJson(path.join(targetDir, 'stores', 'inventory.json'), sanitizeInventory(inventory))
  await writeJson(path.join(targetDir, 'stores', 'project.json'), sanitizeProject(project))
  await writeJson(path.join(targetDir, 'stores', 'agents.json'), { enrollments: {}, devices: {} })
  await writeJson(path.join(targetDir, 'stores', 'agent-status.json'), { servers: {} })
}
