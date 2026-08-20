import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createSharedCanvasModel } from '../src'

const canvasFixture = async (): Promise<unknown> => JSON.parse(await readFile(
  resolve(process.cwd(), 'packages/share-contract/test/fixtures/canvas-v1.json'),
  'utf8',
))

describe('shared Canvas model', () => {
  it('resolves immutable nodes and connection endpoints', async () => {
    const canvas = createSharedCanvasModel(await canvasFixture())

    expect(canvas.nodes).toHaveLength(2)
    expect(canvas.nodes[0]?.item.publicItemId).toBe('item_server_0001')
    expect(canvas.connections[0]?.source.publicItemId).toBe('item_server_0001')
    expect(canvas.connections[0]?.source.port?.publicPortId).toBe('port_server_eth01')
    expect(Object.isFrozen(canvas.connections[0]?.route)).toBe(true)
  })

  it('rejects dangling endpoint references', async () => {
    const fixture = await canvasFixture() as {
      connections: Array<{ source: { publicItemId: string } }>
    }
    fixture.connections[0]!.source.publicItemId = 'item_missing_000'

    expect(() => createSharedCanvasModel(fixture)).toThrow(/missing item/i)
  })
})
