import {
  canonicalizeCatalogItemV9,
  canonicalizeCatalogItemV13,
  legacyMeasurementPathsV9,
  stripPrivateCatalogDataV13,
} from '../../packages/catalog-protocol/src/index.ts'
import { projectLocalItemForCatalog } from './local-catalog-mapping.mjs'

function retainEvidence(source, canonical) {
  if (Array.isArray(source) && Array.isArray(canonical)) return canonical.map((entry, index) => retainEvidence(source[index], entry))
  if (!source || typeof source !== 'object' || Array.isArray(source)) return canonical ?? source
  const result = structuredClone(source)
  for (const [key, value] of Object.entries(canonical ?? {})) result[key] = retainEvidence(source[key], value)
  return result
}

// Legacy app views expose display units. Convert only at this boundary, retaining
// explicit empty evidence that historical v9 sanitization deliberately omitted.
function canonicalUnits(source) {
  const input = structuredClone(source)
  if (input.fixedComponents) input.fixedComponents = input.fixedComponents.map((component) => ({ ...component, item: canonicalUnits(component.item) }))
  const result = retainEvidence(input, canonicalizeCatalogItemV9(input))
  for (const path of legacyMeasurementPathsV9(input)) {
    const segments = path.match(/[^.[\]]+/g) ?? []
    const key = segments.pop()
    let parent = result
    for (const segment of segments) parent = parent?.[segment]
    if (parent && key !== undefined) delete parent[key]
  }
  return result
}

export function projectLocalLaptopForCatalog(value) {
  const projected = projectLocalItemForCatalog(value, value.type)
  if (Array.isArray(projected.ports)) {
    projected.ports = projected.ports.filter(port => !(port.derivedFromHostPower === true && port.type === 'ac-input'))
      .map(({ derivedFromHostPower: _derived, ...port }) => port)
    if (!projected.ports.length && projected.localCatalogEvidence?.ports === false) delete projected.ports
  }
  delete projected.localCatalogEvidence
  const source = stripPrivateCatalogDataV13(projected)
  return canonicalizeCatalogItemV13(canonicalUnits(source))
}
