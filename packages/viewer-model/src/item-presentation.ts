import type { PublicItem } from '@homelab-inventory/share-contract'

import type { DeepReadonly } from './immutable'

/** Transport metadata, never part of a signed PublicItem or share blob. */
export interface SharedPresentationContext {
  version: 1
  registryClasses: Array<{
    templateKey: string
    templateRevision: number
    contentHash: string
    physicalClass: string
  }>
}

export type SharedPresentedItem<T extends PublicItem = PublicItem> = T & { typeLabel?: string }

const physicalLabels = new Map([
  ['desktop', 'Desktop PC'], ['laptop', 'Laptop'],
  ['workstation', 'Workstation'], ['server', 'Server'],
])

/** Callers must supply evidence only from their validated exact Registry resolver. */
export function parseSharedPresentationContext(value: unknown): SharedPresentationContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid presentation context.')
  const context = value as Record<string, unknown>
  if (context.version !== 1 || Object.keys(context).some(key => !['version', 'registryClasses'].includes(key))
    || !Array.isArray(context.registryClasses) || context.registryClasses.length > 10_000) {
    throw new TypeError('Invalid presentation context.')
  }
  const seen = new Map<string, string>()
  const registryClasses = context.registryClasses.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('Invalid Registry presentation evidence.')
    const row = entry as Record<string, unknown>
    if (Object.keys(row).some(key => !['templateKey', 'templateRevision', 'contentHash', 'physicalClass'].includes(key))
      || typeof row.templateKey !== 'string' || !row.templateKey.length || row.templateKey.length > 256
      || !Number.isSafeInteger(row.templateRevision) || Number(row.templateRevision) < 1
      || typeof row.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.contentHash)
      || typeof row.physicalClass !== 'string' || row.physicalClass.length > 80) {
      throw new TypeError('Invalid Registry presentation evidence.')
    }
    const result = { templateKey: row.templateKey, templateRevision: row.templateRevision as number, contentHash: row.contentHash, physicalClass: row.physicalClass }
    const key = referenceKey(result)
    if (seen.has(key) && seen.get(key) !== result.physicalClass) throw new TypeError('Conflicting Registry presentation evidence.')
    seen.set(key, result.physicalClass)
    return result
  })
  return { version: 1, registryClasses }
}

function referenceKey(reference: { templateKey: string; templateRevision: number; contentHash: string }): string {
  return JSON.stringify([reference.templateKey, reference.templateRevision, reference.contentHash])
}

/** Also supports legacy callers constructing their own viewer models. */
export function sharedItemTypeLabel(item: DeepReadonly<SharedPresentedItem>): string {
  if (item.type !== 'server') return item.type === 'nas' ? 'NAS' : item.type === 'pcBuild' ? 'PC Build' : item.type
  if (item.typeLabel && [...physicalLabels.values(), 'Computer'].includes(item.typeLabel)) return item.typeLabel
  const physicalClass = item.source.type === 'custom' ? item.source.definition.hardwareClass : undefined
  return typeof physicalClass === 'string' ? physicalLabels.get(physicalClass) ?? 'Computer' : 'Computer'
}

export function presentSharedItems<T extends PublicItem>(items: T[], context?: SharedPresentationContext): SharedPresentedItem<T>[] {
  const evidence = context ? parseSharedPresentationContext(context).registryClasses : []
  const classes = new Map(evidence.map(entry => [referenceKey(entry), entry.physicalClass]))
  return items.map(item => {
    const physicalClass = item.source.type === 'registry' ? classes.get(referenceKey(item.source.registryReference)) : undefined
    const typeLabel = item.type === 'server' && item.source.type === 'registry'
      ? physicalLabels.get(physicalClass ?? '') ?? 'Computer'
      : sharedItemTypeLabel(item)
    return { ...item, typeLabel }
  })
}
