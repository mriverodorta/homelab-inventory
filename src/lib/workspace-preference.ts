import type { WorkspaceSummary } from '@/lib/workbook-api'

const STORAGE_KEY = 'homelab-inventory.workbook-preferences'
const VERSION = 1

export type WorkbookBrowserPreference = {
  version: 1
  useLastActiveWorkspace: boolean
  lastWorkspaceByProject: Record<string, number>
}

export const DEFAULT_WORKBOOK_PREFERENCE: WorkbookBrowserPreference = {
  version: VERSION,
  useLastActiveWorkspace: false,
  lastWorkspaceByProject: {},
}

export function readWorkbookPreference(storage: Pick<Storage, 'getItem'> = window.localStorage): WorkbookBrowserPreference {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) ?? 'null') as Partial<WorkbookBrowserPreference> | null
    if (parsed?.version !== VERSION || typeof parsed.useLastActiveWorkspace !== 'boolean') {
      return DEFAULT_WORKBOOK_PREFERENCE
    }
    const entries = Object.entries(parsed.lastWorkspaceByProject ?? {}).filter(([, value]) => Number.isSafeInteger(value) && value > 0)
    return {
      version: VERSION,
      useLastActiveWorkspace: parsed.useLastActiveWorkspace,
      lastWorkspaceByProject: Object.fromEntries(entries),
    }
  } catch {
    return DEFAULT_WORKBOOK_PREFERENCE
  }
}

export function writeWorkbookPreference(
  preference: WorkbookBrowserPreference,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
) {
  storage.setItem(STORAGE_KEY, JSON.stringify(preference))
}

export function resolveOpeningWorkspace({
  useLastActive,
  lastActive,
  defaultId,
  workspaces,
}: {
  useLastActive: boolean
  lastActive?: number | null
  defaultId: number
  workspaces: readonly Pick<WorkspaceSummary, 'id' | 'type'>[]
}) {
  if (useLastActive && lastActive && workspaces.some((workspace) => workspace.id === lastActive)) return lastActive
  if (workspaces.some((workspace) => workspace.id === defaultId)) return defaultId
  return workspaces.find((workspace) => workspace.type === 'canvas')?.id
    ?? workspaces.find((workspace) => workspace.type === 'systems')?.id
    ?? workspaces[0]?.id
    ?? null
}
