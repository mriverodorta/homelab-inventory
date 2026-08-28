import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { DeepReadonly, SharedCanvasModel } from '@homelab-inventory/viewer-model'

import { SharedCanvasViewer } from '../src'

const flowProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>()
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      flowProps.current = props
      return <div data-testid="shared-react-flow">{props.children}</div>
    },
    Background: () => <div data-testid="shared-background" />,
  }
})

const model: DeepReadonly<SharedCanvasModel> = {
  publicViewId: 'view_canvas_zoom',
  items: [],
  nodes: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

describe('SharedCanvasViewer zoom range', () => {
  it('uses the standard Canvas zoom limits', () => {
    render(<SharedCanvasViewer model={model} onIntent={vi.fn()} />)

    expect(flowProps.current).toMatchObject({
      minZoom: 0.1,
      maxZoom: 2,
    })
  })
})
