import { describe, expect, it } from 'vitest'
import vectors from '../../packages/catalog-protocol/src/laptop-v13-vectors.json'
import { projectCatalogTemplateForRuntime } from './catalog-runtime-projection.mjs'
import { projectLocalLaptopForCatalog } from './laptop-local-projection.mjs'
import { evaluateAssignmentCompatibility } from '../../shared/compatibility/index.mjs'
import { withCanonicalPowerPorts } from '../../shared/power-ports.mjs'

const laptop = (name) => ({ ...structuredClone(vectors.cases.find(entry => entry.name === name).item), id: 1, type: 'server', hardwareClass: 'laptop' })
const evaluate = (host, component) => evaluateAssignmentCompatibility({ host, component })
const ram = (mib) => ({ id: 2, type: 'ram', name: 'Synthetic RAM', specs: { capacityMib: mib, generation: 'DDR5', formFactor: 'SO-DIMM' } })
const codes = (result) => result.findings.map(finding => finding.code)

describe('laptop v13 application contract', () => {
  it.each(vectors.cases.map(vector => [vector.name, vector]))('projects %s exactly without historical canonicalization', (_, vector) => {
    const projected = projectCatalogTemplateForRuntime({ fingerprintVersion: 13, item: vector.item })
    expect(projected.runtimeCanonicalVersion).toBe(13)
    expect(projected.item).toEqual(vector.item)
    expect(projectLocalLaptopForCatalog({ ...vector.item, type: 'server', hardwareClass: 'laptop', usageRole: 'server', id: 17 })).toEqual(vector.item)
  })

  it('keeps fixed CPU nonassignable and supports explicitly socketed CPUs', () => {
    const cpu = { id: 2, type: 'cpu', name: 'Synthetic CPU', specs: { socket: 'Synthetic Socket' } }
    expect(codes(evaluate(laptop('soldered-cpu-replaceable-memory'), cpu))).toContain('cpu.fixed.not-replaceable')
    expect(codes(evaluate(laptop('socketed-cpu'), cpu))).not.toContain('cpu.fixed.not-replaceable')
  })

  it('counts fixed RAM toward capacity but not replaceable slots', () => {
    expect(codes(evaluate(laptop('all-fixed-memory'), ram(8192)))).toContain('memory.slots.exceeded')
    const mixed = laptop('mixed-memory')
    expect(codes(evaluate(mixed, ram(32768)))).not.toContain('memory.capacity.exceeded')
    expect(codes(evaluate(mixed, ram(32768)))).not.toContain('memory.slots.exceeded')
    expect(codes(evaluate(mixed, ram(40960)))).toContain('memory.capacity.exceeded')
  })

  it('does not invent power topology and gives the AC endpoint to its declared owner', () => {
    const adapter = { id: 3, type: 'powerAdapter', name: 'Synthetic adapter', specs: {} }
    const unknown = laptop('soldered-cpu-replaceable-memory')
    expect(withCanonicalPowerPorts(unknown).ports ?? []).toEqual([])
    expect(codes(evaluate(unknown, adapter))).toContain('power.adapter.not-replaceable')
    const fixed = withCanonicalPowerPorts(laptop('power-fixed'))
    expect(fixed.ports.filter(port => port.type === 'ac-input')).toHaveLength(1)
    expect(withCanonicalPowerPorts(fixed)).toEqual(fixed)
    expect(codes(evaluate(fixed, adapter))).toContain('power.adapter.not-replaceable')
    const replaceable = withCanonicalPowerPorts(laptop('power-replaceable'))
    expect(replaceable.ports ?? []).toEqual([])
    expect(codes(evaluate(replaceable, adapter))).not.toContain('power.adapter.not-replaceable')
  })
})
