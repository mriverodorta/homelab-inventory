import { canonicalJson } from './canonicalize'
import { computeCatalogDigestsWithIdentity } from './hash'
import { catalogItemMeetsEligibility } from './projector'
import type {
  CatalogProjection,
  CatalogProjectionGroup,
  CatalogTemplateItem,
  JsonValue,
  WithheldCatalogProjectionGroup,
} from './types'

const OMIT = Symbol('omit')

function mergeValues(values: unknown[]): unknown | typeof OMIT {
  const present = values.filter((value) => value !== undefined)
  if (present.length === 0) return OMIT
  const unique = new Map(present.map((value) => [canonicalJson(value), value]))
  if (unique.size === 1) return unique.values().next().value
  if (present.every((value) => value && typeof value === 'object' && !Array.isArray(value))) {
    const keys = new Set(present.flatMap((value) => Object.keys(value as Record<string, unknown>)))
    const merged: Record<string, unknown> = {}
    for (const key of keys) {
      const value = mergeValues(present.map((entry) => (entry as Record<string, unknown>)[key]))
      if (value !== OMIT) merged[key] = value
    }
    return Object.keys(merged).length > 0 ? merged : OMIT
  }
  return OMIT
}

export async function reconcileCatalogProjections(
  projections: CatalogProjection[],
): Promise<Array<CatalogProjectionGroup | WithheldCatalogProjectionGroup>> {
  const groups = new Map<string, Extract<CatalogProjection, { status: 'eligible' }> []>()
  for (const projection of projections) {
    if (projection.status !== 'eligible') continue
    const group = groups.get(projection.identityHash) ?? []
    group.push(projection)
    groups.set(projection.identityHash, group)
  }

  const output: Array<CatalogProjectionGroup | WithheldCatalogProjectionGroup> = []
  for (const [identityHash, observations] of groups) {
    const sources = observations.map((entry) => entry.source)
    const merged = mergeValues(observations.map((entry) => entry.item))
    if (merged === OMIT || !catalogItemMeetsEligibility(merged as CatalogTemplateItem)) {
      output.push({ status: 'withheld-conflict', identityHash, sources, reason: 'Merged content no longer meets category eligibility.' })
      continue
    }
    const item = merged as CatalogTemplateItem
    const digests = await computeCatalogDigestsWithIdentity(item, observations[0].identityPayload as Record<string, JsonValue>)
    output.push({ item, sources, ...digests })
  }
  return output
}
