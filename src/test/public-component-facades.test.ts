import { describe, expect, it } from 'vitest'

describe('public component facades', () => {
  it('preserves application and workbench entry points', async () => {
    const app = await import('@/App')
    const inspector = await import('@/components/inspector-panel')
    const canvas = await import('@/components/workbench-canvas')
    const contract = await import('@/components/workbench-canvas-contract')

    expect(app.default).toBeTypeOf('function')
    expect(inspector.InspectorPanel).toBeTypeOf('function')
    expect(canvas.WorkbenchCanvas).toBeTypeOf('function')
    expect(contract.snapToGrid).toBeTypeOf('function')
    expect(contract.getComponentDropCompatibilityStatus).toBeTypeOf('function')
  })
})
