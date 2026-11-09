import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseShareViewBlob, type SystemsViewBlob } from '@homelab-inventory/share-contract'
import { createSharedSystemsModel, createSharedCanvasModel, parseSharedPresentationContext, type SharedPresentationContext } from '../src'

const fixture = async (name = 'systems-v1.json') => JSON.parse(await readFile(resolve(process.cwd(), `packages/share-contract/test/fixtures/${name}`), 'utf8'))
const reference = { templateKey: 'desktop-historical-fixture', templateRevision: 1, contentHash: 'a'.repeat(64) }
const context = (physicalClass: string): SharedPresentationContext => ({ version: 1, registryClasses: [{ ...reference, physicalClass }] })

describe('computer presentation without contract changes', () => {
  it.each([['desktop', 'Desktop PC'], ['laptop', 'Laptop'], ['workstation', 'Workstation'], ['server', 'Server'], ['future-class', 'Computer'], ['', 'Computer']])('maps custom %s independently of role', async (hardwareClass, label) => {
    const blob = await fixture()
    blob.items[0].source = { type: 'custom', definition: { hardwareClass, usageRole: 'server', formFactor: 'Micro', memoryType: 'SO-DIMM' } }
    const before = JSON.stringify(blob)
    const model = createSharedSystemsModel(blob)
    expect(model.rows[0]?.typeLabel).toBe(label)
    expect(model.rows[0]?.type).toBe('server')
    expect(JSON.stringify(blob)).toBe(before)
    expect(parseShareViewBlob(blob)).toEqual(blob)
    expect(Object.isFrozen(model.rows[0])).toBe(true)
  })

  it('uses all three identity fields and ignores overrides and names', async () => {
    const blob: SystemsViewBlob = await fixture()
    blob.items[0]!.source = { type: 'registry', registryReference: reference, localOverrides: { hardwareClass: 'laptop', usageRole: 'server' } }
    const before = JSON.stringify(blob)
    expect(createSharedSystemsModel(blob, context('desktop')).rows[0]?.typeLabel).toBe('Desktop PC')
    for (const mismatch of [{ templateRevision: 2 }, { contentHash: 'b'.repeat(64) }, { templateKey: 'desktop-other-fixture' }]) {
      const evidence = context('laptop')
      Object.assign(evidence.registryClasses[0]!, mismatch)
      expect(createSharedSystemsModel(blob, evidence).rows[0]?.typeLabel).toBe('Computer')
    }
    expect(createSharedSystemsModel(blob).rows[0]?.typeLabel).toBe('Computer')
    expect(JSON.stringify(blob)).toBe(before)
  })

  it('keeps legacy, NAS and PC Build labels and does not infer from role', async () => {
    const blob = await fixture()
    blob.items[0].source = { type: 'custom', definition: { usageRole: 'server', name: 'Laptop', formFactor: 'Tiny' } }
    expect(createSharedSystemsModel(blob).rows[0]?.typeLabel).toBe('Computer')
    for (const [type, label] of [['nas', 'NAS'], ['pcBuild', 'PC Build']]) {
      blob.items[0].type = type
      expect(createSharedSystemsModel(blob).rows[0]?.typeLabel).toBe(label)
    }
  })

  it('propagates the same presentation to canvas nodes and endpoints without changing IDs', async () => {
    const blob = await fixture('canvas-v1.json')
    const before = JSON.stringify(blob)
    const model = createSharedCanvasModel(blob)
    expect(model.nodes.map(node => node.publicNodeId)).toEqual(blob.nodes.map((node: { publicNodeId: string }) => node.publicNodeId))
    for (const node of model.nodes) expect(node.item.typeLabel).toBeDefined()
    for (const edge of model.connections) expect(edge.source.item.typeLabel).toBeDefined()
    expect(JSON.stringify(blob)).toBe(before)
  })

  it('rejects malformed, unversioned and conflicting context', () => {
    expect(() => parseSharedPresentationContext({ ...context('desktop'), version: 2 })).toThrow()
    expect(() => parseSharedPresentationContext({ ...context('desktop'), secret: 'not permitted' })).toThrow()
    expect(() => parseSharedPresentationContext({ version: 1, registryClasses: [{ ...reference, physicalClass: 'desktop', unexpected: true }] })).toThrow()
    expect(() => parseSharedPresentationContext({ version: 1, registryClasses: [...context('desktop').registryClasses, ...context('server').registryClasses] })).toThrow('Conflicting')
    expect(parseSharedPresentationContext(context('unknown')).registryClasses[0]?.physicalClass).toBe('unknown')
  })
})
