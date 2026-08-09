import { summarizeLocalStorage } from './storage-mounts.mjs'

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function flattenTopology(node, depth = 0) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 5) return []
  const current = { ...node, topologyDepth: depth }
  delete current.children
  const children = Array.isArray(node.children)
    ? node.children.flatMap((child) => flattenTopology(child, depth + 1))
    : []
  return [current, ...children]
}

function findStorageItem(inventory, id) {
  return inventory?.storage?.find((item) => item.id === id) ?? null
}

function storageAssignments(project, host) {
  return (project?.assignments ?? []).filter((assignment) => (
    assignment.hostType === host.hostType
    && assignment.hostId === host.hostId
    && assignment.itemType === 'storage'
  ))
}

function storageComponents(snapshot) {
  return (snapshot?.components ?? []).filter((component) => component.kind === 'storage')
}

function componentFingerprint(component) {
  return text(component?.values?.opaqueFingerprint)
}

function matchStorageComponents(snapshot, inventory, project) {
  const host = { hostType: snapshot?.host?.type ?? snapshot?.hostType, hostId: snapshot?.host?.id ?? snapshot?.hostId }
  const assignments = storageAssignments(project, host).map((assignment) => ({
    assignment,
    item: findStorageItem(inventory, assignment.itemId),
  })).filter(({ item }) => item)
  const remaining = [...assignments]
  const components = storageComponents(snapshot)
  const positional = components.length === assignments.length
  return components.map((component) => {
    const fingerprint = componentFingerprint(component)
    let index = remaining.findIndex(({ item }) => fingerprint && item.agentHardwareFingerprint === fingerprint)
    let method = 'opaque-fingerprint'
    if (index < 0) {
      const locator = text(component.locator).toLowerCase()
      index = remaining.findIndex(({ assignment }) => {
        const label = assignment.slotLabel ?? assignment.locator ?? assignment.allocation?.locator
        return text(label).toLowerCase() === locator
      })
      method = 'physical-locator'
    }
    if (index < 0 && positional) {
      index = 0
      method = 'one-to-one-position'
    }
    if (index < 0) return { component, item: null, method: 'ambiguous' }
    const [target] = remaining.splice(index, 1)
    return { component, item: target.item, method }
  })
}

export function buildStorageTelemetry({ heartbeat, snapshot, inventory, project }) {
  const summary = summarizeLocalStorage(heartbeat?.metrics?.filesystems ?? [])
  const unmatchedMounts = new Map(summary.mounts.map((mount) => [mount.mountPoint, mount]))
  const items = []
  for (const match of snapshot ? matchStorageComponents(snapshot, inventory, project) : []) {
    if (!match.item) continue
    const topology = flattenTopology(match.component.values)
  const deviceIds = new Set(topology.map((node) => text(node.majorMinor ?? node.majMin)).filter(Boolean))
    const devicePaths = new Set(topology.map((node) => text(node.path)).filter(Boolean))
    const mounts = summary.mounts.filter((mount) => (
      deviceIds.has(text(mount.majorMinor)) || devicePaths.has(text(mount.source))
    ))
    mounts.forEach((mount) => unmatchedMounts.delete(mount.mountPoint))
    items.push({
      itemType: 'storage',
      itemId: match.item.id,
      match: match.method,
      device: {
        locator: match.component.locator,
        model: match.component.values?.model ?? null,
        vendor: match.component.values?.vendor ?? null,
        sizeBytes: Number(match.component.values?.size) || null,
        transport: match.component.values?.tran ?? null,
        partitionTable: match.component.values?.pttype ?? match.component.values?.ptType ?? null,
        rotational: match.component.values?.rota ?? null,
        topology,
      },
      mounts,
    })
  }
  return { summary, items, unmatchedMounts: [...unmatchedMounts.values()] }
}
