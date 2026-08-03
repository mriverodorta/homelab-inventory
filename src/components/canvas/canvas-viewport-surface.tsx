import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type ReactFlowProps,
} from '@xyflow/react'
import type { ComponentProps, RefObject } from 'react'
import type { CableFlowEdge } from '@/components/cable-edge'
import {
  CanvasActivityIndicator,
  type CanvasActivity,
} from '@/components/canvas-activity-indicator'
import { CanvasCommandBar } from '@/components/canvas-command-bar'
import { canvasEdgeTypes, canvasNodeTypes } from '@/components/canvas/canvas-renderer-registry'
import type { WorkbenchFlowNode } from '@/components/canvas/flow-reconciliation'
import { GRID_SIZE, type ValidationMessageSeverity } from '@/components/workbench-canvas-contract'
import { formatRemainingSeconds } from '@/lib/demo-api'
import { cn } from '@/lib/utils'

type CanvasCommandBarProps = ComponentProps<typeof CanvasCommandBar>
type CanvasFlowProps = Pick<ReactFlowProps<WorkbenchFlowNode, CableFlowEdge>,
  | 'onNodesChange'
  | 'onNodeDragStop'
  | 'onEdgeClick'
  | 'onEdgeMouseEnter'
  | 'onEdgeMouseLeave'
  | 'onPaneClick'
  | 'onPointerDownCapture'
  | 'onPointerMoveCapture'
  | 'onPointerUpCapture'
  | 'onPointerCancelCapture'
  | 'onTouchStartCapture'
  | 'onTouchMoveCapture'
  | 'onTouchEndCapture'
  | 'onTouchCancelCapture'
>

interface CanvasViewportSurfaceProps {
  canvasRootRef: RefObject<HTMLElement | null>
  droppableRef: (element: HTMLElement | null) => void
  isDropTarget: boolean
  hasPlacements: boolean
  nodes: WorkbenchFlowNode[]
  edges: CableFlowEdge[]
  flowEvents: CanvasFlowProps
  nodeDragThreshold: number
  snapItemsToGrid: boolean
  forceRenderAllNodes: boolean
  nodesDraggable: boolean
  activity: CanvasActivity | null
  validationMessage: string | null
  validationSeverity: ValidationMessageSeverity
  demoRemainingSeconds?: number | null
  commandBar: CanvasCommandBarProps
}

export function CanvasViewportSurface({
  canvasRootRef,
  droppableRef,
  isDropTarget,
  hasPlacements,
  nodes,
  edges,
  flowEvents,
  nodeDragThreshold,
  snapItemsToGrid,
  forceRenderAllNodes,
  nodesDraggable,
  activity,
  validationMessage,
  validationSeverity,
  demoRemainingSeconds,
  commandBar,
}: CanvasViewportSurfaceProps) {
  return (
    <main ref={canvasRootRef} className="relative min-w-0 flex-1 bg-[#fbf8f1]">
      <div
        ref={droppableRef}
        className={cn(
          'relative h-dvh overflow-hidden bg-[#fbf8f1] transition',
          isDropTarget && 'ring-2 ring-inset ring-[#ddb668]',
        )}
      >
        <div className="pointer-events-none absolute left-4 top-4 z-30 flex max-w-[min(24rem,calc(100%-2rem))] flex-col items-start gap-2">
          <CanvasActivityIndicator activity={activity} />
          {validationMessage ? (
            <div
              data-testid="canvas-validation-message"
              data-severity={validationSeverity}
              role={validationSeverity === 'unknown' ? 'status' : 'alert'}
              className={cn(
                'rounded-md border px-3 py-2 text-xs font-semibold shadow-sm',
                validationSeverity === 'unknown'
                  ? 'border-[#dfc483] bg-[#fff8df] text-[#5d4814]'
                  : 'border-[#dfb3a5] bg-[#fff4ee] text-[#613126]',
              )}
            >
              {validationMessage}
            </div>
          ) : null}
          {typeof demoRemainingSeconds === 'number' ? (
            <div className="pointer-events-auto rounded-lg border border-[#d6ccbd] bg-[#fffdf8]/95 px-3 py-2 text-xs font-black uppercase tracking-[0.08em] text-[#5d554c] shadow-sm">
              Demo session {formatRemainingSeconds(demoRemainingSeconds)}
            </div>
          ) : null}
        </div>
        {!hasPlacements ? (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-dashed border-[#b9aa98] bg-white/80 p-5 text-center text-sm text-[#75695d]">
            Drag equipment from the inventory to start a layout.
          </div>
        ) : null}
        <CanvasCommandBar {...commandBar} />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={canvasNodeTypes}
          edgeTypes={canvasEdgeTypes}
          {...flowEvents}
          minZoom={0.25}
          maxZoom={1.8}
          nodeDragThreshold={nodeDragThreshold}
          nodesDraggable={nodesDraggable}
          snapToGrid={snapItemsToGrid}
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
          onlyRenderVisibleElements={!forceRenderAllNodes}
          proOptions={{ hideAttribution: true }}
          fitView={hasPlacements}
          className="homelab-inventory-flow bg-[#fbf8f1]"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={GRID_SIZE}
            size={2.25}
            color="#c7bbab"
          />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            className="homelab-inventory-minimap !bottom-4 !right-4 !hidden !h-28 !w-40 !rounded-none !border-0 !bg-[#fffdf8] !shadow-none md:!block"
            bgColor="#fffdf8"
            nodeColor="#20242c"
            maskColor="transparent"
          />
        </ReactFlow>
      </div>
    </main>
  )
}
