import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createSharedSystemsModel, createSharedWorkbookModel } from '../src'

const fixture = async (name: string): Promise<unknown> => JSON.parse(await readFile(
  resolve(process.cwd(), `packages/share-contract/test/fixtures/${name}`),
  'utf8',
))

describe('shared Systems model', () => {
  it('projects ordered immutable public rows', async () => {
    const model = createSharedSystemsModel(await fixture('systems-v1.json'))

    expect(model.rows.map((row) => row.publicItemId)).toEqual(['item_server_0001'])
    expect(model.rows[0]).not.toHaveProperty('serialNumber')
    expect(model.rows[0]?.resourceSnapshot?.cpu?.usagePercent).toBe(18)
    expect(Object.isFrozen(model)).toBe(true)
    expect(Object.isFrozen(model.rows[0])).toBe(true)
  })

  it('preserves workbook order', async () => {
    const model = createSharedWorkbookModel(await fixture('manifest-v1.json'))

    expect(model.views.map((view) => view.type)).toEqual(['systems', 'canvas'])
    expect(model.initialViewPublicId).toBe('view_systems_001')
  })
})
