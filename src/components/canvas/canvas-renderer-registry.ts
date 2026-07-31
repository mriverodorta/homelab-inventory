import type { EdgeTypes, NodeTypes } from '@xyflow/react'
import { CableEdge } from '@/components/cable-edge'
import { EquipmentNode } from '@/components/equipment-card'
import { MonitorNode } from '@/components/monitor-card'
import { NasNode } from '@/components/nas-card'
import { PcBuildNode } from '@/components/pc-build-card'
import { PowerStripNode } from '@/components/power-strip-card'
import { ServerNode } from '@/components/server-card'
import { UpsNode } from '@/components/ups-card'

export const canvasNodeTypes: NodeTypes = {
  equipment: EquipmentNode,
  monitor: MonitorNode,
  nas: NasNode,
  pcBuild: PcBuildNode,
  powerStrip: PowerStripNode,
  server: ServerNode,
  ups: UpsNode,
}

export const canvasEdgeTypes: EdgeTypes = {
  cable: CableEdge,
}
