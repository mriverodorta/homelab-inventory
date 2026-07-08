import type { InventoryItem, InventoryPort, InventoryPortRole, InventoryPortType } from '@/types/inventory'

export const PORT_ROLE_LABELS: Record<InventoryPortRole, string> = {
  access: 'Access',
  trunk: 'Trunk',
  uplink: 'Uplink',
  management: 'Management',
  disabled: 'Disabled',
}

export function formatPortRole(role: InventoryPortRole | undefined): string {
  return role ? PORT_ROLE_LABELS[role] : 'No role'
}

export type RamCanvasPart = {
  label: 'capacity' | 'generation' | 'module' | 'speed'
  value: string
}

export type CpuCanvasPart = {
  label: 'manufacturer' | 'family' | 'number' | 'coresThreads'
  value: string
}

export type StorageCanvasPart = {
  label: 'capacity' | 'interface' | 'formFactor'
  value: string
}

export type GpuCanvasPart = {
  label: 'manufacturer' | 'model' | 'formFactor'
  value: string
}

export type EquipmentCanvasPart = {
  label: 'ports' | 'uplinks' | 'management' | 'rackUnits' | 'keystone'
  value: string
}

export type ServerCanvasPortPart = {
  label: 'network' | 'display'
  value: string
}

export function formatCapacity(specs: InventoryItem['specs'] | undefined): string {
  if (!specs) {
    return 'Unknown capacity'
  }

  if (typeof specs.capacityTb === 'number') {
    return `${specs.capacityTb}TB`
  }

  if (typeof specs.capacityGb === 'number') {
    return `${specs.capacityGb}GB`
  }

  return 'Unknown capacity'
}

export function formatStorageSpec(item: InventoryItem): string {
  const capacity = formatCapacity(item.specs)
  const storageInterface = item.specs?.interface

  return `${capacity} / ${typeof storageInterface === 'string' ? storageInterface : 'storage'}`
}

export function formatStorageCanvasParts(item: InventoryItem): StorageCanvasPart[] {
  const capacity = formatCapacity(item.specs)
  const storageInterface = item.specs?.interface
  const formFactor = item.specs?.formFactor
  const parts = [
    capacity !== 'Unknown capacity' ? { label: 'capacity', value: capacity } : null,
    typeof storageInterface === 'string'
      ? { label: 'interface', value: storageInterface }
      : null,
    typeof formFactor === 'string' ? { label: 'formFactor', value: formFactor } : null,
  ].filter((part): part is StorageCanvasPart => part !== null)

  return parts
}

export function formatStorageCanvasLabel(item: InventoryItem): string {
  const parts = formatStorageCanvasParts(item).map((part) => part.value)

  return parts.length > 0 ? parts.join(' ') : item.name
}

export function formatRamModuleCapacity(capacityGb: number): string {
  if (capacityGb === 64) {
    return '2x32GB'
  }

  if (capacityGb === 32) {
    return '2x16GB'
  }

  if (capacityGb === 16) {
    return '2x8GB'
  }

  return `${capacityGb}GB`
}

export function formatRamSpec(item: InventoryItem): string {
  const capacityGb = item.specs?.capacityGb
  const speed = formatRamSpeedPair(item)
  const module = typeof capacityGb === 'number' ? formatRamModuleCapacity(capacityGb) : '?'

  return [module, speed].filter(Boolean).join(' / ')
}

export function formatRamSpeedPair(item: InventoryItem): string {
  const speedMt = item.specs?.speedMt
  const secondarySpeedMt = item.specs?.secondarySpeedMt

  if (typeof speedMt !== 'number') {
    return ''
  }

  if (typeof secondarySpeedMt === 'number' && secondarySpeedMt !== speedMt) {
    return `${speedMt}/${secondarySpeedMt}MHz`
  }

  return `${speedMt}MHz`
}

export function formatRamCanvasLabel(item: InventoryItem): string {
  const parts = formatRamCanvasParts(item).map((part) => part.value)

  return parts.length > 0 ? parts.join(' ') : item.name
}

export function formatRamCanvasParts(item: InventoryItem): RamCanvasPart[] {
  const capacityGb = item.specs?.capacityGb
  const generation = item.specs?.generation
  const speed = formatRamSpeedPair(item)
  const parts = [
    typeof capacityGb === 'number' ? { label: 'capacity', value: `${capacityGb}GB` } : null,
    typeof generation === 'string' ? { label: 'generation', value: generation } : null,
    typeof capacityGb === 'number'
      ? { label: 'module', value: formatRamModuleCapacity(capacityGb) }
      : null,
    speed ? { label: 'speed', value: speed } : null,
  ].filter((part): part is RamCanvasPart => part !== null)

  return parts
}

export function formatCpuCanvasParts(item: InventoryItem): CpuCanvasPart[] {
  const cores = item.specs?.cores
  const threads = item.specs?.threads
  const parts = [
    typeof item.manufacturer === 'string'
      ? { label: 'manufacturer', value: item.manufacturer }
      : null,
    typeof item.family === 'string' ? { label: 'family', value: item.family } : null,
    typeof item.number === 'string' ? { label: 'number', value: item.number } : null,
    typeof cores === 'number' && typeof threads === 'number'
      ? { label: 'coresThreads', value: `${cores}C/${threads}T` }
      : null,
  ].filter((part): part is CpuCanvasPart => part !== null)

  return parts
}

export function formatCpuCanvasLabel(item: InventoryItem): string {
  const parts = formatCpuCanvasParts(item).map((part) => part.value)

  return parts.length > 0 ? parts.join(' ') : item.name
}

export function formatGpuCanvasParts(item: InventoryItem): GpuCanvasPart[] {
  const formFactor = item.specs?.formFactor
  const parts = [
    typeof item.manufacturer === 'string'
      ? { label: 'manufacturer', value: item.manufacturer }
      : null,
    typeof item.model === 'string' ? { label: 'model', value: item.model } : null,
    typeof formFactor === 'string' ? { label: 'formFactor', value: formFactor } : null,
  ].filter((part): part is GpuCanvasPart => part !== null)

  return parts
}

export function formatGpuCanvasLabel(item: InventoryItem): string {
  const parts = formatGpuCanvasParts(item).map((part) => part.value)

  return parts.length > 0 ? parts.join(' ') : item.name
}

export function formatPortType(type: InventoryPortType): string {
  if (type === 'sfp-plus') {
    return 'SFP+'
  }

  if (type === 'displayport') {
    return 'DP'
  }

  if (type === 'mini-displayport') {
    return 'MiniDP'
  }

  return type.toUpperCase()
}

function summarizePorts(
  ports: InventoryPort[] | undefined,
  predicate: (port: InventoryPort) => boolean = () => true,
): string {
  const counts = new Map<string, number>()

  for (const port of ports ?? []) {
    if (!predicate(port)) {
      continue
    }

    const key = port.speed ? `${port.speed} ${formatPortType(port.type)}` : formatPortType(port.type)

    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()].map(([key, count]) => `${count}x ${key}`).join(' / ')
}

export function formatEquipmentCanvasParts(item: InventoryItem): EquipmentCanvasPart[] {
  if (item.type === 'switch') {
    const rj45Ports = summarizePorts(item.ports, (port) => port.type === 'rj45')
    const uplinks = summarizePorts(item.ports, (port) => port.type === 'sfp' || port.type === 'sfp-plus')
    const management = item.specs?.management
    const parts = [
      rj45Ports ? { label: 'ports', value: rj45Ports } : null,
      uplinks ? { label: 'uplinks', value: uplinks } : null,
      typeof management === 'string' ? { label: 'management', value: management } : null,
    ].filter((part): part is EquipmentCanvasPart => part !== null)

    return parts
  }

  if (item.type === 'patchPanel') {
    const keystonePorts = summarizePorts(item.ports)
    const rackUnits = item.specs?.rackUnits
    const parts = [
      keystonePorts ? { label: 'keystone', value: keystonePorts } : null,
      typeof rackUnits === 'number' ? { label: 'rackUnits', value: `${rackUnits}U` } : null,
    ].filter((part): part is EquipmentCanvasPart => part !== null)

    return parts
  }

  return []
}

export function formatEquipmentCanvasLabel(item: InventoryItem): string {
  const parts = formatEquipmentCanvasParts(item).map((part) => part.value)

  return parts.length > 0 ? parts.join(' ') : item.name
}

export function formatPortSummary(item: InventoryItem): string {
  return summarizePorts(item.ports) || 'No ports'
}

export function formatServerPortCanvasParts(item: InventoryItem): ServerCanvasPortPart[] {
  const networkPorts = summarizePorts(item.ports, (port) => port.type === 'rj45')
  const displayPorts = summarizePorts(
    item.ports,
    (port) => port.type === 'hdmi' || port.type === 'displayport' || port.type === 'mini-displayport',
  )
  const parts = [
    networkPorts ? { label: 'network', value: networkPorts } : null,
    displayPorts ? { label: 'display', value: displayPorts } : null,
  ].filter((part): part is ServerCanvasPortPart => part !== null)

  return parts
}
