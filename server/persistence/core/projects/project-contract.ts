export const PROJECT_ICON_KEYS = [
  'folder',
  'house',
  'server',
  'network',
  'boxes',
  'building-2',
  'layers-3',
] as const

export const WORKSPACE_ICON_KEYS = [
  'network',
  'layout-grid',
  'boxes',
  'route',
  'chart-no-axes-column',
] as const

export const WORKSPACE_COLOR_KEYS = [
  'blue',
  'green',
  'amber',
  'red',
  'violet',
  'cyan',
  'pink',
  'gray',
] as const

export type ProjectIconKey = typeof PROJECT_ICON_KEYS[number]
export type WorkspaceIconKey = typeof WORKSPACE_ICON_KEYS[number]
export type WorkspaceColorKey = typeof WORKSPACE_COLOR_KEYS[number]
export type WorkspaceType = 'systems' | 'canvas' | 'rack' | 'diagram' | 'vlan'

export type ProjectSummary = Readonly<{
  id: number
  name: string
  description: string | null
  iconKey: ProjectIconKey
  revision: number
  includesGlobalInventory: boolean
  archivedAtMs: number | null
  createdAtMs: number
  updatedAtMs: number
}>

export type WorkspaceSummary = Readonly<{
  id: number
  projectId: number
  type: WorkspaceType
  name: string
  iconKey: string
  colorKey: string
  sortOrder: number
  revision: number
  systemKey: string | null
  archivedAtMs: number | null
  createdAtMs: number
  updatedAtMs: number
  viewportX: number | null
  viewportY: number | null
  viewportZoomBasisPoints: number | null
  settings: Readonly<Record<string, unknown>>
}>

export type ProjectWorkbook = Readonly<{
  project: ProjectSummary
  defaultWorkspaceId: number
  workspaces: readonly WorkspaceSummary[]
}>

function assertAllowed<const T extends readonly string[]>(
  value: string,
  values: T,
  label: string,
): asserts value is T[number] {
  if (!values.includes(value)) throw new Error(`${label} is not supported.`)
}

export function assertProjectIconKey(value: string): asserts value is ProjectIconKey {
  assertAllowed(value, PROJECT_ICON_KEYS, 'Project icon')
}

export function assertWorkspaceAppearance(input: {
  iconKey: string
  colorKey: string
}): asserts input is {
  iconKey: WorkspaceIconKey
  colorKey: WorkspaceColorKey
} {
  assertAllowed(input.iconKey, WORKSPACE_ICON_KEYS, 'Workspace icon')
  assertAllowed(input.colorKey, WORKSPACE_COLOR_KEYS, 'Workspace color')
}
