const PATH_LABELS: Record<string, string> = {
  aliases: 'Aliases',
  bootDeviceSlots: 'Boot-device slot',
  compatibility: 'Compatibility',
  controllerSlots: 'Controller slot',
  expansionSlots: 'Expansion slot',
  fixedComponents: 'Fixed component',
  optionalModuleSlots: 'Optional-module slot',
  ports: 'Port',
  specs: 'Specification',
  storageSlots: 'Storage slot',
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[-_]+/gu, ' ')
    .trim()
    .toLowerCase()
}

function naturalList(values: unknown[]) {
  const labels = values.map(String)
  if (labels.length <= 1) return labels[0] ?? ''
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`
}

export function registryChangeLabel(path: string) {
  const segments = path.replace(/\[\d+\]/gu, '').split('.').filter(Boolean)
  const leaf = segments.at(-1) ?? 'change'
  const context = [...segments].reverse().find((segment) => PATH_LABELS[segment])
  const leafLabel = humanize(leaf)
  if (!context || context === leaf) {
    return leafLabel.charAt(0).toUpperCase() + leafLabel.slice(1)
  }
  return `${PATH_LABELS[context]} ${leafLabel}`
}

export function registryResolutionOperationLabel(operation: Record<string, unknown>) {
  switch (operation.kind) {
    case 'move-connection-endpoint':
      return `Move cable ${operation.connectionId} to the fixed replacement endpoint.`
    case 'unassign-item':
      return operation.itemType && operation.itemId
        ? `Return ${operation.itemType} ${operation.itemId} to inventory (assignment ${operation.assignmentId}).`
        : `Return the item for assignment ${operation.assignmentId} to inventory.`
    case 'remap-resource-key':
      return `Preserve assignments ${naturalList(Array.isArray(operation.assignmentIds) ? operation.assignmentIds : [])} while ${operation.resourceType} resource ${operation.resourceId} changes from ${operation.fromKey} to ${operation.toKey}.`
    default:
      return String(operation.kind ?? 'Apply relationship update')
  }
}
