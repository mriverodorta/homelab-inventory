import { formatCapacity, formatPortSummary } from '@/lib/format'
import {
  getInventoryDragPreviewPresentation,
} from '@/lib/inventory-drag-preview'
import { runtimeItemKey } from '@/lib/item-keys'
import {
  getCanvasItemHeight,
  getCanvasItemWidth,
  isCanvasItem,
} from '@/lib/project'
import type { InventoryItem, ProjectState } from '@/types/inventory'

function dragPreviewTone(item: InventoryItem): string {
  if (item.type === 'server') return 'border-[#adc19b] bg-[#20242c] text-[#f8f1e8]'
  if (item.type === 'nas') return 'border-[#9eb6c8] bg-[#20242c] text-[#f8f1e8]'
  if (item.type === 'pcBuild') return 'border-[#78a6b8] bg-[#20242c] text-[#f8f1e8]'
  if (item.type === 'switch') return 'border-[#81a6a0] bg-[#1f3536] text-[#f3fbf9]'
  if (item.type === 'patchPanel') return 'border-[#a995c8] bg-[#322b45] text-[#faf7ff]'
  if (item.type === 'monitor') return 'border-[#7e9ab8] bg-[#354154] text-[#f5f8fb]'
  if (item.type === 'ups') return 'border-[#83a890] bg-[#33473f] text-[#f3faf5]'
  if (item.type === 'powerStrip') return 'border-[#a68ab3] bg-[#453a4d] text-[#faf4fc]'
  if (item.type === 'cpu') return 'border-[#8bb3bd] bg-[#8bb3bd] text-[#132126]'
  if (item.type === 'ram') return 'border-[#ddb668] bg-[#ddb668] text-[#2b2010]'
  if (item.type === 'storage') return 'border-[#b5a58f] bg-[#ded2be] text-[#3d3429]'
  if (item.type === 'gpu') return 'border-[#d57b69] bg-[#d57b69] text-[#2f1813]'

  return 'border-[#86a989] bg-[#86a989] text-[#132117]'
}

function getDragPreviewSubtitle(item: InventoryItem): string {
  if (item.type === 'server') return String(item.specs?.formFactor ?? 'Server')
  if (item.type === 'nas') return `${item.specs?.driveBays ?? '?'} bays / ${item.specs?.m2Slots ?? 0} M.2`
  if (item.type === 'pcBuild') return String(item.specs?.operatingSystem ?? 'Custom PC build')
  if (item.type === 'switch' || item.type === 'patchPanel') return formatPortSummary(item)
  if (item.type === 'monitor') return `${item.specs?.sizeInches ?? '?'} in / ${item.specs?.resolution ?? 'display'}`
  if (item.type === 'ups' || item.type === 'powerStrip') {
    return `${item.specs?.outlets ?? item.ports?.length ?? 0} outlets`
  }
  if (item.type === 'cpu') return `${item.specs?.cores ?? '?'}C/${item.specs?.threads ?? '?'}T`
  if (item.type === 'ram') return `${item.specs?.capacityGb ?? '?'}GB / ${item.specs?.generation ?? 'RAM'}`
  if (item.type === 'storage') return `${formatCapacity(item.specs)} / ${item.specs?.interface ?? 'storage'}`
  if (item.type === 'network') {
    return `${item.specs?.ports ?? item.ports?.length ?? 1} ports / ${item.specs?.speedMbps ?? '?'}Mbps`
  }

  return item.type
}

export function InventoryDragPreview({
  item,
  project,
  overCanvas,
  viewportZoom,
}: {
  item: InventoryItem | null
  project: ProjectState
  overCanvas: boolean
  viewportZoom: number
}) {
  if (!item) return null

  const canvasItem = isCanvasItem(item)
  const itemRuntimeKey = runtimeItemKey(item)
  const width = canvasItem ? getCanvasItemWidth(project, itemRuntimeKey) : 220
  const height = canvasItem ? getCanvasItemHeight(project, itemRuntimeKey) : 68
  const presentation = getInventoryDragPreviewPresentation(overCanvas, viewportZoom)

  return (
    <div
      className={`pointer-events-none rounded-lg border-2 p-2 opacity-95 shadow-[0_20px_48px_rgba(32,36,44,0.32)] ${dragPreviewTone(item)}`}
      style={{
        width,
        ...(canvasItem ? { height } : { minHeight: height }),
        transform: presentation.transform,
        transformOrigin: presentation.transformOrigin,
      }}
    >
      <div className="rounded-md bg-black/10 px-3 py-2">
        <div className="truncate text-sm font-black">{item.name}</div>
        <div className="mt-0.5 truncate text-xs opacity-80">{getDragPreviewSubtitle(item)}</div>
      </div>
      {canvasItem ? (
        <div className="mt-2 rounded-md border border-dashed border-current/35 px-3 py-2 text-xs font-bold opacity-75">
          Drop footprint
        </div>
      ) : (
        <div className="mt-2 text-[10px] font-black uppercase tracking-[0.12em] opacity-70">
          Drop on server / NAS
        </div>
      )}
    </div>
  )
}
