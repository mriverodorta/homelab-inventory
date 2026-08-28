import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type ReactFlowProps,
  type Viewport,
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
  active: boolean
  canvasRootRef: RefObject<HTMLElement | null>
  droppableRef: (element: HTMLElement | null) => void
  isDropTarget: boolean
  hasPlacements: boolean
  nodes: WorkbenchFlowNode[]
  edges: CableFlowEdge[]
  flowEvents: CanvasFlowProps
  nodeDragThreshold: number
  snapItemsToGrid: boolean
  initialViewport: Viewport | null
  onViewportChange(viewport: Viewport): void
  forceRenderAllNodes: boolean
  nodesDraggable: boolean
  activity: CanvasActivity | null
  validationMessage: string | null
  validationSeverity: ValidationMessageSeverity
  demoRemainingSeconds?: number | null
  commandBar: CanvasCommandBarProps
}

export function CanvasViewportSurface({
  active,
  canvasRootRef,
  droppableRef,
  isDropTarget,
  hasPlacements,
  nodes,
  edges,
  flowEvents,
  nodeDragThreshold,
  snapItemsToGrid,
  initialViewport,
  onViewportChange,
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
          'relative h-full overflow-hidden bg-[#fbf8f1] transition',
          isDropTarget && 'ring-2 ring-inset ring-[#ddb668]',
        )}
      >
        {active ? <div className="pointer-events-none absolute left-4 top-4 z-30 flex max-w-[min(24rem,calc(100%-2rem))] flex-col items-start gap-2">
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
        </div> : null}
        {active && !hasPlacements ? (
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-dashed border-[#b9aa98] bg-white/80 p-5 text-center text-sm text-[#75695d]">
            Drag equipment from the inventory to start a layout.
          </div>
        ) : null}
        {active ? <CanvasCommandBar {...commandBar} /> : null}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={canvasNodeTypes}
          edgeTypes={canvasEdgeTypes}
          {...(active ? flowEvents : {})}
          minZoom={0.25}
          maxZoom={1.8}
          nodeDragThreshold={nodeDragThreshold}
          nodesDraggable={active && nodesDraggable}
          nodesConnectable={false}
          connectOnClick={false}
          nodesFocusable={active}
          edgesFocusable={active}
          elementsSelectable={active}
          snapToGrid={snapItemsToGrid}
          snapGrid={[GRID_SIZE, GRID_SIZE]}
          defaultViewport={initialViewport ?? { x: 0, y: 0, zoom: 1 }}
          onMoveEnd={active ? (_event, viewport) => onViewportChange(viewport) : undefined}
          panOnDrag={active}
          zoomOnScroll={active}
          zoomOnPinch={active}
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
          onlyRenderVisibleElements={!forceRenderAllNodes}
          proOptions={{ hideAttribution: true }}
          fitView={active && hasPlacements && initialViewport === null}
          className="homelab-inventory-flow bg-[#fbf8f1]"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={GRID_SIZE}
            size={2.25}
            color="#c7bbab"
          />
          {active ? <Controls showInteractive={false} /> : null}
          {active ? <MiniMap
            pannable
            zoomable
            className="homelab-inventory-minimap !bottom-4 !right-4 !hidden !h-28 !w-40 !rounded-none !border-0 !bg-[#fffdf8] !shadow-none md:!block"
            bgColor="#fffdf8"
            nodeColor="#20242c"
            maskColor="transparent"
          /> : null}
        </ReactFlow>
      </div>
    </main>
  )
}
