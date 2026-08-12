import {
  Boxes,
  Building2,
  Folder,
  House,
  Layers3,
  Network,
  Server,
  type LucideProps,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { ProjectIconKey } from '@/lib/workbook-api'

const PROJECT_ICONS = {
  folder: Folder,
  house: House,
  server: Server,
  network: Network,
  boxes: Boxes,
  'building-2': Building2,
  'layers-3': Layers3,
} satisfies Record<ProjectIconKey, ComponentType<LucideProps>>

export function ProjectIcon({ iconKey, ...props }: LucideProps & { iconKey: ProjectIconKey }) {
  const Icon = PROJECT_ICONS[iconKey]
  return <Icon {...props} />
}
