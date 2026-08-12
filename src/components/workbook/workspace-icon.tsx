import {
  Boxes,
  ChartNoAxesColumn,
  LayoutGrid,
  Network,
  Route,
  Rows3,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { WorkspaceIconKey } from '@/lib/workbook-api'

const WORKSPACE_ICONS = {
  network: Network,
  'layout-grid': LayoutGrid,
  boxes: Boxes,
  route: Route,
  'chart-no-axes-column': ChartNoAxesColumn,
} satisfies Record<WorkspaceIconKey, ComponentType<LucideProps>>

export function WorkspaceIcon({ iconKey, ...props }: LucideProps & { iconKey: string }) {
  const Icon = iconKey in WORKSPACE_ICONS
    ? WORKSPACE_ICONS[iconKey as WorkspaceIconKey]
    : Rows3
  return <Icon {...props} />
}
