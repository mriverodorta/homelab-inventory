import { useMemo, useRef } from 'react'
import { Maximize2 } from 'lucide-react'
import {
  Background,
  BaseEdge,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'

import type { DeepReadonly, SharedCanvasModel, SharedCanvasNode } from '@homelab-inventory/viewer-model'

import type { ShareViewerIntent } from './index'

type ViewerNode = Node<{ sharedNode: DeepReadonly<SharedCanvasNode> }, 'shared-item'>
type ViewerEdge = Edge<{ route: ReadonlyArray<{ x: number; y: number }> }, 'shared-route'>

function SharedItemNode({ data, selected }: NodeProps<ViewerNode>) {
  return (
    <button
      className="hi-share-viewer__canvas-node nodrag nopan"
      type="button"
      aria-label={data.sharedNode.item.name}
      aria-pressed={selected}
    >
      <span className="hi-share-viewer__canvas-node-type">{data.sharedNode.item.type}</span>
      <strong>{data.sharedNode.item.name}</strong>
      {(data.sharedNode.item.manufacturer || data.sharedNode.item.model) && (
        <span>{[data.sharedNode.item.manufacturer, data.sharedNode.item.model].filter(Boolean).join(' ')}</span>
      )}
    </button>
  )
}

function routePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  route: ReadonlyArray<{ x: number; y: number }>,
): string {
  return [
    `M ${sourceX} ${sourceY}`,
    ...route.map((point) => `L ${point.x} ${point.y}`),
    `L ${targetX} ${targetY}`,
  ].join(' ')
}

function SharedRouteEdge({ sourceX, sourceY, targetX, targetY, data, ...props }: EdgeProps<ViewerEdge>) {
  return (
    <BaseEdge
      {...props}
      path={routePath(sourceX, sourceY, targetX, targetY, data?.route ?? [])}
      className="hi-share-viewer__connection"
    />
  )
}

const nodeTypes = { 'shared-item': SharedItemNode }
const edgeTypes = { 'shared-route': SharedRouteEdge }

export interface SharedCanvasViewerProps {
  model: DeepReadonly<SharedCanvasModel>
  selectedItemId?: string | null
  selectedConnectionId?: string | null
  onIntent: (intent: ShareViewerIntent) => void
}

export function SharedCanvasViewer({
  model,
  selectedItemId,
  selectedConnectionId,
  onIntent,
}: SharedCanvasViewerProps) {
  const instanceRef = useRef<ReactFlowInstance<ViewerNode, ViewerEdge> | null>(null)
  const nodeByItem = useMemo(
    () => new Map(model.nodes.map((node) => [node.publicItemId, node.publicNodeId])),
    [model.nodes],
  )
  const nodes = useMemo<ViewerNode[]>(() => model.nodes.map((node) => ({
    id: node.publicNodeId,
    type: 'shared-item',
    position: node.position,
    width: node.size.width,
    height: node.size.height,
    zIndex: node.zIndex,
    selected: selectedItemId === node.publicItemId,
    draggable: false,
    selectable: true,
    data: { sharedNode: node },
  })), [model.nodes, selectedItemId])
  const edges = useMemo<ViewerEdge[]>(() => model.connections.flatMap((connection) => {
    const source = nodeByItem.get(connection.source.publicItemId)
    const target = nodeByItem.get(connection.target.publicItemId)
    if (!source || !target) return []
    return [{
      id: connection.publicConnectionId,
      source,
      target,
      type: 'shared-route' as const,
      label: connection.label,
      selected: selectedConnectionId === connection.publicConnectionId,
      selectable: true,
      data: { route: connection.route ?? [] },
    }]
  }), [model.connections, nodeByItem, selectedConnectionId])

  const fitView = () => {
    void instanceRef.current?.fitView({ duration: 200, padding: 0.14 })
    onIntent({ type: 'fit-view' })
  }

  return (
    <div className="hi-share-viewer__canvas-shell" data-page-overflow="contained">
      <div className="hi-share-viewer__canvas" data-reduced-motion-safe>
        <ReactFlow<ViewerNode, ViewerEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          deleteKeyCode={null}
          multiSelectionKeyCode={null}
          selectionKeyCode={null}
          minZoom={0.1}
          maxZoom={2}
          defaultViewport={model.viewport ?? undefined}
          onInit={(instance) => { instanceRef.current = instance }}
          onNodeClick={(_, node) => onIntent({
            type: 'select-item',
            publicViewId: model.publicViewId,
            publicItemId: node.data.sharedNode.publicItemId,
          })}
          onEdgeClick={(_, edge) => onIntent({
            type: 'select-connection',
            publicViewId: model.publicViewId,
            publicConnectionId: edge.id,
          })}
          onPaneClick={() => onIntent({ type: 'clear-selection' })}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--hi-share-grid)" gap={24} size={1} />
        </ReactFlow>
      </div>
      <button
        className="hi-share-viewer__fit-button"
        type="button"
        aria-label="Fit view"
        title="Fit view"
        onClick={fitView}
      >
        <Maximize2 aria-hidden="true" size={17} />
      </button>
    </div>
  )
}
