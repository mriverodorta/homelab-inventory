const HARDWARE_CLASSES = new Set(['desktop', 'server'])
const USAGE_ROLES = new Set(['server', 'desktop', 'workstation'])

export function migrateSchema17To18(inventory) {
  const migrated = structuredClone(inventory)
  const servers = Array.isArray(migrated.servers) ? migrated.servers : []
  let defaultedHardwareClass = 0
  let defaultedUsageRole = 0

  migrated.servers = servers.map((server) => {
    const hardwareClass = HARDWARE_CLASSES.has(server.hardwareClass) ? server.hardwareClass : 'desktop'
    const usageRole = USAGE_ROLES.has(server.usageRole) ? server.usageRole : 'server'
    if (hardwareClass !== server.hardwareClass) defaultedHardwareClass += 1
    if (usageRole !== server.usageRole) defaultedUsageRole += 1
    return { ...server, hardwareClass, usageRole }
  })

  return {
    inventory: migrated,
    summary: {
      servers: servers.length,
      defaultedHardwareClass,
      defaultedUsageRole,
    },
  }
}
